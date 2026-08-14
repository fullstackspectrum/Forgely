"""Cloudsmith API client for the Forgely backend."""

from __future__ import annotations

import json
import logging
import os
import pathlib
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter

from perfstats import RequestStats, bucket_for, get_stats

log = logging.getLogger("forgely.cloudsmith")

def _read_app_version() -> str:
    try:
        pkg = pathlib.Path(__file__).parent.parent / "frontend" / "package.json"
        return json.loads(pkg.read_text())["version"]
    except Exception:
        return "unknown"

APP_VERSION = _read_app_version()
BASE_URL = "https://api.cloudsmith.io/v1"
MAX_RETRIES = 3
RETRY_BACKOFF = 2
# workspace-overview runs 6 outer workers × 10 inner workers = up to 60
# concurrent connections. pool_block=True makes threads wait for a free slot
# instead of discarding connections (which logs "Connection pool is full").
CONNECTION_POOL_SIZE = 64

SEVERITY_RANK = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}

# ──────────────────────────────────────────────────────────────
#  Dependency-fetch gating (perf/02)
# ──────────────────────────────────────────────────────────────
# Package formats observed never to return dependency data. Measured
# 2026-08-14 on full-stack-spectrum/neuro-packages: 10,376 of 10,420
# dependency calls returned nothing — 99.6% waste, and 53% of the entire
# build's network time. See docs/performance-design.md §8.3.
#
# Deliberately a DENYLIST, not an allowlist. Only conda/maven/rpm/ruby were
# observed returning data, but npm came back empty across 1,822 calls and
# python across 17 — and both formats *can* carry dependency metadata. An
# allowlist derived from a single workspace would silently drop edges
# elsewhere; denying only what was measured empty at volume keeps unknown and
# newly-added formats fetching by default.
DEPENDENCY_DENYLIST_DEFAULT = frozenset({
    "alpine",   # 8,504 calls, 0 non-empty
    "npm",      # 1,822 calls, 0 non-empty
    "docker",   #     3 calls, 0 non-empty — no dependency concept
    "generic",  #     3 calls, 0 non-empty — no dependency concept
    "raw",      #     2 calls, 0 non-empty — no dependency concept
})

DEPENDENCY_DENYLIST_ENV = "FORGELY_DEPENDENCY_DENYLIST"


def dependency_denylist() -> frozenset[str]:
    """Package formats to skip when fetching dependencies.

    Resolved lazily on every call, never at import time: ``main`` imports this
    module before it calls ``load_dotenv()``, so a module-level ``getenv``
    would read the environment before ``.env`` is applied and silently miss
    any override. Callers should resolve this once per build, not per package.

    Override with ``FORGELY_DEPENDENCY_DENYLIST`` as a comma-separated list of
    formats. Set it to an empty string to disable gating entirely and restore
    pre-perf/02 behaviour without a redeploy — the escape hatch if a workspace
    turns out to carry dependency data for a denied format.
    """
    raw = os.getenv(DEPENDENCY_DENYLIST_ENV)
    if raw is None:
        return DEPENDENCY_DENYLIST_DEFAULT
    return frozenset(f.strip().lower() for f in raw.split(",") if f.strip())


def create_session(api_key: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "X-Api-Key": api_key,
        "Accept": "application/json",
        "User-Agent": f"Forgely/{APP_VERSION}",
    })
    adapter = HTTPAdapter(
        pool_connections=CONNECTION_POOL_SIZE,
        pool_maxsize=CONNECTION_POOL_SIZE,
        pool_block=True,
    )
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    # Per-build request counters (see perfstats.py). Each build creates its own
    # session, so this scopes cleanly without global state.
    s.forgely_stats = RequestStats()
    return s


