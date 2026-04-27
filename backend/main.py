"""Forgely backend – FastAPI service that fetches Cloudsmith data."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from cloudsmith import (
    APP_VERSION,
    SEVERITY_RANK,
    create_session,
    fetch_all_packages,
    fetch_dependencies,
    fetch_namespaces,
    fetch_org_members,
    fetch_org_services,
    fetch_org_teams,
    fetch_repo_entitlements,
    fetch_repo_privileges,
    fetch_repo_upstreams,
    fetch_repos,
    fetch_scan_details,
    fetch_team_members,
    fetch_vulnerability_scans,
    get_package_vulnerabilities,
)
from models import (
    CVERecord,
    GraphEdge,
    GraphNode,
    GraphResponse,
    GraphStats,
    NodeData,
)

# Load .env from the project root (one level up)
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
load_dotenv(_env_path, override=True)

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("forgely.api")

app = FastAPI(title="Forgely API", version=APP_VERSION)

_allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory cache
_cache: dict[str, dict] = {}
CACHE_TTL = 300  # 5 minutes


def _get_api_key(request: Request | None = None) -> str:
    # Prefer key from request header, fall back to .env
    if request and request.headers.get("X-Api-Key"):
        return request.headers["X-Api-Key"]
    api_key = os.getenv("CLOUDSMITH_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=401, detail="No API key configured. Use the Connect button to add your Cloudsmith API key.")
    return api_key


def _get_defaults() -> tuple[str, str]:
    """Return the default owner/repo from env (may be empty)."""
    return os.getenv("CLOUDSMITH_OWNER", ""), os.getenv("CLOUDSMITH_REPO", "")


@app.get("/api/config")
def get_config(request: Request):
    try:
        _get_api_key(request)
        has_key = True
    except HTTPException:
        has_key = False
    owner, repo = _get_defaults()
    return {"owner": owner, "repo": repo, "has_key": has_key}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/namespaces")
def list_namespaces(request: Request):
    """List all Cloudsmith workspaces/orgs the user belongs to."""
    api_key = _get_api_key(request)
    session = create_session(api_key)
    raw = fetch_namespaces(session)
    return [
        {
            "slug": ns.get("slug", ""),
            "name": ns.get("name", ns.get("slug", "")),
            "type": ns.get("type_name", ns.get("type", "")),
        }
        for ns in raw
    ]


@app.get("/api/repos/{owner}")
def list_repos(owner: str, request: Request):
    """List all repos within a workspace/org."""
    api_key = _get_api_key(request)
    session = create_session(api_key)
    raw = fetch_repos(session, owner)
    return [
        {
            "slug": r.get("slug", ""),
            "name": r.get("name", r.get("slug", "")),
            "description": r.get("description", ""),
            "package_count": r.get("package_count", 0),
        }
        for r in raw
    ]


def _build_graph(api_key: str, owner: str, repo: str) -> GraphResponse:
    """Fetch Cloudsmith data and build the graph response."""
    session = create_session(api_key)
    packages = fetch_all_packages(session, owner, repo)

    if not packages:
        raise HTTPException(status_code=404, detail="No packages found – check owner/repo and API key.")

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    stats = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0, "Safe": 0}
    total_cves = 0
    slug_to_id: dict[str, str] = {}
    cve_to_packages: dict[str, list[str]] = {}

    # Repo node
    repo_id = f"{owner}/{repo}"
    nodes.append(GraphNode(id=repo_id, label=repo_id, type="repo", data=NodeData()))
    seen_ids: set[str] = {repo_id}

    # De-duplicate packages and prepare metadata before parallel fetch
    pkg_metas: list[dict] = []
    for pkg in packages:
        slug = pkg["slug_perm"]
        name = pkg.get("name") or pkg.get("slug_perm") or ""
        version = pkg.get("version") or ""
        node_id = f"{name}@{version}" if version else (name or slug)

        if node_id in seen_ids:
            slug_to_id.setdefault(slug, node_id)
            continue
        seen_ids.add(node_id)
        slug_to_id[slug] = node_id
        pkg_metas.append({"pkg": pkg, "slug": slug, "name": name, "version": version, "node_id": node_id})

    # --- Parallel vulnerability scanning ---
    MAX_WORKERS = 20

    def _scan_vuln(meta: dict) -> tuple[dict, str | None, int, list[dict]]:
        slug = meta["slug"]
        return (meta, *get_package_vulnerabilities(session, owner, repo, slug))

    vuln_results: dict[str, tuple[str | None, int, list[dict]]] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_scan_vuln, m): m for m in pkg_metas}
        for fut in as_completed(futures):
            meta, max_sev, vuln_count, vulns = fut.result()
            vuln_results[meta["node_id"]] = (max_sev, vuln_count, vulns)

    for meta in pkg_metas:
        pkg = meta["pkg"]
        slug = meta["slug"]
        name = meta["name"]
        version = meta["version"]
        node_id = meta["node_id"]

        downloads = pkg.get("downloads", 0)
        scan_status = pkg.get("security_scan_status", "Unknown")

        max_sev, vuln_count, vulns = vuln_results[node_id]

        # Normalise: the Cloudsmith API may return "Unknown" as max_severity
        # even when the scan completed cleanly with 0 vulnerabilities.
        if max_sev == "Unknown" and vuln_count == 0:
            max_sev = "None"

        # Override scan_status based on actual scan results – the package list
        # API may report "Awaiting Security Scan" even when scans have completed.
        # max_sev is Python None only when no scan data exists at all;
        # it is the string "None" when a scan ran but found 0 vulns.
        if vuln_count > 0:
            scan_status = "Scanned (Vulnerable)"
        elif max_sev is not None:
            scan_status = "Scanned (Clean)"
        elif "not supported" in scan_status.lower():
            # Scanning is genuinely unavailable for this package format.
            # Keep max_sev as None → grey on the frontend.
            pass
        else:
            # No vulnerability data returned but scanning is not explicitly
            # unsupported – the API may lag or return empty for clean packages.
            # Treat as clean (green).
            scan_status = "Scanned (Clean)"
            max_sev = "None"

        cve_records: list[CVERecord] = []
        for v in vulns:
            v_sev = v.get("severity", v.get("max_severity", "Unknown"))
            cve_id = v.get("vulnerability_id") or v.get("cve_id") or v.get("identifier", "")

            affected = (
                v.get("package_name")
                or v.get("affected_package")
                or v.get("package")
                or v.get("component")
                or v.get("dependency")
                or ""
            )
            raw_av = v.get("affected_version") or v.get("package_version") or ""
            affected_version = raw_av.get("raw_version", "") if isinstance(raw_av, dict) else str(raw_av)
            raw_fv = v.get("fixed_version") or v.get("fixed_in") or v.get("patched_version") or ""
            fixed_in = raw_fv.get("raw_version", "") if isinstance(raw_fv, dict) else str(raw_fv)

            refs = v.get("references") or []
            first_ref = refs[0].get("url", "") if refs and isinstance(refs[0], dict) else (refs[0] if refs else "")
            api_url = v.get("url") or v.get("advisory_url") or first_ref or ""
            nvd_url = ""
            ghsa_url = ""
            if cve_id and cve_id.upper().startswith("CVE-"):
                nvd_url = f"https://nvd.nist.gov/vuln/detail/{cve_id}"
                ghsa_url = f"https://github.com/advisories?query={cve_id}"
            elif cve_id and cve_id.upper().startswith("GHSA-"):
                ghsa_url = f"https://github.com/advisories/{cve_id}"

            description = v.get("description") or v.get("title") or v.get("summary", "")

            cve_records.append(CVERecord(
                id=cve_id, severity=v_sev, description=description,
                url=api_url, nvd_url=nvd_url, ghsa_url=ghsa_url,
                affected=affected, affected_version=affected_version, fixed_in=fixed_in,
            ))

            if cve_id:
                cve_to_packages.setdefault(cve_id, []).append(node_id)

        nodes.append(GraphNode(
            id=node_id,
            label=name,
            type="package",
            data=NodeData(
                version=version,
                format=pkg.get("format", "N/A"),
                max_severity=max_sev,
                vuln_count=vuln_count,
                cves=cve_records,
                downloads=downloads,
                license=pkg.get("license") or pkg.get("spdx_expression") or "N/A",
                size=pkg.get("size", 0),
                scan_status=scan_status,
                uploaded_at=pkg.get("uploaded_at") or pkg.get("created_at") or "N/A",
                slug=slug,
                pkg_type=pkg.get("type_display") or pkg.get("package_type") or pkg.get("format", "N/A"),
                is_quarantined=bool(pkg.get("is_quarantined", False)),
            ),
        ))
        edges.append(GraphEdge(source=repo_id, target=node_id, type="repo_package"))
        total_cves += vuln_count
        if max_sev in stats:
            stats[max_sev] += 1
        else:
            stats["Safe"] += 1

    # Shared-CVE edges
    seen_pairs: set[tuple[str, str]] = set()
    for cve_id, pkg_ids in cve_to_packages.items():
        if len(pkg_ids) < 2:
            continue
        for i in range(len(pkg_ids)):
            for j in range(i + 1, len(pkg_ids)):
                a, b = pkg_ids[i], pkg_ids[j]
                pair = (min(a, b), max(a, b))
                if pair not in seen_pairs:
                    edges.append(GraphEdge(source=a, target=b, type="shared_cve", label=cve_id))
                    seen_pairs.add(pair)

    # --- Parallel dependency fetching ---
    def _fetch_dep(item: tuple[str, str]) -> tuple[str, list[dict]]:
        slug, src_id = item
        return (src_id, fetch_dependencies(session, owner, repo, slug))

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        dep_futures = [pool.submit(_fetch_dep, item) for item in slug_to_id.items()]
        for fut in as_completed(dep_futures):
            src_id, deps = fut.result()
            for dep in deps:
                dep_name = dep.get("name", dep.get("identifier", "unknown"))
                dep_operator = dep.get("operator", dep.get("comparator", "")) or ""
                dep_version_num = dep.get("version", dep.get("version_constraint", dep.get("constraints", ""))) or ""
                dep_version = f"{dep_operator}{dep_version_num}" if dep_version_num else ""
                if dep_name not in seen_ids:
                    nodes.append(GraphNode(id=dep_name, label=dep_name, type="dependency", data=NodeData(version=dep_version)))
                    seen_ids.add(dep_name)
                edges.append(GraphEdge(source=src_id, target=dep_name, type="dependency", label=dep_version))

    graph_stats = GraphStats(
        critical=stats.get("Critical", 0),
        high=stats.get("High", 0),
        medium=stats.get("Medium", 0),
        low=stats.get("Low", 0),
        safe=stats.get("Safe", 0),
        total_cves=total_cves,
        total_nodes=len(nodes),
        total_edges=len(edges),
    )

    return GraphResponse(owner=owner, repo=repo, nodes=nodes, edges=edges, stats=graph_stats)


@app.get("/api/graph", response_model=GraphResponse)
def get_graph(request: Request, owner: str | None = None, repo: str | None = None):
    api_key = _get_api_key(request)
    default_owner, default_repo = _get_defaults()
    owner = owner or default_owner
    repo = repo or default_repo
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required")

    cache_key = f"{owner}/{repo}"

    if cache_key in _cache and time.time() - _cache[cache_key]["ts"] < CACHE_TTL:
        log.info("Returning cached graph for %s", cache_key)
        return _cache[cache_key]["data"]

    log.info("Building graph for %s/%s", owner, repo)
    result = _build_graph(api_key, owner, repo)
    _cache[cache_key] = {"data": result, "ts": time.time()}
    return result


@app.post("/api/graph/refresh", response_model=GraphResponse)
def refresh_graph(request: Request, owner: str | None = None, repo: str | None = None):
    api_key = _get_api_key(request)
    default_owner, default_repo = _get_defaults()
    owner = owner or default_owner
    repo = repo or default_repo
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required")

    cache_key = f"{owner}/{repo}"
    log.info("Force-refreshing graph for %s/%s", owner, repo)
    result = _build_graph(api_key, owner, repo)
    _cache[cache_key] = {"data": result, "ts": time.time()}
    return result


@app.get("/api/search")
def search_packages(owner: str, repo: str, query: str, request: Request):
    """Proxy the Cloudsmith query filter to search packages by name, version, format, etc."""
    if not query.strip():
        return []
    api_key = _get_api_key(request)
    session = create_session(api_key)
    url = f"https://api.cloudsmith.io/v1/packages/{owner}/{repo}/"
    try:
        resp = session.get(url, params={"query": query, "page": 1, "page_size": 50}, timeout=15)
        resp.raise_for_status()
        results = resp.json()
    except Exception as exc:
        log.warning("Search failed: %s", exc)
        return []
    return [
        {
            "name": p.get("name", ""),
            "version": p.get("version", ""),
            "format": p.get("format", ""),
            "slug": p.get("slug_perm", ""),
            "node_id": f"{p.get('name', '')}@{p.get('version', '')}" if p.get("version") else p.get("name", ""),
        }
        for p in (results if isinstance(results, list) else [])
    ]


@app.post("/api/auth/validate")
def validate_api_key(request: Request):
    """Validate a Cloudsmith API key by hitting the /v1/user/self/ endpoint."""
    api_key = request.headers.get("X-Api-Key", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided")
    session = create_session(api_key)
    try:
        resp = session.get("https://api.cloudsmith.io/v1/user/self/", timeout=10)
        if resp.status_code == 401:
            return {"valid": False, "error": "Invalid API key"}
        resp.raise_for_status()
        user = resp.json()
        return {
            "valid": True,
            "name": user.get("name", ""),
            "slug": user.get("slug", ""),
            "email": user.get("email", ""),
        }
    except Exception as exc:
        log.warning("API key validation failed: %s", exc)
        return {"valid": False, "error": str(exc)}


@app.get("/api/vulnly-report/{owner}/{repo}/{slug}")
def vulnly_report(owner: str, repo: str, slug: str, request: Request):
    """Generate an HTML vulnerability report for a package using vulnly.

    Fetches the latest Cloudsmith vulnerability scan for the package, wraps
    it in the expected `{"data": ...}` envelope, pipes it through the
    `vulnly` CLI, and returns the rendered HTML inline.
    """
    api_key = _get_api_key(request)
    session = create_session(api_key)

    scans = fetch_vulnerability_scans(session, owner, repo, slug)
    if not scans:
        raise HTTPException(status_code=404, detail="No vulnerability scan available for this package.")

    latest = max(scans, key=lambda s: s.get("created_at", ""))
    scan_id = latest.get("identifier") or latest.get("slug_perm") or latest.get("id")

    details: dict = {}
    if scan_id:
        details = fetch_scan_details(session, owner, repo, slug, str(scan_id)) or {}
    if not details:
        details = latest

    payload = json.dumps({"data": details}).encode("utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        out_path = os.path.join(tmp, "report.html")
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "vulnly", "-", "--source", "cloudsmith", "-o", out_path],
                input=payload,
                capture_output=True,
                timeout=60,
                check=False,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail=f"vulnly is not installed: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail="vulnly report generation timed out.") from exc

        if proc.returncode != 0 or not os.path.exists(out_path):
            err = proc.stderr.decode("utf-8", errors="replace")[:1000]
            log.warning("vulnly failed (rc=%s): %s", proc.returncode, err)
            raise HTTPException(status_code=500, detail=f"vulnly failed: {err.strip() or 'unknown error'}")

        with open(out_path, "rb") as f:
            html = f.read()

    return Response(content=html, media_type="text/html; charset=utf-8")


# ──────────────────────────────────────────────────────────────
#  Organisation-level graph
# ──────────────────────────────────────────────────────────────

def _build_org_graph(api_key: str, owner: str) -> dict:
    """Build an org-level access graph: repos, members, services, entitlements."""
    session = create_session(api_key)

    repos = fetch_repos(session, owner)
    members = fetch_org_members(session, owner)
    services = fetch_org_services(session, owner)
    teams = fetch_org_teams(session, owner)

    nodes: list[dict] = []
    edges: list[dict] = []
    seen: set[str] = set()

    # Org node
    org_id = f"org:{owner}"
    nodes.append({"id": org_id, "label": owner, "type": "org", "data": {}})
    seen.add(org_id)

    # Repo nodes
    repo_slugs: list[str] = []
    for r in repos:
        slug = r.get("slug", "")
        if not slug:
            continue
        repo_slugs.append(slug)
        rid = f"repo:{slug}"
        if rid in seen:
            continue
        seen.add(rid)
        nodes.append({
            "id": rid,
            "label": r.get("name", slug),
            "type": "repo",
            "data": {
                "description": r.get("description", ""),
                "package_count": r.get("package_count", 0),
                "repo_type": r.get("repository_type_str", r.get("type_str", "")),
                "slug": slug,
            },
        })
        edges.append({"source": org_id, "target": rid, "type": "org_repo", "label": ""})

    # Member nodes
    for m in members:
        user = m.get("user", "")
        slug = m.get("slug", user)
        mid = f"user:{slug}"
        if mid in seen:
            continue
        seen.add(mid)
        role = m.get("role", "Unknown")
        nodes.append({
            "id": mid,
            "label": m.get("user_name", slug),
            "type": "user",
            "data": {
                "role": role,
                "email": m.get("email", ""),
                "is_active": m.get("is_active", True),
                "has_two_factor": m.get("has_two_factor", False),
                "joined_at": m.get("joined_at", ""),
                "slug": slug,
            },
        })
        edges.append({"source": mid, "target": org_id, "type": "member_org", "label": role})

    # Service account nodes
    for s in services:
        name = s.get("name", "")
        slug = s.get("slug", name)
        sid = f"service:{slug}"
        if sid in seen:
            continue
        seen.add(sid)
        role = s.get("role", "Unknown")
        nodes.append({
            "id": sid,
            "label": name or slug,
            "type": "service",
            "data": {
                "role": role,
                "description": s.get("description", ""),
                "created_at": s.get("created_at", ""),
                "slug": slug,
                "teams": [t.get("name", t.get("slug", "")) for t in s.get("teams", [])],
            },
        })
        edges.append({"source": sid, "target": org_id, "type": "service_org", "label": role})

    # Team nodes
    team_slugs: list[str] = []
    for t in teams:
        name = t.get("name", "")
        slug = t.get("slug", name)
        team_slugs.append(slug)
        tid = f"team:{slug}"
        if tid in seen:
            continue
        seen.add(tid)
        nodes.append({
            "id": tid,
            "label": name or slug,
            "type": "team",
            "data": {
                "slug": slug,
                "description": t.get("description", ""),
                "created_at": t.get("created_at", ""),
            },
        })
        edges.append({"source": tid, "target": org_id, "type": "team_org", "label": ""})

    # Link services → teams (from service's "teams" field)
    for s in services:
        s_slug = s.get("slug", s.get("name", ""))
        sid = f"service:{s_slug}"
        for st in s.get("teams", []):
            t_slug = st.get("slug", st.get("name", ""))
            tid = f"team:{t_slug}"
            if tid in seen:
                edges.append({"source": sid, "target": tid, "type": "team_member", "label": "service"})

    # Fetch team members in parallel and create membership edges
    MAX_WORKERS = 20

    def _fetch_team_members(team_slug: str) -> tuple[str, list[dict]]:
        members_list = fetch_team_members(session, owner, team_slug)
        return (team_slug, members_list)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        team_futures = [pool.submit(_fetch_team_members, ts) for ts in team_slugs]
        for fut in as_completed(team_futures):
            t_slug, t_members = fut.result()
            tid = f"team:{t_slug}"
            for tm in t_members:
                # Team members can be users or services.
                # The API may return a flat slug or a nested user/service object.
                user_obj = tm.get("user")
                if isinstance(user_obj, dict):
                    user_slug = user_obj.get("slug", user_obj.get("slug_perm", ""))
                else:
                    user_slug = tm.get("slug", tm.get("user", ""))
                if not user_slug:
                    continue
                # Try matching as user first, then as service
                uid = f"user:{user_slug}"
                sid = f"service:{user_slug}"
                if uid in seen:
                    role = tm.get("role", "")
                    edges.append({"source": uid, "target": tid, "type": "team_member", "label": role})
                elif sid in seen:
                    edges.append({"source": sid, "target": tid, "type": "team_member", "label": "service"})

    # Fetch privileges, entitlements, and upstreams for each repo (parallel)
    MAX_WORKERS = 20

    def _fetch_priv(repo_slug: str) -> tuple[str, dict, list[dict], list[dict]]:
        privs = fetch_repo_privileges(session, owner, repo_slug)
        ents = fetch_repo_entitlements(session, owner, repo_slug)
        ups = fetch_repo_upstreams(session, owner, repo_slug)
        return (repo_slug, privs, ents, ups)

    # Track upstream URLs → which repos use them (for shared-upstream edges)
    upstream_url_repos: dict[str, list[str]] = {}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(_fetch_priv, rs) for rs in repo_slugs]
        for fut in as_completed(futures):
            repo_slug, privs, ents, ups = fut.result()
            rid = f"repo:{repo_slug}"

            # Normalise privileges into a flat list of entries.
            # After unwrapping in fetch_repo_privileges, privs should be a list of
            # {privilege, user?, service?, team?} objects, or a legacy dict with
            # "users", "teams", "services" sub-keys.
            priv_entries: list[dict] = []
            if isinstance(privs, list):
                priv_entries = privs
            elif isinstance(privs, dict):
                for priv_key in ("users", "teams", "services"):
                    items = privs.get(priv_key) or privs.get("permissions", {}).get(priv_key, [])
                    if isinstance(items, list):
                        for item in items:
                            item["_priv_key"] = priv_key
                        priv_entries.extend(items)

            for item in priv_entries:
                permission = item.get("privilege", item.get("role", item.get("permission", "Read")))

                # Determine the entity type and slug from the entry
                priv_key = item.get("_priv_key", "")
                user_obj = item.get("user")
                service_obj = item.get("service")
                team_obj = item.get("team")

                item_id = ""
                if priv_key == "users" or user_obj:
                    if isinstance(user_obj, dict):
                        item_slug = user_obj.get("slug", user_obj.get("slug_perm", ""))
                    elif isinstance(user_obj, str):
                        item_slug = user_obj
                    else:
                        item_slug = item.get("slug", item.get("user", ""))
                    item_id = f"user:{item_slug}"
                elif priv_key == "services" or service_obj:
                    if isinstance(service_obj, dict):
                        item_slug = service_obj.get("slug", service_obj.get("slug_perm", ""))
                        item_name = service_obj.get("name", item_slug)
                    elif isinstance(service_obj, str):
                        item_slug = service_obj
                        item_name = service_obj
                    else:
                        item_slug = item.get("slug", item.get("name", ""))
                        item_name = item.get("name", item_slug)
                    item_id = f"service:{item_slug}"
                elif priv_key == "teams" or team_obj:
                    if isinstance(team_obj, dict):
                        item_slug = team_obj.get("slug", team_obj.get("slug_perm", ""))
                        item_name = team_obj.get("name", item_slug)
                    elif isinstance(team_obj, str):
                        item_slug = team_obj
                        item_name = team_obj
                    else:
                        item_slug = item.get("slug", item.get("name", ""))
                        item_name = item.get("name", item_slug)
                    item_id = f"team:{item_slug}"
                    if item_id not in seen:
                        seen.add(item_id)
                        nodes.append({
                            "id": item_id,
                            "label": item_name,
                            "type": "team",
                            "data": {"slug": item_slug},
                        })
                else:
                    continue

                if item_id and item_id in seen:
                    edges.append({
                        "source": item_id,
                        "target": rid,
                        "type": "access",
                        "label": permission,
                    })

            # Entitlement tokens
            for ent in ents:
                ent_name = ent.get("name", "token")
                ent_slug = ent.get("slug_perm", ent.get("slug", ""))
                eid = f"entitlement:{repo_slug}:{ent_slug}"
                if eid not in seen:
                    seen.add(eid)
                    nodes.append({
                        "id": eid,
                        "label": ent_name,
                        "type": "entitlement",
                        "data": {
                            "is_active": ent.get("is_active", True),
                            "limit_num_downloads": ent.get("limit_num_downloads"),
                            "limit_package_query": ent.get("limit_package_query", ""),
                            "created_at": ent.get("created_at", ""),
                            "slug": ent_slug,
                        },
                    })
                edges.append({"source": eid, "target": rid, "type": "entitlement_repo", "label": ""})

            # Upstream proxy/cache sources
            for up in ups:
                up_url = up.get("upstream_url", "")
                up_name = up.get("name", up_url)
                up_fmt = up.get("_format", "")
                up_mode = up.get("mode", "")
                up_active = up.get("is_active", True)
                # Use the URL as the canonical node ID so shared upstreams merge
                uid = f"upstream:{up_url}"
                if uid not in seen:
                    seen.add(uid)
                    nodes.append({
                        "id": uid,
                        "label": up_name or up_url,
                        "type": "upstream",
                        "data": {
                            "upstream_url": up_url,
                            "format": up_fmt,
                            "mode": up_mode,
                            "is_active": up_active,
                            "verify_ssl": up.get("verify_ssl", True),
                            "priority": up.get("priority", 0),
                            "created_at": up.get("created_at", ""),
                        },
                    })
                edges.append({
                    "source": rid,
                    "target": uid,
                    "type": "repo_upstream",
                    "label": f"{up_fmt} ({up_mode})" if up_mode else up_fmt,
                })
                # Track for shared-upstream detection
                upstream_url_repos.setdefault(up_url, []).append(repo_slug)

    # Add shared-upstream edges between repos that share the same upstream URL
    for up_url, repo_list in upstream_url_repos.items():
        if len(repo_list) < 2:
            continue
        uid = f"upstream:{up_url}"
        # Create edges between each pair of repos sharing this upstream
        for i in range(len(repo_list)):
            for j in range(i + 1, len(repo_list)):
                edges.append({
                    "source": f"repo:{repo_list[i]}",
                    "target": f"repo:{repo_list[j]}",
                    "type": "shared_upstream",
                    "label": up_url,
                })

    total_upstreams = sum(1 for n in nodes if n["type"] == "upstream")
    shared_upstream_count = sum(1 for url, repos in upstream_url_repos.items() if len(repos) > 1)

    stats = {
        "total_repos": len(repo_slugs),
        "total_members": len(members),
        "total_services": len(services),
        "total_teams": len(teams),
        "total_upstreams": total_upstreams,
        "shared_upstreams": shared_upstream_count,
        "total_nodes": len(nodes),
        "total_edges": len(edges),
    }

    return {"owner": owner, "nodes": nodes, "edges": edges, "stats": stats}


@app.get("/api/org-graph")
def get_org_graph(owner: str, request: Request):
    api_key = _get_api_key(request)
    if not owner:
        raise HTTPException(status_code=400, detail="owner is required")

    cache_key = f"org:{owner}"
    if cache_key in _cache and time.time() - _cache[cache_key]["ts"] < CACHE_TTL:
        return _cache[cache_key]["data"]

    result = _build_org_graph(api_key, owner)
    _cache[cache_key] = {"data": result, "ts": time.time()}
    return result
