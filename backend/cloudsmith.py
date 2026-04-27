"""Cloudsmith API client for the Forgely backend."""

from __future__ import annotations

import json
import logging
import time

import requests
from requests.adapters import HTTPAdapter

log = logging.getLogger("forgely.cloudsmith")

APP_VERSION = "1.0.0-beta.5"
BASE_URL = "https://api.cloudsmith.io/v1"
MAX_RETRIES = 3
RETRY_BACKOFF = 2
# Match the largest ThreadPoolExecutor used by main.py so concurrent
# requests don't exhaust the urllib3 connection pool (which logs
# "Connection pool is full, discarding connection").
CONNECTION_POOL_SIZE = 32

SEVERITY_RANK = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}


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
        pool_block=False,
    )
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def _api_get(session: requests.Session, url: str, params: dict | None = None) -> dict | list:
    delay = RETRY_BACKOFF
    for attempt in range(1, MAX_RETRIES + 1):
        resp = session.get(url, params=params, timeout=30)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", delay))
            log.warning("Rate-limited – waiting %ds (attempt %d/%d)", retry_after, attempt, MAX_RETRIES)
            time.sleep(retry_after)
            delay *= 2
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError(f"Max retries exceeded for {url}")


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
        data = _api_get(session, url, params={"page": page, "page_size": 100})
        if not data:
            break
        repos.extend(data if isinstance(data, list) else [])
        if not isinstance(data, list) or len(data) < 100:
            break
        page += 1
    return repos


def fetch_org_members(session: requests.Session, owner: str) -> list[dict]:
    """Fetch all members of an organization."""
    url = f"{BASE_URL}/orgs/{owner}/members/"
    page = 1
    members: list[dict] = []
    while True:
        data = _api_get(session, url, params={"page": page, "page_size": 100, "is_active": True})
        if not data:
            break
        members.extend(data if isinstance(data, list) else [])
        if not isinstance(data, list) or len(data) < 100:
            break
        page += 1
    return members


def fetch_org_services(session: requests.Session, owner: str) -> list[dict]:
    """Fetch all service accounts within an organization."""
    url = f"{BASE_URL}/orgs/{owner}/services/"
    page = 1
    services: list[dict] = []
    while True:
        data = _api_get(session, url, params={"page": page, "page_size": 100})
        if not data:
            break
        services.extend(data if isinstance(data, list) else [])
        if not isinstance(data, list) or len(data) < 100:
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


def fetch_repo_upstreams(session: requests.Session, owner: str, repo: str) -> list[dict]:
    """Fetch all upstream proxy/cache configs across all format types for a repo."""
    upstreams: list[dict] = []
    for fmt in UPSTREAM_FORMATS:
        url = f"{BASE_URL}/repos/{owner}/{repo}/upstream/{fmt}/"
        try:
            data = _api_get(session, url)
            if isinstance(data, list):
                for item in data:
                    item["_format"] = fmt
                upstreams.extend(data)
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code in (400, 403, 404, 405, 501):
                continue
            raise
    return upstreams


def fetch_all_packages(session: requests.Session, owner: str, repo: str) -> list[dict]:
    url = f"{BASE_URL}/packages/{owner}/{repo}/"
    page = 1
    all_packages: list[dict] = []
    while True:
        log.info("Fetching packages – page %d (%d so far)", page, len(all_packages))
        data = _api_get(session, url, params={"page": page, "page_size": 100})
        if not data:
            break
        all_packages.extend(data)
        if len(data) < 100:
            break
        page += 1
    log.info("Fetched %d packages from %s/%s", len(all_packages), owner, repo)
    return all_packages


def fetch_dependencies(session: requests.Session, owner: str, repo: str, slug: str) -> list[dict]:
    url = f"{BASE_URL}/packages/{owner}/{repo}/{slug}/dependencies/"
    try:
        data = _api_get(session, url)
        return data.get("dependencies", []) if isinstance(data, dict) else data
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
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