def _api_get_full(
    session: requests.Session, url: str, params: dict | None = None
) -> tuple[dict | list, dict]:
    """GET with retries, returning both the decoded body and the headers.

    The retry, throttle and instrumentation logic lives here so the two entry
    points cannot drift. ``_api_get`` is a thin wrapper that discards headers;
    callers that need pagination metadata use this directly.
    """
    stats = get_stats(session)
    bucket = bucket_for(url) if stats else ""
    delay = RETRY_BACKOFF
    for attempt in range(1, MAX_RETRIES + 1):
        t0 = time.perf_counter()
        try:
            resp = session.get(url, params=params, timeout=30)
        except requests.RequestException:
            if stats:
                stats.record_call(bucket, time.perf_counter() - t0, 0)
                stats.record_failure()
            raise
        if stats:
            stats.record_call(bucket, time.perf_counter() - t0, resp.status_code)
            stats.record_rate_limit_headers(resp.headers)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", delay))
            log.warning("Rate-limited – waiting %ds (attempt %d/%d)", retry_after, attempt, MAX_RETRIES)
            if stats:
                stats.record_throttle(retry_after)
                stats.record_retry()
            time.sleep(retry_after)
            delay *= 2
            continue
        resp.raise_for_status()
        return resp.json(), resp.headers
    if stats:
        stats.record_failure()
    raise RuntimeError(f"Max retries exceeded for {url}")


def _api_get(session: requests.Session, url: str, params: dict | None = None) -> dict | list:
    data, _ = _api_get_full(session, url, params=params)
    return data


def _api_get_page(session: requests.Session, url: str, params: dict | None = None) -> list:
    """Like _api_get but returns [] when the API 404s past the last page."""
    try:
        result = _api_get(session, url, params=params)
        return result if isinstance(result, list) else []
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return []
        raise


def fetch_namespaces(session: requests.Session) -> list[dict]:
    """Fetch all namespaces (orgs) the authenticated user belongs to."""
    url = f"{BASE_URL}/namespaces/"
    data = _api_get(session, url)
    return data if isinstance(data, list) else []


def fetch_repos(session: requests.Session, owner: str) -> list[dict]:
    """Fetch all repositories within a namespace."""
    url = f"{BASE_URL}/repos/{owner}/"
    page = 1
    repos: list[dict] = []
    while True:
        data = _api_get_page(session, url, params={"page": page, "page_size": 100})
        if not data:
            break
        repos.extend(data)
        if len(data) < 100:
            break
        page += 1
    return repos


def fetch_org_members(session: requests.Session, owner: str) -> list[dict]:
    """Fetch all members of an organization."""
    url = f"{BASE_URL}/orgs/{owner}/members/"
    page = 1
    members: list[dict] = []
    while True:
        data = _api_get_page(session, url, params={"page": page, "page_size": 100, "is_active": True})
        if not data:
            break
        members.extend(data)
        if len(data) < 100:
            break
        page += 1
    return members


def fetch_org_services(session: requests.Session, owner: str) -> list[dict]:
    """Fetch all service accounts within an organization."""
    url = f"{BASE_URL}/orgs/{owner}/services/"
    page = 1
    services: list[dict] = []
    while True:
        data = _api_get_page(session, url, params={"page": page, "page_size": 100})
        if not data:
            break
        services.extend(data)
        if len(data) < 100:
            break
        page += 1
    return services


def fetch_org_teams(session: requests.Session, owner: str) -> list[dict]:
    """Fetch all teams within an organization."""
    url = f"{BASE_URL}/orgs/{owner}/teams/"
    page = 1
    teams: list[dict] = []
    while True:
        data = _api_get(session, url, params={"page": page, "page_size": 100})
        if not data:
            break
        teams.extend(data if isinstance(data, list) else [])
        if not isinstance(data, list) or len(data) < 100:
            break
        page += 1
    return teams


def fetch_team_members(session: requests.Session, owner: str, team_slug: str) -> list[dict]:
    """Fetch all members of a specific team."""
    url = f"{BASE_URL}/orgs/{owner}/teams/{team_slug}/members/"
    try:
        data = _api_get(session, url, params={"page_size": 100})
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("members"), list):
            return data["members"]
        return []
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code in (400, 403, 404):
            return []
        raise


def fetch_repo_entitlements(session: requests.Session, owner: str, repo: str) -> list[dict]:
    """Fetch all entitlement tokens for a repository."""
    url = f"{BASE_URL}/entitlements/{owner}/{repo}/"
    try:
        data = _api_get(session, url, params={"page_size": 100})
        return data if isinstance(data, list) else []
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code in (404, 403):
            return []
        raise


