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


def _env_int(name: str, default: int) -> int:
    """Positive integer from the environment, or the default.

    Read lazily rather than at import: main imports this module before
    load_dotenv() runs, so anything captured at import time misses .env.
    """
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        log.warning("Ignoring non-integer %s=%r", name, raw)
        return default
    if value < 1:
        log.warning("Ignoring non-positive %s=%d", name, value)
        return default
    return value


# Measured against a 10,400-package language repository (1,887 scans), package
# list warm, scan cache cold on every run. Zero 429s and zero failures at every
# level tested:
#
#     workers    wall   speedup   mean latency
#          10   46.4s     0.54x          228ms
#          20   25.0s     1.00x          238ms   <- previous hardcoded value
#          40   16.7s     1.49x          266ms
#          60   14.0s     1.78x          280ms   <- default
#         100   11.2s     2.24x          288ms
#
# Scaling is sublinear because the API inflates latency under concurrency
# rather than rejecting it. 60 sits where the curve flattens: on a full cold
# build, 60/30 reaches 2.27x and 100/60 only 2.38x for nearly double the
# connections, which is not a trade worth making against someone else's API.
SCAN_WORKERS_DEFAULT = 60
SCAN_WORKERS_ENV = "FORGELY_SCAN_WORKERS"


def scan_workers() -> int:
    """Concurrent vulnerability-scan fetches during a graph build.

    Note this is per build. Concurrent builds each get their own pool, so the
    thread count multiplies — lower it if the process serves many at once.
    """
    return _env_int(SCAN_WORKERS_ENV, SCAN_WORKERS_DEFAULT)


def connection_pool_size() -> int:
    """Connection pool size, never smaller than the concurrency it must serve.

    The adapter is built with pool_block=True, so a pool smaller than the
    worker count silently serialises the excess — a sweep of worker counts
    against a fixed pool would measure the pool, not the API.
    """
    return max(CONNECTION_POOL_SIZE, scan_workers(), pagination_workers())


SEVERITY_RANK = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}

