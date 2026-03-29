"""Artigraphly backend – FastAPI service that fetches Cloudsmith data."""

from __future__ import annotations

import logging
import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from cloudsmith import (
    SEVERITY_RANK,
    create_session,
    fetch_all_packages,
    fetch_dependencies,
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
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("artigraphly.api")

app = FastAPI(title="Artigraphly API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory cache
_cache: dict[str, dict] = {}
CACHE_TTL = 300  # 5 minutes


def _get_config():
    api_key = os.getenv("CLOUDSMITH_API_KEY", "")
    owner = os.getenv("CLOUDSMITH_OWNER", "")
    repo = os.getenv("CLOUDSMITH_REPO", "")
    if not api_key or not owner or not repo:
        raise HTTPException(
            status_code=500,
            detail="Missing CLOUDSMITH_API_KEY, CLOUDSMITH_OWNER, or CLOUDSMITH_REPO in .env",
        )
    return api_key, owner, repo


@app.get("/api/config")
def get_config():
    _, owner, repo = _get_config()
    return {"owner": owner, "repo": repo}


@app.get("/api/health")
def health():
    return {"status": "ok"}


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

    for pkg in packages:
        slug = pkg["slug_perm"]
        name = pkg["name"]
        version = pkg.get("version", "")
        node_id = f"{name}@{version}" if version else name
        downloads = pkg.get("downloads", 0)
        scan_status = pkg.get("security_scan_status", "Unknown")

        log.info("Scanning %s", node_id)
        max_sev, vuln_count, vulns = get_package_vulnerabilities(session, owner, repo, slug)

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
            ),
        ))
        edges.append(GraphEdge(source=repo_id, target=node_id, type="repo_package"))
        slug_to_id[slug] = node_id

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

    # Dependency edges
    for slug, src_id in slug_to_id.items():
        log.info("Fetching deps for %s", src_id)
        deps = fetch_dependencies(session, owner, repo, slug)
        existing_ids = {n.id for n in nodes}
        for dep in deps:
            dep_name = dep.get("name", dep.get("identifier", "unknown"))
            if dep_name not in existing_ids:
                nodes.append(GraphNode(id=dep_name, label=dep_name, type="dependency", data=NodeData()))
                existing_ids.add(dep_name)
            edges.append(GraphEdge(source=src_id, target=dep_name, type="dependency"))

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
def get_graph():
    api_key, owner, repo = _get_config()
    cache_key = f"{owner}/{repo}"

    if cache_key in _cache and time.time() - _cache[cache_key]["ts"] < CACHE_TTL:
        log.info("Returning cached graph for %s", cache_key)
        return _cache[cache_key]["data"]

    log.info("Building graph for %s/%s", owner, repo)
    result = _build_graph(api_key, owner, repo)
    _cache[cache_key] = {"data": result, "ts": time.time()}
    return result


@app.post("/api/graph/refresh", response_model=GraphResponse)
def refresh_graph():
    api_key, owner, repo = _get_config()
    cache_key = f"{owner}/{repo}"
    log.info("Force-refreshing graph for %s/%s", owner, repo)
    result = _build_graph(api_key, owner, repo)
    _cache[cache_key] = {"data": result, "ts": time.time()}
    return result