def fetch_repo_privileges(session: requests.Session, owner: str, repo: str) -> list | dict:
    """Fetch privileges (user/team/service access) for a repository."""
    url = f"{BASE_URL}/repos/{owner}/{repo}/privileges/"
    try:
        data = _api_get(session, url, params={"page_size": 500})
        # API may return {"privileges": [...]} or a flat list or a dict with users/teams/services
        if isinstance(data, dict) and isinstance(data.get("privileges"), list):
            return data["privileges"]
        if isinstance(data, (dict, list)):
            return data
        return []
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code in (404, 403):
            return []
        raise


UPSTREAM_FORMATS = [
    "alpine", "cargo", "composer", "conda", "cran", "dart", "deb",
    "docker", "go", "helm", "hex", "maven", "npm", "nuget",
    "python", "rpm", "ruby", "swift",
]


def fetch_repo_upstreams(session: requests.Session, owner: str, repo: str, fmt: str = "") -> list[dict]:
    """Fetch upstream proxy/cache configs for a repo.

    If *fmt* is given, only the single matching format is queried (1 API call).
    Otherwise all known formats are tried (18 calls) — kept for back-compat but
    avoided in the org-graph builder to prevent rate-limit exhaustion.
    """
    formats_to_check = [fmt.lower()] if fmt else UPSTREAM_FORMATS
    upstreams: list[dict] = []
    for f in formats_to_check:
        url = f"{BASE_URL}/repos/{owner}/{repo}/upstream/{f}/"
        try:
            data = _api_get(session, url)
            if isinstance(data, list):
                for item in data:
                    item["_format"] = f
                upstreams.extend(data)
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code in (400, 403, 404, 405, 501):
                continue
            raise
    return upstreams


PAGE_SIZE = 100
# Pagination runs before the main worker pool starts, so it has the connection
# pool to itself. Kept below CONNECTION_POOL_SIZE and modest because list pages
# are the heaviest call in the API (~1.1s each, 100 full records per page).
PAGINATION_WORKERS = 10


def _page_total(headers) -> int | None:
    """Total page count from Cloudsmith's pagination headers, if present.

    Cloudsmith returns X-Pagination-PageTotal on every list response (verified
    against a live response 2026-08-14, alongside X-Pagination-Count and a Link
    header with rel="last"). Returns None if the header is missing or
    unparseable, so callers can fall back to sequential walking.
    """
    raw = headers.get("X-Pagination-PageTotal")
    if raw is None:
        return None
    try:
        total = int(raw)
    except (TypeError, ValueError):
        return None
    return total if total > 0 else None


# Safety stop for speculative pagination: 1,000 pages is 100k packages, well
# beyond anything observed. Guards against an API that never returns a short
# page, which would otherwise loop forever.
MAX_SPECULATIVE_PAGES = 1000


def _paginate_speculatively(first: list, fetch_page) -> dict[int, list]:
    """Fetch pages in concurrent batches, stopping at the first short page.

    Used only when the page-total header is missing or unparseable. Pagination
    is monotonic — a page shorter than PAGE_SIZE is the last one — so a batch
    can be dispatched blind and truncated at whichever page terminates it.
    Costs up to PAGINATION_WORKERS-1 wasted calls at the boundary, which is far
    cheaper than walking one page at a time.
    """
    pages: dict[int, list] = {1: first}
    next_page = 2

    while next_page <= MAX_SPECULATIVE_PAGES:
        batch = list(range(next_page, next_page + PAGINATION_WORKERS))
        with ThreadPoolExecutor(max_workers=PAGINATION_WORKERS) as pool:
            futures = [pool.submit(fetch_page, p) for p in batch]
            for fut in as_completed(futures):
                page, data = fut.result()
                pages[page] = data

        # First short or empty page in the batch ends the walk. Keep it (it is
        # the genuine last page) and discard everything speculated beyond it.
        terminator = next((p for p in batch if len(pages.get(p, [])) < PAGE_SIZE), None)
        if terminator is not None:
            for page in batch:
                if page > terminator:
                    pages.pop(page, None)
            return pages

        next_page += PAGINATION_WORKERS

    log.warning(
        "Speculative pagination hit the %d-page safety cap – results may be truncated",
        MAX_SPECULATIVE_PAGES,
    )
    return pages