# ──────────────────────────────────────────────────────────────
#  Dependency-fetch gating (perf/02)
# ──────────────────────────────────────────────────────────────
# Package formats observed never to return dependency data. Measured
# 2026-08-14 on a 10,400-package language repository: 10,376 of 10,420
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
    pool = connection_pool_size()
    adapter = HTTPAdapter(
        pool_connections=pool,
        pool_maxsize=pool,
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
    return _fetch_paginated(session, f"{BASE_URL}/repos/{owner}/", label=f"{owner} repos")


def fetch_org_members(session: requests.Session, owner: str) -> list[dict]:
    """Fetch all members of an organization."""
    return _fetch_paginated(
        session, f"{BASE_URL}/orgs/{owner}/members/", {"is_active": True}, f"{owner} members"
    )


def fetch_org_services(session: requests.Session, owner: str) -> list[dict]:
    """Fetch all service accounts within an organization."""
    return _fetch_paginated(session, f"{BASE_URL}/orgs/{owner}/services/", label=f"{owner} services")


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


def fetch_repo_connected(session: requests.Session, owner: str, repo: str) -> list[dict]:
    """Repositories this one is connected to.

    A connection lets a repo resolve packages from another repo in the same
    workspace — an upstream that happens to be internal. It is directional:
    this repo is the one doing the reaching.

    Tolerates 404 and 403 the same way entitlements do. The endpoint is not
    available for every repository, and a workspace where it is not is not an
    error — it simply has no connections to draw.
    """
    url = f"{BASE_URL}/repos/{owner}/{repo}/connected/"
    try:
        data = _api_get(session, url)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code in (400, 403, 404):
            return []
        raise
    # Documented as {"results": [...]}, but read defensively: every other
    # paginated collection in this API answers with a bare list.
    if isinstance(data, dict):
        results = data.get("results")
        return results if isinstance(results, list) else []
    return data if isinstance(data, list) else []


UPSTREAM_FORMATS = [
    "alpine", "cargo", "composer", "conda", "cran", "dart", "deb",
    "docker", "go", "helm", "hex", "maven", "npm", "nuget",
    "python", "rpm", "ruby", "swift",
]


# Formats queried at once per repo. See fetch_repo_upstreams.
UPSTREAM_WORKERS = 6


def fetch_repo_upstreams(session: requests.Session, owner: str, repo: str, fmt: str = "") -> list[dict]:
    """Fetch upstream proxy/cache configs for a repo.

    Every format is queried unless *fmt* narrows it, because a repo can hold
    any mix of formats and the API exposes no field listing them. Formats the
    repo does not use answer 404 and are skipped.

    Only pass *fmt* when the format is genuinely known. Passing a value that is
    not a package format makes every request 404, which is indistinguishable
    here from a repo that simply has no upstreams.
    """
    formats_to_check = [fmt.lower()] if fmt else UPSTREAM_FORMATS

    def _one(f: str) -> list[dict]:
        url = f"{BASE_URL}/repos/{owner}/{repo}/upstream/{f}/"
        try:
            data = _api_get(session, url)
        except requests.HTTPError as exc:
            # A format the repo does not support. Not an error: the only way to
            # learn which formats a repo holds is to ask for each of them.
            if exc.response is not None and exc.response.status_code in (400, 403, 404, 405, 501):
                return []
            raise
        if not isinstance(data, list):
            return []
        for item in data:
            item["_format"] = f
        return data

    if len(formats_to_check) == 1:
        return _one(formats_to_check[0])

    # 18 formats at ~200ms each is 3.6s of latency per repo, and it is all
    # waiting. Kept modest because the caller already runs several repos at
    # once; the product of the two is what reaches the API.
    upstreams: list[dict] = []
    with ThreadPoolExecutor(max_workers=UPSTREAM_WORKERS) as pool:
        for result in pool.map(_one, formats_to_check):
            upstreams.extend(result)
    # Deterministic regardless of which thread finished first.
    upstreams.sort(key=lambda u: (u.get("_format", ""), u.get("upstream_url", ""), u.get("name", "")))
    return upstreams


PAGE_SIZE = 100
# Pagination runs before the main worker pool starts, so it has the connection
# pool to itself. Kept below CONNECTION_POOL_SIZE and modest because list pages
# are the heaviest call in the API (~1.1s each, 100 full records per page).
# Swept the same way, with the scan cache warm so pagination was the only cost:
#
#     workers    wall   speedup   mean latency
#           5   27.6s     0.61x         1131ms
#          10   16.9s     1.00x         1247ms   <- previous hardcoded value
#          20   12.2s     1.38x         1498ms
#          40   10.2s     1.65x         1837ms
#          60    7.3s     2.31x         1892ms
#
# List pages inflate far worse than scans under concurrency (+67% latency by
# 60 workers, against +26% for scans) because each carries 100 full records.
# 30 keeps most of the gain without leaning on the API that hard.
PAGINATION_WORKERS_DEFAULT = 30
PAGINATION_WORKERS_ENV = "FORGELY_PAGINATION_WORKERS"


def pagination_workers() -> int:
    """Concurrent list-page fetches. See scan_workers() for why this is tunable."""
    return _env_int(PAGINATION_WORKERS_ENV, PAGINATION_WORKERS_DEFAULT)


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
    Costs up to pagination_workers()-1 wasted calls at the boundary, which is
    far cheaper than walking one page at a time.
    """
    pages: dict[int, list] = {1: first}
    next_page = 2
    workers = pagination_workers()

    while next_page <= MAX_SPECULATIVE_PAGES:
        batch = list(range(next_page, next_page + workers))
        with ThreadPoolExecutor(max_workers=workers) as pool:
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

        next_page += workers

    log.warning(
        "Speculative pagination hit the %d-page safety cap – results may be truncated",
        MAX_SPECULATIVE_PAGES,
    )
    return pages


def _fetch_paginated(
    session: requests.Session,
    url: str,
    extra_params: dict | None = None,
    label: str = "",
    on_page=None,
) -> list[dict]:
    """Fetch every page of a paginated list endpoint, in parallel where possible.

    Sequential paging was 36% of total wall time on a 10k-package repo — 105
    calls at a ~1.1s mean, during which the worker pool sat idle
    (docs/performance-design.md §8.1). Page 1 is fetched first to learn the page
    count from X-Pagination-PageTotal, then the remainder go out concurrently.
    Falls back to speculative batching when that header is unusable.

    Page order is always preserved. This is not cosmetic: _build_graph keeps the
    FIRST package it sees for a given name@version and discards later
    duplicates, so the order pages are concatenated in decides which package's
    metadata (format, size, licence, uploaded_at) ends up on the node.
    """
    def _params(page: int) -> dict:
        p = {"page": page, "page_size": PAGE_SIZE}
        if extra_params:
            p.update(extra_params)
        return p

    try:
        first, headers = _api_get_full(session, url, params=_params(1))
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return []
        raise

    if not isinstance(first, list) or not first:
        if on_page:
            on_page(1, 1)
        return []
    if len(first) < PAGE_SIZE:
        # Single page: still report, or a small repo emits no pagination phase
        # at all and the client cannot distinguish it from a stalled build.
        if on_page:
            on_page(1, 1)
        return first

    def _fetch_page(page: int) -> tuple[int, list]:
        return page, _api_get_page(session, url, params=_params(page))

    total_pages = _page_total(headers)
    if total_pages is not None:
        pages: dict[int, list] = {1: first}
        if on_page:
            on_page(1, total_pages)
        with ThreadPoolExecutor(max_workers=pagination_workers()) as pool:
            futures = [pool.submit(_fetch_page, p) for p in range(2, total_pages + 1)]
            for fut in as_completed(futures):
                page, data = fut.result()
                pages[page] = data
                if on_page:
                    on_page(len(pages), total_pages)
        log.info("Fetched %s: %d pages, %d in parallel", label or url, total_pages, total_pages - 1)
    else:
        log.warning(
            "No X-Pagination-PageTotal for %s – falling back to speculative batching",
            label or url,
        )
        pages = _paginate_speculatively(first, _fetch_page)

    return [item for page in sorted(pages) for item in pages[page]]


def fetch_all_packages(session: requests.Session, owner: str, repo: str, on_page=None) -> list[dict]:
    """Fetch every package. *on_page(done, total)* reports pagination progress.

    Pagination is ~13s of a 44.6s cold build with nothing to show for it, so
    the stream endpoint surfaces it rather than leaving the user on a spinner.
    """
    packages = _fetch_paginated(
        session, f"{BASE_URL}/packages/{owner}/{repo}/", label=f"{owner}/{repo} packages",
        on_page=on_page,
    )
    log.info("Fetched %d packages from %s/%s", len(packages), owner, repo)
    return packages


def fetch_package(session: requests.Session, owner: str, repo: str, slug: str) -> dict:
    """One package's full record.

    The list endpoint the graph build uses already returns every field, but it
    is not kept: holding 7,500 complete records to serve the one the user
    clicked would cost more memory than re-asking for it does latency.
    """
    url = f"{BASE_URL}/packages/{owner}/{repo}/{slug}/"
    data = _api_get(session, url)
    return data if isinstance(data, dict) else {}


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


# ---------------------------------------------------------------------------
# Vulnerabilities: OSV advisories (v2)
#
# Cloudsmith exposes two vulnerability APIs. The v1 endpoint returns *scans* —
# one record per scan run, with the findings nested somewhere inside a shape
# that varied by package format, which is why reading it took a fallback ladder
# and up to three round-trips per package.
#
# v2 returns the OSV advisories themselves: one flat, documented record per
# finding, under a fixed {"results": [...]} envelope, ordered by severity.
#
# Nothing reads v1 any more. The vulnly report was the last caller, and it now
# renders this feed through vulnly's cloudsmith-osv source.
# ---------------------------------------------------------------------------

V2_BASE_URL = "https://api.cloudsmith.io/v2"

# The server caps page_size at 500 and truncates silently above it: measured,
# page_size=1000 returned 500 rows and reported the same page total as 500.
OSV_PAGE_SIZE = 500

# A bound on paging, in case the page-total header is ever wrong. The heaviest
# package measured carried 4,000 advisories, which is 8 pages at the cap.
OSV_MAX_PAGES = 40

# Statuses that mean "no advisories for this package" rather than a fault.
# 402 is included because a workspace without the entitlement answers with it,
# and one such repository must not abort a whole graph build.
_OSV_EMPTY_STATUSES = (400, 402, 403, 404)


def fetch_package_osv(session: requests.Session, slug_perm: str) -> list[dict]:
    """Every OSV advisory Cloudsmith holds for one package.

    Paged sequentially on purpose. The graph build already runs scan_workers()
    packages at once, so paging concurrently here would multiply against that
    pool rather than add to it — and all but the largest images fit in one page.
    """
    url = f"{V2_BASE_URL}/packages/{slug_perm}/vulnerabilities/"

    def _page(number: int) -> tuple[list[dict], int]:
        try:
            body, headers = _api_get_full(
                session, url, params={"page": number, "page_size": OSV_PAGE_SIZE}
            )
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else 0
            if status in _OSV_EMPTY_STATUSES:
                if status == 402:
                    log.warning(
                        "Vulnerability data is not included in the plan for this "
                        "workspace – reporting %s as clean", slug_perm,
                    )
                return [], 0
            raise
        results = body.get("results", []) if isinstance(body, dict) else []
        try:
            total = int(headers.get("X-Pagination-PageTotal") or 1)
        except (TypeError, ValueError):
            total = 1
        return results, total

    vulns, total_pages = _page(1)
    for number in range(2, min(total_pages, OSV_MAX_PAGES) + 1):
        page, _ = _page(number)
        if not page:
            break
        vulns.extend(page)
    return vulns


def osv_severity(vuln: dict) -> str:
    """One advisory's severity, in the vocabulary the rest of the app uses.

    OSV carries several scores per advisory — a CVSS vector, sometimes a vendor
    label — and Cloudsmith resolves them into ``best_severity``, preferring the
    newer CVSS version. Its ``label`` is already normalised to critical / high /
    medium / low; every one of the 608 advisories measured had one. Title-cased
    to meet SEVERITY_RANK and the severity names the frontend colours by.
    """
    for key in ("best_severity", "highest_severity"):
        label = ((vuln.get(key) or {}).get("label") or "").strip()
        if label:
            return label.title()
    return "Unknown"


def osv_description(vuln: dict) -> str:
    """An advisory's prose.

    ``details`` holds it. ``summary`` and ``title`` are the fields the OSV
    schema nominates for exactly this, but both were null in 607 of the 608
    advisories measured, so they are fallbacks rather than the first choice.
    """
    return (vuln.get("details") or vuln.get("title") or vuln.get("summary") or "").strip()


def get_package_vulnerabilities(
    session: requests.Session, owner: str, repo: str, slug: str
) -> tuple[str | None, int, list[dict]]:
    """(max severity, finding count, advisories) for one package.

    ``owner`` and ``repo`` are unused: v2 addresses a package by its slug_perm
    alone, which is what ``slug`` already holds throughout this codebase. They
    are kept in the signature so the call sites and the scan cache key, which
    are all keyed on the three together, need no change.
    """
    vulns = fetch_package_osv(session, slug)
    if not vulns:
        # "None" the string, not None. Callers distinguish "scanned and clean"
        # from "never scanned", and packages that cannot be scanned never reach
        # here — _build_graph seeds those directly.
        return "None", 0, []

    max_rank, max_sev = 0, "Unknown"
    for vuln in vulns:
        severity = osv_severity(vuln)
        rank = SEVERITY_RANK.get(severity, 0)
        if rank > max_rank:
            max_rank, max_sev = rank, severity

    return max_sev, len(vulns), vulns