def fetch_all_packages(session: requests.Session, owner: str, repo: str) -> list[dict]:
    """Fetch every package in a repo, parallelising pagination where possible.

    Sequential paging was 36% of total wall time on a 10k-package repo — 105
    calls at a ~1.1s mean, during which the vulnerability worker pool sat idle
    (docs/performance-design.md §8.1). Page 1 is fetched first to learn the page
    count, then the remainder are fetched concurrently.

    Page order is preserved. This is not cosmetic: _build_graph keeps the FIRST
    package it sees for a given name@version and discards later duplicates, so
    the order pages are concatenated in decides which package's metadata
    (format, size, licence, uploaded_at) ends up on the node.
    """
    url = f"{BASE_URL}/packages/{owner}/{repo}/"

    try:
        first, headers = _api_get_full(session, url, params={"page": 1, "page_size": PAGE_SIZE})
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return []
        raise

    if not isinstance(first, list) or not first:
        return []
    if len(first) < PAGE_SIZE:
        log.info("Fetched %d packages from %s/%s (single page)", len(first), owner, repo)
        return first

    def _fetch_page(page: int) -> tuple[int, list]:
        return page, _api_get_page(session, url, params={"page": page, "page_size": PAGE_SIZE})

    total_pages = _page_total(headers)
    if total_pages is not None:
        pages: dict[int, list] = {1: first}
        with ThreadPoolExecutor(max_workers=PAGINATION_WORKERS) as pool:
            futures = [pool.submit(_fetch_page, p) for p in range(2, total_pages + 1)]
            for fut in as_completed(futures):
                page, data = fut.result()
                pages[page] = data
        log.info(
            "Fetched %d packages from %s/%s (%d pages, %d in parallel)",
            sum(len(v) for v in pages.values()), owner, repo, total_pages, total_pages - 1,
        )
    else:
        log.warning(
            "No X-Pagination-PageTotal for %s/%s – falling back to speculative batching",
            owner, repo,
        )
        pages = _paginate_speculatively(first, _fetch_page)
        log.info(
            "Fetched %d packages from %s/%s (%d pages, speculative)",
            sum(len(v) for v in pages.values()), owner, repo, len(pages),
        )

    return [pkg for page in sorted(pages) for pkg in pages[page]]


def fetch_dependencies(
    session: requests.Session, owner: str, repo: str, slug: str, fmt: str = ""
) -> list[dict]:
    """Fetch a package's dependencies.

    *fmt* is used only for instrumentation — it records which package formats
    actually return dependency data, which is the input to the
    DEPENDENCY_FORMATS constant in perf/02-gate-dependency-fetch.
    """
    url = f"{BASE_URL}/packages/{owner}/{repo}/{slug}/dependencies/"
    stats = get_stats(session)
    try:
        data = _api_get(session, url)
        deps = data.get("dependencies", []) if isinstance(data, dict) else data
        if stats:
            stats.record_dependency_result(fmt, bool(deps))
        return deps
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if stats:
            stats.record_dependency_result(fmt, False)
        log.warning("fetch_dependencies failed for %s (HTTP %s) – skipping", slug, status)
        return []


def fetch_vulnerability_scans(session: requests.Session, owner: str, repo: str, slug: str) -> list[dict]:
    url = f"{BASE_URL}/vulnerabilities/{owner}/{repo}/{slug}/"
    try:
        data = _api_get(session, url)
        return data if isinstance(data, list) else data.get("results", [data]) if isinstance(data, dict) else []
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code in (404, 400):
            return []
        raise


def fetch_scan_details(session: requests.Session, owner: str, repo: str, slug: str, scan_id: str) -> dict:
    url = f"{BASE_URL}/vulnerabilities/{owner}/{repo}/{slug}/{scan_id}/"
    try:
        return _api_get(session, url)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return {}
        raise


def _extract_vulns(data: dict | list) -> list[dict]:
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in ("vulnerabilities", "results", "scan_results", "security_vulnerabilities"):
        val = data.get(key)
        if isinstance(val, list) and val:
            return val
    scan_obj = data.get("scan")
    if isinstance(scan_obj, dict):
        for key in ("vulnerabilities", "results", "security_vulnerabilities"):
            val = scan_obj.get(key)
            if isinstance(val, list) and val:
                return val
    scans_list = data.get("scans")
    if isinstance(scans_list, list):
        all_vulns = []
        for scan_entry in scans_list:
            if isinstance(scan_entry, dict):
                if any(k in scan_entry for k in ("severity", "cve_id", "name", "max_severity", "vuln_id")):
                    all_vulns.append(scan_entry)
                for key in ("vulnerabilities", "results", "scan_results"):
                    val = scan_entry.get(key)
                    if isinstance(val, list) and val:
                        all_vulns.extend(val)
        if all_vulns:
            return all_vulns
    for key, val in data.items():
        if isinstance(val, list) and val and isinstance(val[0], dict):
            if any(k in val[0] for k in ("severity", "cve_id", "name", "max_severity", "identifier")):
                return val
    return []


def get_package_vulnerabilities(
    session: requests.Session, owner: str, repo: str, slug: str
) -> tuple[str | None, int, list[dict]]:
    scans = fetch_vulnerability_scans(session, owner, repo, slug)
    if not scans:
        return None, 0, []

    latest = scans[0]
    for s in scans:
        if s.get("created_at", "") > latest.get("created_at", ""):
            latest = s

    api_count = latest.get("num_vulnerabilities") or latest.get("num_security_vulnerabilities") or 0
    max_sev = latest.get("max_severity")

    vulns = _extract_vulns(latest)

    if not vulns:
        scan_id = latest.get("identifier") or latest.get("slug_perm") or latest.get("id")
        if scan_id:
            details = fetch_scan_details(session, owner, repo, slug, str(scan_id))
            if details:
                vulns = _extract_vulns(details)
                if not max_sev:
                    max_sev = details.get("max_severity")
                if not api_count:
                    api_count = details.get("num_vulnerabilities", 0)

    if not vulns and len(scans) > 1:
        for s in scans:
            if s is latest:
                continue
            vulns = _extract_vulns(s)
            if vulns:
                break
            sid = s.get("identifier") or s.get("slug_perm") or s.get("id")
            if sid:
                d = fetch_scan_details(session, owner, repo, slug, str(sid))
                if d:
                    vulns = _extract_vulns(d)
                    if vulns:
                        break

    if not vulns and (api_count or 0) > 0 and latest.get("max_severity"):
        embedded = []
        for s in scans:
            sev = s.get("max_severity") or s.get("severity")
            if sev:
                embedded.append({
                    "severity": sev,
                    "cve_id": s.get("cve_id", ""),
                    "name": s.get("name", ""),
                    "description": s.get("description", s.get("summary", "")),
                    "url": s.get("url", ""),
                })
        if embedded:
            vulns = embedded

    if not api_count and vulns:
        api_count = len(vulns)

    if not max_sev and vulns:
        best_rank = 0
        for v in vulns:
            v_sev = v.get("severity", v.get("max_severity", ""))
            rank = SEVERITY_RANK.get(v_sev, 0)
            if rank > best_rank:
                best_rank = rank
                max_sev = v_sev

    # If scans existed but no severity was determined, the scan completed
    # cleanly.  Return "None" (string) so callers can distinguish from
    # "no scans at all" (Python None).
    # The Cloudsmith API may also return "Unknown" as max_severity for scans
    # that completed with 0 vulnerabilities – normalise that to "None" too.
    api_count_int = int(api_count) if api_count is not None else 0
    if not max_sev or (max_sev == "Unknown" and api_count_int == 0 and not vulns):
        max_sev = "None"

    return max_sev, api_count_int, vulns
