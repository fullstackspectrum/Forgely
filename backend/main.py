"""Forgely backend – FastAPI service that fetches Cloudsmith data."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import tempfile
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from cloudsmith import (
    APP_VERSION,
    DEPENDENCY_DENYLIST_ENV,
    DISABLE_SHORTCIRCUIT_ENV,
    SEVERITY_RANK,
    create_session,
    dependency_denylist,
    fetch_all_packages,
    fetch_dependencies,
    fetch_namespaces,
    fetch_package,
    fetch_org_members,
    fetch_org_services,
    fetch_org_teams,
    fetch_repo_entitlements,
    fetch_repo_connected,
    fetch_repo_privileges,
    fetch_repo_upstreams,
    fetch_repos,
    fetch_scan_details,
    fetch_team_members,
    fetch_vulnerability_scans,
    get_package_vulnerabilities,
    scan_workers,
)
from models import (
    CVERecord,
    GraphEdge,
    GraphNode,
    GraphResponse,
    GraphStats,
    NodeData,
    PackageDetail,
    RepoConnection,
    WorkspaceCveSummary,
    WorkspaceOverviewResponse,
    WorkspaceRepoSummary,
)
from cache import ScanCache, cache_enabled
from compression import StreamingGZipMiddleware
from perfstats import BuildTimer, format_report, get_stats, payload_bytes_enabled

# Load .env from the project root (one level up)
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
load_dotenv(_env_path, override=True)

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("forgely.api")

# Performance baselining (docs/performance-design.md, Tier 0). Given its own
# logger at INFO so the stats block is visible without turning on INFO for
# everything else — the root logger stays at WARNING.
perf_log = logging.getLogger("forgely.perf")
perf_log.setLevel(logging.INFO)

# Snapshot of the most recent build per cache key, exposed via ?debug=1.
# Deliberately kept out of _cache so cached graph payloads never carry stale
# timing data.
_last_perf: dict[str, dict] = {}
_perf_lock = threading.Lock()

# Persistent scan cache (perf/05). Lazily created so cache_enabled() and the
# path override are read *after* load_dotenv, and shared across builds so the
# SQLite connection is opened once rather than per request.
_scan_cache: ScanCache | None = None
_scan_cache_lock = threading.Lock()


def _get_scan_cache() -> ScanCache | None:
    global _scan_cache
    if not cache_enabled():
        return None
    if _scan_cache is None:
        with _scan_cache_lock:
            if _scan_cache is None:
                try:
                    _scan_cache = ScanCache()
                    # Delete-on-write keeps one row per package in steady
                    # state; this clears anything orphaned by a crash between
                    # the DELETE and the INSERT.
                    pruned = _scan_cache.prune(max_age_days=CACHE_PRUNE_DAYS)
                    log.info("Scan cache at %s (%d entries, %.1f MB, %d pruned)",
                             _scan_cache.path, _scan_cache.entry_count(),
                             _scan_cache.size_bytes() / 1024 / 1024, pruned)
                except Exception as exc:  # a broken cache must never fail a build
                    log.warning("Scan cache unavailable (%s) – continuing without it", exc)
                    return None
    return _scan_cache


def _record_perf(key: str, label: str, session, timer: BuildTimer, extra: dict,
                 cache: dict | None = None) -> dict | None:
    """Log the stats block for one build and retain it for ?debug=1."""
    stats = get_stats(session)
    if stats is None:
        return None
    perf_log.info(format_report(label, stats, timer.elapsed, extra, cache))
    snapshot = stats.snapshot()
    snapshot["cache"] = cache
    snapshot["wall_seconds"] = round(timer.elapsed, 2)
    snapshot["result"] = extra
    with _perf_lock:
        _last_perf[key] = snapshot
    return snapshot


app = FastAPI(title="Forgely API", version=APP_VERSION)

_allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Graph payloads are large and highly repetitive: 4.2 MB for neuro-packages and
# 29.2 MB for neuro-containers, whose 21,598 CVE descriptions repeat across
# every package sharing a CVE. minimum_size keeps it off the many small JSON
# replies where a round of deflate buys nothing.
#
# StreamingGZipMiddleware rather than Starlette's: see compression.py. The
# stock one buffers streamed chunks inside zlib, which would hold every
# progress frame until the build ends.
app.add_middleware(StreamingGZipMiddleware, minimum_size=1000)

# Simple in-memory cache
_cache: dict[str, dict] = {}
CACHE_TTL = 300          # 5 minutes (per-repo graphs)
WORKSPACE_CACHE_TTL = 600  # 10 minutes (workspace overview)

# Package-list cache (perf/05). With scan results cached persistently, the
# package list is what a warm rebuild actually spends its time on: ~15s of the
# ~16s on a 10k-package repo.
#
# It is deliberately LONGER-lived than the graph cache. A shorter TTL could
# never help — any request that finds the graph cache expired would find this
# expired too, so the windows would never line up. Longer means a rebuild just
# past CACHE_TTL reuses the list and completes in ~1s instead of ~16s.
#
# The cost is staleness: a package uploaded within the window is not seen. That
# is bounded, and already no worse than the graph cache users live with today.
# An explicit refresh bypasses it entirely.
PACKAGE_LIST_TTL = int(os.getenv("FORGELY_PACKAGE_LIST_TTL", "900"))

# Age-based sweep of the persistent cache on open, for rows orphaned by a crash.
CACHE_PRUNE_DAYS = float(os.getenv("FORGELY_CACHE_PRUNE_DAYS", "90"))

# Largest shared-CVE clique that still gets pairwise edges.
#
# Shared-CVE edges are built by connecting every pair of packages carrying the
# same CVE, which is O(k²) in the size of the clique. In practice the pair
# deduplication downstream already absorbs this: neuro-containers generates
# 67,515 pairs and emits 741 distinct edges, because the same package pairs
# share many CVEs. Largest clique observed anywhere is 33.
#
# What deduplication cannot absorb is one CVE spanning a large fraction of a
# large repo — a base-image or libc advisory across thousands of packages,
# where the pairs really are distinct:
#
#     packages sharing one CVE    distinct edges    build time
#                          200            19,900           5ms
#                          500           124,750          29ms
#                        1,000           499,500         111ms
#                        2,000         1,999,000         556ms
#
# A single CVE contributing half a million edges would dominate the payload and
# the render for no analytical benefit — the packages all carry the CVE in
# their own `cves` list either way. 100 caps one CVE's contribution at 4,950
# edges while leaving 3x headroom over anything measured, so this changes
# nothing on real data. Set to 0 to disable the guard.
MAX_CVE_CLIQUE = int(os.getenv("FORGELY_MAX_CVE_CLIQUE", "100"))

# The in-memory graph cache held every graph, workspace overview and org graph
# ever requested, for the life of the process, with no eviction — a 10k-package
# graph is ~4 MB, so browsing a workspace of repos leaked steadily. Entries are
# unreadable past WORKSPACE_CACHE_TTL anyway, so sweep them on write and cap
# the total.
_MAX_CACHE_ENTRIES = 32


def _cache_put(key: str, data) -> None:
    """Store a built artefact, evicting expired and then oldest entries."""
    now = time.time()
    _cache[key] = {"data": data, "ts": now}
    dead = [k for k, v in _cache.items() if now - v["ts"] > WORKSPACE_CACHE_TTL]
    for k in dead:
        _cache.pop(k, None)
    if len(_cache) > _MAX_CACHE_ENTRIES:
        for k, _v in sorted(_cache.items(), key=lambda kv: kv[1]["ts"])[
            : len(_cache) - _MAX_CACHE_ENTRIES
        ]:
            _cache.pop(k, None)


_pkg_list_cache: dict[str, dict] = {}
_pkg_list_lock = threading.Lock()


def _fetch_packages_cached(session, owner: str, repo: str, refresh: bool = False,
                           on_page=None) -> list[dict]:
    """fetch_all_packages, with a short-lived in-memory cache.

    In-memory rather than SQLite on purpose: this is the one volatile input in
    the build, and persisting it across restarts would trade away the freshness
    that makes it safe to cache at all.
    """
    key = f"{owner}/{repo}"
    if not refresh:
        with _pkg_list_lock:
            entry = _pkg_list_cache.get(key)
        if entry and time.time() - entry["ts"] < PACKAGE_LIST_TTL:
            log.info("Package list for %s served from cache (%d packages)", key, len(entry["data"]))
            return entry["data"]
    packages = fetch_all_packages(session, owner, repo, on_page=on_page)
    now = time.time()
    with _pkg_list_lock:
        _pkg_list_cache[key] = {"data": packages, "ts": now}
        # Bounded alongside the graph cache: package lists are large, and a
        # workspace browse would otherwise retain one per repo visited.
        for k in [k for k, v in _pkg_list_cache.items() if now - v["ts"] > PACKAGE_LIST_TTL]:
            _pkg_list_cache.pop(k, None)
    return packages


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


@app.get("/api/changelog")
def get_changelog():
    changelog_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "CHANGELOG.md")
    try:
        with open(changelog_path, encoding="utf-8") as f:
            return {"content": f.read()}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Changelog not found")


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


# CVE descriptions are stripped from the wire, not from the model.
#
# They are 21.5 MB of neuro-containers' 29.2 MB payload — 21,598 records of
# which only the handful in an expanded node are ever read — and /api/cve
# serves them per package instead.
#
# Excluded at serialisation rather than dropped from CVERecord because the
# in-memory objects are shared: _extract_repo_summary_from_graph reads
# descriptions off cached GraphResponse objects, and /api/cve answers from the
# same cache without touching the API.
GRAPH_EXCLUDE_DESCRIPTIONS = {
    "nodes": {"__all__": {"data": {"cves": {"__all__": {"description"}}}}}
}


def _graph_payload(result: GraphResponse) -> dict:
    """Encode a graph for the wire, minus CVE descriptions."""
    return jsonable_encoder(result, exclude=GRAPH_EXCLUDE_DESCRIPTIONS)


def _cve_records(vulns: list[dict]) -> list[CVERecord]:
    """Normalise Cloudsmith vulnerability entries into CVERecords.

    Extracted from _build_graph so /api/cve can produce byte-identical records
    when it has to fall back to the API — the field-name fallbacks below are
    load-bearing and duplicating them would let the two paths drift.
    """
    records: list[CVERecord] = []
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

        records.append(CVERecord(
            id=cve_id, severity=v_sev, description=description,
            url=api_url, nvd_url=nvd_url, ghsa_url=ghsa_url,
            affected=affected, affected_version=affected_version, fixed_in=fixed_in,
        ))
    return records


def _build_graph(api_key: str, owner: str, repo: str, refresh: bool = False,
                 on_progress=None) -> GraphResponse:
    """Fetch Cloudsmith data and build the graph response.

    *refresh* forces a fresh package list; scan results are still reused, since
    those are keyed on the scan timestamp and cannot go stale.

    *on_progress(phase, done, total)* reports build progress for the streaming
    endpoint. Frames are throttled to ~100 per phase — a 7,490-package build
    would otherwise emit thousands, and the client only needs enough to move a
    progress bar smoothly.
    """
    def _progress(phase: str, done: int, total: int) -> None:
        if on_progress:
            on_progress(phase, done, total)

    def _throttled(phase: str, total: int):
        step = max(1, total // 100)
        def report(done: int) -> None:
            if done == total or done % step == 0:
                _progress(phase, done, total)
        return report

    timer = BuildTimer()
    session = create_session(api_key)
    packages = _fetch_packages_cached(
        session, owner, repo, refresh=refresh,
        on_page=lambda done, total: _progress("packages", done, total),
    )

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
    slug_to_fmt: dict[str, str] = {}  # instrumentation only (see perf/02)
    _stats = get_stats(session)
    for pkg in packages:
        slug = pkg["slug_perm"]
        name = pkg.get("name") or pkg.get("slug_perm") or ""
        version = pkg.get("version") or ""
        node_id = f"{name}@{version}" if version else (name or slug)
        slug_to_fmt[slug] = pkg.get("format", "") or ""

        if node_id in seen_ids:
            slug_to_id.setdefault(slug, node_id)
            continue

        # Recorded post-dedup so the histogram totals match the packages that
        # actually receive a scan call (see perf/01).
        if _stats:
            _stats.record_scan_status(pkg.get("security_scan_status") or "")
        seen_ids.add(node_id)
        slug_to_id[slug] = node_id

        # perf/01: packages whose format cannot be scanned return an empty scan
        # list, so the call is pure waste — 74.8% of packages on neuro-packages
        # (docs/performance-design.md §8.4). Flagged here but NOT acted on yet;
        # pkg_metas must stay complete so every package still becomes a node.
        #
        # Only "not supported" is treated as skippable. "Awaiting" is
        # deliberately excluded: skipping it would fall through to the
        # "Scanned (Clean)" branch below and colour a pending package green,
        # and §8.4 measured zero packages in that state anyway.
        raw_status = (pkg.get("security_scan_status") or "").lower()
        scannable = "not supported" not in raw_status

        pkg_metas.append({
            "pkg": pkg, "slug": slug, "name": name, "version": version,
            "node_id": node_id, "scannable": scannable,
            # perf/05 cache key. Moves when Cloudsmith re-scans, so a changed
            # scan invalidates itself without any TTL.
            "scan_completed_at": pkg.get("security_scan_completed_at") or "",
        })

    # --- Parallel vulnerability scanning ---
    MAX_WORKERS = scan_workers()

    scan_cache = _get_scan_cache()
    # Counters are cumulative on the shared cache, so snapshot here and diff
    # at the end — otherwise the block would report every build ever run.
    _cache_before = scan_cache.stats() if scan_cache else None

    def _scan_vuln(meta: dict) -> tuple[dict, str | None, int, list[dict]]:
        slug = meta["slug"]
        completed_at = meta["scan_completed_at"]
        if scan_cache is not None:
            cached = scan_cache.get(owner, repo, slug, completed_at)
            if cached is not None:
                return (meta, *cached)
        result = get_package_vulnerabilities(session, owner, repo, slug)
        if scan_cache is not None:
            scan_cache.put(owner, repo, slug, completed_at, result)
        return (meta, *result)

    vuln_results: dict[str, tuple[str | None, int, list[dict]]] = {}

    # Seed unscannable packages with the exact tuple the API produces for them:
    # their scan list comes back empty, so get_package_vulnerabilities
    # early-returns (None, 0, []). Substituting it directly is therefore
    # byte-identical — verified in §8.4, where all 5,603 unsupported packages
    # triggered zero detail fetches, which only happens on that early return.
    #
    # Note this narrows only what is submitted. pkg_metas is iterated in full
    # below, so every package still becomes a node.
    scannable_metas: list[dict] = []
    for meta in pkg_metas:
        if meta["scannable"]:
            scannable_metas.append(meta)
        else:
            vuln_results[meta["node_id"]] = (None, 0, [])

    _scan_report = _throttled("scanning", len(scannable_metas))
    _progress("scanning", 0, len(scannable_metas))
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_scan_vuln, m): m for m in scannable_metas}
        for _scan_done, fut in enumerate(as_completed(futures), 1):
            meta, max_sev, vuln_count, vulns = fut.result()
            vuln_results[meta["node_id"]] = (max_sev, vuln_count, vulns)
            _scan_report(_scan_done)

    cache_delta: dict | None = None
    if scan_cache is not None:
        scan_cache.commit()
        after = scan_cache.stats()
        hits = after["hits"] - _cache_before["hits"]
        misses = after["misses"] - _cache_before["misses"]
        looked_up = hits + misses
        cache_delta = {
            "hits": hits,
            "misses": misses,
            "writes": after["writes"] - _cache_before["writes"],
            "unkeyable": after["unkeyable"] - _cache_before["unkeyable"],
            "hit_rate": round(100 * hits / looked_up, 1) if looked_up else 0.0,
            "entries": scan_cache.entry_count(),
            "size_mb": round(scan_cache.size_bytes() / 1024 / 1024, 1),
        }

    shortcircuit_suspects: list[str] = []
    for meta in pkg_metas:
        pkg = meta["pkg"]
        slug = meta["slug"]
        name = meta["name"]
        version = meta["version"]
        node_id = meta["node_id"]

        downloads = pkg.get("downloads", 0)
        scan_status = pkg.get("security_scan_status", "Unknown")

        max_sev, vuln_count, vulns = vuln_results[node_id]

        # perf/03 guard. The short-circuit trusts the scan's
        # num_vulnerabilities; the package's own security_scan_status is an
        # independent signal for the same fact. When the package says
        # vulnerabilities were detected but the scan resolved to clean, the
        # short-circuit may have hidden a finding — the one failure mode the
        # escape hatch exists to rule out.
        #
        # Note what this can and cannot do: it cannot prove a skipped fetch
        # would have returned nothing (that would require making the call), but
        # it catches the disagreement for free, on every build, across every
        # package — which sampling could not.
        if (
            "detected vulnerabilities" in (pkg.get("security_scan_status") or "").lower()
            and vuln_count == 0
            and max_sev in (None, "None")
        ):
            shortcircuit_suspects.append(node_id)

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

        cve_records = _cve_records(vulns)
        for record in cve_records:
            if record.id:
                cve_to_packages.setdefault(record.id, []).append(node_id)

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

    if shortcircuit_suspects:
        log.warning(
            "%d package(s) report 'Scan Detected Vulnerabilities' but resolved to clean — "
            "the scan-detail short-circuit may be hiding findings. Re-run with %s=1 and diff "
            "the graph to confirm. First few: %s",
            len(shortcircuit_suspects),
            DISABLE_SHORTCIRCUIT_ENV,
            ", ".join(shortcircuit_suspects[:5]),
        )

    # Shared-CVE edges
    seen_pairs: set[tuple[str, str]] = set()
    oversized_cliques: list[tuple[str, int]] = []
    for cve_id, pkg_ids in cve_to_packages.items():
        # A package listing the same CVE twice would otherwise pair with
        # itself and emit a self-loop. Not observed on any repo measured, but
        # nothing prevents it. dict.fromkeys keeps first-seen order, so edge
        # ordering is unchanged.
        pkg_ids = list(dict.fromkeys(pkg_ids))
        if len(pkg_ids) < 2:
            continue
        if MAX_CVE_CLIQUE and len(pkg_ids) > MAX_CVE_CLIQUE:
            oversized_cliques.append((cve_id, len(pkg_ids)))
            continue
        for i in range(len(pkg_ids)):
            for j in range(i + 1, len(pkg_ids)):
                a, b = pkg_ids[i], pkg_ids[j]
                pair = (min(a, b), max(a, b))
                if pair not in seen_pairs:
                    edges.append(GraphEdge(source=a, target=b, type="shared_cve", label=cve_id))
                    seen_pairs.add(pair)

    # Loud, because this drops edges the graph would otherwise draw. Aggregated
    # to one record: a workspace tripping this would trip it many times over.
    if oversized_cliques:
        oversized_cliques.sort(key=lambda kv: -kv[1])
        suppressed = sum(k * (k - 1) // 2 for _, k in oversized_cliques)
        log.warning(
            "%d CVE(s) span more than %d packages; shared-CVE edges suppressed for them "
            "(~%d edge(s) avoided). Affected packages still carry the CVE in their own "
            "record. Largest: %s. Raise or disable with %s.",
            len(oversized_cliques),
            MAX_CVE_CLIQUE,
            suppressed,
            ", ".join(f"{cve}={k}" for cve, k in oversized_cliques[:3]),
            "FORGELY_MAX_CVE_CLIQUE",
        )

    # --- Parallel dependency fetching ---
    # Skip formats measured never to return dependency data (perf/02). Resolved
    # once per build rather than per package — dependency_denylist() reads the
    # environment on every call. Packages with an unknown or empty format are
    # NOT skipped, so the failure mode is a wasted call, never a missing edge.
    # Also de-duplicate by node_id. slug_to_id holds one entry per slug_perm,
    # but several slugs can share a name@version (e.g. the same package built
    # for multiple architectures). Fetching each of them separately not only
    # wastes calls, it appends the *same* dependency edge once per sibling —
    # the edge list below has no dedup of its own.
    denylist = dependency_denylist()
    seen_src: set[str] = set()
    dep_items: list[tuple[str, str]] = []
    skipped_by_fmt: dict[str, int] = {}
    for slug, src_id in slug_to_id.items():
        fmt = slug_to_fmt.get(slug, "").lower()
        if fmt in denylist:
            skipped_by_fmt[fmt] = skipped_by_fmt.get(fmt, 0) + 1
            continue
        if src_id in seen_src:
            continue
        seen_src.add(src_id)
        dep_items.append((slug, src_id))

    # Keep the gating assumption visible. Aggregated to one record per build —
    # per-package logging would emit >10k lines on a large repo. WARNING rather
    # than INFO because the root logger sits at WARNING, so anything quieter is
    # invisible by default, and a denylist that is silently wrong loses
    # dependency edges without trace.
    if skipped_by_fmt:
        log.warning(
            "Dependency fetch skipped for %d package(s) by format denylist "
            "[%s]; %d fetch(es) queued. Override with %s (empty disables gating).",
            sum(skipped_by_fmt.values()),
            ", ".join(f"{f}={n}" for f, n in sorted(skipped_by_fmt.items(), key=lambda kv: -kv[1])),
            len(dep_items),
            DEPENDENCY_DENYLIST_ENV,
        )

    def _fetch_dep(item: tuple[str, str]) -> tuple[str, list[dict]]:
        slug, src_id = item
        return (src_id, fetch_dependencies(session, owner, repo, slug, slug_to_fmt.get(slug, "")))

    _dep_report = _throttled("dependencies", len(dep_items))
    _progress("dependencies", 0, len(dep_items))
    # Fetch concurrently, but fold into the graph afterwards in a fixed order.
    #
    # Building inside the as_completed loop made two things depend on thread
    # scheduling. Node and edge ordering varied run to run, and a dependency
    # node — keyed on name alone — took its version from whichever parent
    # finished first, so `ruby` reported >=3.1.0, >=3.0 or >=2.6.0 across three
    # identical builds. Raising the worker count in perf/12 made it routine.
    #
    # Nothing was lost (each edge carries its own constraint), but a graph that
    # differs between identical runs breaks the A/B diff every branch here is
    # verified with.
    dep_results: dict[str, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        dep_futures = [pool.submit(_fetch_dep, item) for item in dep_items]
        for _dep_done, fut in enumerate(as_completed(dep_futures), 1):
            _dep_report(_dep_done)
            src_id, deps = fut.result()
            dep_results[src_id] = deps

    dep_nodes: dict[str, GraphNode] = {}
    for _slug, src_id in dep_items:
        for dep in dep_results.get(src_id, []):
            dep_name = dep.get("name", dep.get("identifier", "unknown"))
            dep_operator = dep.get("operator", dep.get("comparator", "")) or ""
            dep_version_num = dep.get("version", dep.get("version_constraint", dep.get("constraints", ""))) or ""
            dep_version = f"{dep_operator}{dep_version_num}" if dep_version_num else ""

            existing = dep_nodes.get(dep_name)
            if existing is not None:
                # Parents disagree about the constraint. Take the lowest by
                # value so the answer does not depend on iteration order
                # either; the authoritative per-parent constraint is the edge
                # label below.
                if dep_version and (not existing.data.version or dep_version < existing.data.version):
                    existing.data.version = dep_version
            elif dep_name not in seen_ids:
                node = GraphNode(id=dep_name, label=dep_name, type="dependency",
                                 data=NodeData(version=dep_version))
                nodes.append(node)
                seen_ids.add(dep_name)
                dep_nodes[dep_name] = node
            # else: the name collides with a package node, which keeps its own
            # data — unchanged from before.

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

    result = GraphResponse(owner=owner, repo=repo, nodes=nodes, edges=edges, stats=graph_stats)

    timer.stop()
    _record_perf(
        f"{owner}/{repo}",
        f"graph {owner}/{repo}",
        session,
        timer,
        {
            "packages": len(pkg_metas),
            "nodes": len(nodes),
            "edges": len(edges),
            "cves": total_cves,
            "bytes": len(result.model_dump_json()) if payload_bytes_enabled() else None,
        },
        cache=cache_delta,
    )
    return result


@app.get("/api/graph", response_model=GraphResponse,
         response_model_exclude=GRAPH_EXCLUDE_DESCRIPTIONS)
def get_graph(
    request: Request,
    owner: str | None = None,
    repo: str | None = None,
    debug: bool = False,
):
    api_key = _get_api_key(request)
    default_owner, default_repo = _get_defaults()
    owner = owner or default_owner
    repo = repo or default_repo
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required")

    cache_key = f"{owner}/{repo}"

    cached = cache_key in _cache and time.time() - _cache[cache_key]["ts"] < CACHE_TTL
    if cached:
        log.info("Returning cached graph for %s", cache_key)
        result = _cache[cache_key]["data"]
    else:
        log.info("Building graph for %s/%s", owner, repo)
        result = _build_graph(api_key, owner, repo)
        _cache_put(cache_key, result)

    if debug:
        # Returning a Response directly bypasses response_model validation,
        # so the normal path keeps its schema while debug gets the extra block.
        with _perf_lock:
            perf = _last_perf.get(cache_key)
        return JSONResponse({
            "graph": _graph_payload(result),
            "cached": cached,
            "perf": perf,
        })
    return result


# A buffering proxy would hold the whole stream and defeat the point entirely.
_NDJSON_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@app.get("/api/graph/stream")
def stream_graph(
    request: Request,
    owner: str | None = None,
    repo: str | None = None,
    refresh: bool = False,
):
    """Build the graph, streaming progress as NDJSON.

    Added alongside /api/graph rather than replacing it: converting that
    endpoint would break its response_model schema and the ?debug=1 path for
    no benefit, and a non-streaming consumer is still the simpler contract.

    Frame types, one JSON object per line:
        {"type":"progress","phase":...,"done":N,"total":M}
        {"type":"graph","data":{...}}          terminal, on success
        {"type":"error","detail":"..."}        terminal, on failure

    This does not make the build faster — it makes a 44.6s cold build legible
    instead of a spinner. Warm builds finish in ~1.5s and simply emit fewer
    frames.
    """
    api_key = _get_api_key(request)
    default_owner, default_repo = _get_defaults()
    owner = owner or default_owner
    repo = repo or default_repo
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required")

    cache_key = f"{owner}/{repo}"
    if not refresh and cache_key in _cache and time.time() - _cache[cache_key]["ts"] < CACHE_TTL:
        cached = _cache[cache_key]["data"]

        def cached_frames():
            yield json.dumps({"type": "progress", "phase": "cached", "done": 1, "total": 1}) + "\n"
            yield json.dumps({"type": "graph", "data": _graph_payload(cached)}) + "\n"

        return StreamingResponse(
            cached_frames(),
            media_type="application/x-ndjson",
            headers=_NDJSON_HEADERS,
        )

    frames: queue.Queue = queue.Queue()

    def worker():
        try:
            result = _build_graph(
                api_key, owner, repo, refresh=refresh,
                on_progress=lambda phase, done, total: frames.put(
                    {"type": "progress", "phase": phase, "done": done, "total": total}
                ),
            )
            _cache_put(cache_key, result)
            frames.put({"type": "graph", "data": _graph_payload(result)})
        except HTTPException as exc:
            frames.put({"type": "error", "detail": exc.detail, "status": exc.status_code})
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as a frame
            log.warning("Streamed build failed for %s: %s", cache_key, exc)
            frames.put({"type": "error", "detail": str(exc), "status": 500})
        finally:
            frames.put(None)

    threading.Thread(target=worker, daemon=True, name=f"build-{cache_key}").start()

    def generate():
        while True:
            frame = frames.get()
            if frame is None:
                break
            yield json.dumps(frame) + "\n"

    return StreamingResponse(
        generate(), media_type="application/x-ndjson", headers=_NDJSON_HEADERS
    )


@app.post("/api/graph/refresh", response_model=GraphResponse,
          response_model_exclude=GRAPH_EXCLUDE_DESCRIPTIONS)
def refresh_graph(request: Request, owner: str | None = None, repo: str | None = None):
    api_key = _get_api_key(request)
    default_owner, default_repo = _get_defaults()
    owner = owner or default_owner
    repo = repo or default_repo
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required")

    cache_key = f"{owner}/{repo}"
    log.info("Force-refreshing graph for %s/%s", owner, repo)
    result = _build_graph(api_key, owner, repo, refresh=True)
    _cache_put(cache_key, result)
    return result


@app.get("/api/cve/{owner}/{repo}/{slug}", response_model=list[CVERecord])
def get_package_cve_details(request: Request, owner: str, repo: str, slug: str):
    """Full CVE records for one package, descriptions included.

    Descriptions are the bulk of the graph payload — 21,598 of them across
    neuro-containers, 21.5 MB of the 29.2 MB — and none are visible until a
    node is selected. They are served here instead so the graph carries only
    what it draws.

    Served from the warm graph cache where possible: the records are already
    in memory, so an expanded node costs no API call at all. The fallback
    exists for a direct link or an expired cache, and goes through the same
    _cve_records() normalisation.
    """
    api_key = _get_api_key(request)
    cache_key = f"{owner}/{repo}"

    entry = _cache.get(cache_key)
    if entry and time.time() - entry["ts"] < CACHE_TTL:
        for node in entry["data"].nodes:
            if node.data.slug == slug:
                return node.data.cves

    session = create_session(api_key)
    try:
        _max_sev, _count, vulns = get_package_vulnerabilities(session, owner, repo, slug)
    except Exception as exc:  # noqa: BLE001 - a missing description must not break the panel
        log.warning("CVE detail fetch failed for %s/%s/%s: %s", owner, repo, slug, exc)
        raise HTTPException(status_code=502, detail="Could not load vulnerability details") from exc
    return _cve_records(vulns)


def _stringify(value) -> str:
    """A scalar the panel can print, or "" when there is nothing to print.

    Cloudsmith returns several of these fields as nested objects — distro is
    {slug, name, ...}, architectures is a list of {name, description} — and the
    panel wants a name, not a shape.
    """
    if value is None or value == "":
        return ""
    if isinstance(value, dict):
        return str(value.get("name") or value.get("slug") or "")
    return str(value)


def _package_detail(pkg: dict) -> PackageDetail:
    """Normalise one Cloudsmith package record for the details panel."""
    distro = _stringify(pkg.get("distro"))
    distro_version = _stringify(pkg.get("distro_version"))

    # Passed through rather than mapped: every format names its own keys, and a
    # fixed mapping would silently drop the ones this build has not seen.
    identifiers = {
        k: _stringify(v)
        for k, v in (pkg.get("identifiers") or {}).items()
        if _stringify(v) and _stringify(v) != "None"
    }

    tags: dict[str, list[str]] = {}
    for category, values in (pkg.get("tags") or {}).items():
        if isinstance(values, list) and values:
            tags[str(category)] = [str(v) for v in values]

    return PackageDetail(
        slug=pkg.get("slug_perm") or pkg.get("identifier_perm") or "",
        name=pkg.get("name") or "",
        version=pkg.get("version") or "",
        format=pkg.get("format") or "",
        filename=pkg.get("filename") or "",
        extension=pkg.get("extension") or "",
        description=pkg.get("description") or "",
        summary=pkg.get("summary") or "",
        uploader=pkg.get("uploader") or "",
        uploaded_at=pkg.get("uploaded_at") or "",
        repository=pkg.get("repository") or "",
        namespace=pkg.get("namespace") or "",
        size=pkg.get("size") or 0,
        num_files=pkg.get("num_files") or 0,
        downloads=pkg.get("downloads") or 0,
        license=pkg.get("license") or "",
        spdx_license=pkg.get("spdx_license") or "",
        checksum_md5=pkg.get("checksum_md5") or "",
        checksum_sha1=pkg.get("checksum_sha1") or "",
        checksum_sha256=pkg.get("checksum_sha256") or "",
        checksum_sha512=pkg.get("checksum_sha512") or "",
        identifiers=identifiers,
        tags=tags,
        architectures=[
            n for n in (_stringify(a) for a in (pkg.get("architectures") or [])) if n
        ],
        distro=f"{distro} {distro_version}".strip(),
        subtype=pkg.get("subtype") or "",
        type_display=pkg.get("type_display") or "",
        epoch=_stringify(pkg.get("epoch")),
        release=_stringify(pkg.get("release")),
        status=pkg.get("status_str") or "",
        stage=pkg.get("stage_str") or "",
        scan_status=pkg.get("security_scan_status") or "",
        is_quarantined=bool(pkg.get("is_quarantined")),
        is_malware_detected=bool(pkg.get("is_malware_detected")),
        policy_violated=bool(pkg.get("policy_violated")),
        web_url=pkg.get("self_webapp_url") or "",
        cdn_url=pkg.get("cdn_url") or "",
        signature_url=pkg.get("signature_url") or "",
    )


@app.get("/api/package/{owner}/{repo}/{slug}", response_model=PackageDetail)
def get_package_detail(request: Request, owner: str, repo: str, slug: str):
    """Full metadata for one package.

    Served on selection, like /api/cve, so the graph payload stays the size it
    is. Unlike CVE records this cannot come from the warm cache — the build
    keeps only the handful of fields the graph draws — so it is one upstream
    call per package the user opens.
    """
    api_key = _get_api_key(request)
    session = create_session(api_key)
    try:
        pkg = fetch_package(session, owner, repo, slug)
    except Exception as exc:  # noqa: BLE001 - the panel must survive a missing record
        log.warning("Package detail fetch failed for %s/%s/%s: %s", owner, repo, slug, exc)
        raise HTTPException(status_code=502, detail="Could not load package details") from exc
    if not pkg:
        raise HTTPException(status_code=404, detail="Package not found")
    return _package_detail(pkg)


@app.get("/api/package-group/{owner}/{repo}", response_model=list[PackageDetail])
def get_package_group(request: Request, owner: str, repo: str, name: str):
    """Every version published under one package name.

    The name is a query parameter, not a path segment: Docker package names
    carry a slash (library/node) and no amount of encoding survives path
    normalisation on the way in.

    Served from the cached package list, which already holds the complete
    record for every package in the repo — so a group of fifty versions costs
    no upstream call at all while that cache is warm. Fetching them one at a
    time through /api/package would be fifty round trips for the same bytes.
    """
    api_key = _get_api_key(request)
    session = create_session(api_key)
    try:
        packages = _fetch_packages_cached(session, owner, repo)
    except Exception as exc:  # noqa: BLE001 - the panel must survive this
        log.warning("Package group fetch failed for %s/%s/%s: %s", owner, repo, name, exc)
        raise HTTPException(status_code=502, detail="Could not load package group") from exc

    members = [p for p in packages if (p.get("name") or "") == name]
    if not members:
        raise HTTPException(status_code=404, detail="No packages found for that name")

    # Worst first: a group is opened to find out which version to avoid, and
    # the answer should not be somewhere in the middle of a list of fifty.
    members.sort(
        key=lambda p: (
            -SEVERITY_RANK.get((p.get("vulnerability_counts") or {}).get("max_severity") or "", 0),
            -((p.get("vulnerability_counts") or {}).get("total") or 0),
            p.get("uploaded_at") or "",
        ),
    )
    return [_package_detail(p) for p in members]


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


def _report_theme(theme: str | None) -> str:
    """Clamp a requested report theme to what vulnly accepts.

    vulnly 1.0.0 takes --theme {dark,light} and defaults to dark. Anything else
    is an argparse error, so an unexpected query value would surface to the
    user as a failed report rather than a wrong colour.
    """
    return "light" if (theme or "").lower() == "light" else "dark"


@app.get("/api/vulnly-repo-report/{owner}/{repo}")
def vulnly_repo_report(owner: str, repo: str, request: Request, theme: str | None = None):
    """Generate an HTML repo-level vulnerability summary using vulnly.

    Fetches all packages in the repo, collects their latest scan results in
    parallel, assembles the Cloudsmith repo-summary envelope, and streams the
    rendered HTML back to the caller.
    """
    api_key = _get_api_key(request)
    session = create_session(api_key)

    packages = fetch_all_packages(session, owner, repo)
    if not packages:
        raise HTTPException(status_code=404, detail="No packages found in this repository.")

    seen_ids: set[str] = set()
    pkg_metas: list[dict] = []

    for pkg in packages:
        p_slug = pkg["slug_perm"]
        p_name = pkg.get("name") or p_slug
        version = pkg.get("version") or ""
        node_id = f"{p_name}@{version}" if version else p_name
        if node_id in seen_ids:
            continue
        seen_ids.add(node_id)
        raw_status = (pkg.get("security_scan_status") or "").lower()
        scannable = "not supported" not in raw_status
        pkg_metas.append({"slug": p_slug, "name": p_name, "scannable": scannable})

    def _fetch_pkg_summary(meta: dict) -> dict:
        if not meta["scannable"]:
            return {"package": meta["name"], "slug_perm": meta["slug"], "status": "no_scan",
                    "vulnerabilities": {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}}
        _, _, vulns = get_package_vulnerabilities(session, owner, repo, meta["slug"])
        if vulns is None:
            return {"package": meta["name"], "slug_perm": meta["slug"], "status": "no_scan",
                    "vulnerabilities": {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}}
        counts: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
        for v in vulns:
            sev = (v.get("severity") or "unknown").lower()
            counts[sev] = counts.get(sev, 0) + 1
        total = sum(counts.values())
        status = "vulnerable" if total > 0 else "no_issues_found"
        return {"package": meta["name"], "slug_perm": meta["slug"], "status": status, "vulnerabilities": counts}

    pkg_summaries: list[dict] = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_fetch_pkg_summary, m): m for m in pkg_metas}
        for fut in as_completed(futures):
            pkg_summaries.append(fut.result())

    payload = json.dumps({"data": {"owner": owner, "repository": repo, "packages": pkg_summaries}}).encode("utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        out_path = os.path.join(tmp, "report.html")
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "vulnly", "-", "--source", "cloudsmith",
                 "-o", out_path, "--theme", _report_theme(theme)],
                input=payload,
                capture_output=True,
                timeout=120,
                check=False,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail=f"vulnly is not installed: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail="vulnly repo report generation timed out.") from exc

        if proc.returncode != 0 or not os.path.exists(out_path):
            err = proc.stderr.decode("utf-8", errors="replace")[:1000]
            log.warning("vulnly repo report failed (rc=%s): %s", proc.returncode, err)
            raise HTTPException(status_code=500, detail=f"vulnly failed: {err.strip() or 'unknown error'}")

        with open(out_path, "rb") as f:
            html_bytes = f.read()

    return Response(content=html_bytes, media_type="text/html; charset=utf-8")


@app.get("/api/vulnly-report/{owner}/{repo}/{slug}")
def vulnly_report(owner: str, repo: str, slug: str, request: Request, theme: str | None = None):
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
                [sys.executable, "-m", "vulnly", "-", "--source", "cloudsmith",
                 "-o", out_path, "--theme", _report_theme(theme)],
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
#  Workspace package overview
# ──────────────────────────────────────────────────────────────

# Length of the CVE description carried by the workspace overview.
#
# This endpoint is a summary, and its descriptions were 6.73 MB of a 7.57 MB
# payload — 6,582 of them, median 708 characters, longest 31,477 — to render a
# snippet WorkspaceRepoPanel cuts to 120 characters. Truncating here takes the
# response from 2.36 MB to 0.42 MB gzipped.
#
# 200 rather than the panel's 120 so a change to how much the panel shows does
# not immediately require an API change. Full text stays available per package
# from /api/cve, which is what the package graph's side panel uses.
#
# Safe for search: WorkspaceRepoPanel filters on CVE id and package name only,
# never on description.
OVERVIEW_DESCRIPTION_CHARS = 200


def _summary_description(text: str) -> str:
    """Trim a CVE description to summary length, marking it when cut."""
    if not text or len(text) <= OVERVIEW_DESCRIPTION_CHARS:
        return text or ""
    return text[:OVERVIEW_DESCRIPTION_CHARS] + "…"


def _merge_cve(cve_map: dict, cve_id: str, severity: str, description: str, package: str) -> None:
    """Fold one package's view of a CVE into the workspace summary.

    The same CVE id arrives once per affected package and the copies do not
    agree: on full-stack-spectrum/neuro-containers, 134 of 4,130 ids carry more
    than one severity (CVE-2026-8376 is both Critical and Medium) and 14 carry
    more than one description.

    Both callers used to keep whichever copy arrived first. One of them iterates
    as_completed() over 60 threads, so the severity shown was decided by
    scheduling — it changed between identical runs and disagreed with the other
    caller. For a security view that is the wrong kind of arbitrary: a CVE that
    is Critical on one package could render Medium because a different package's
    scan happened to land first.

    Resolution is now by value rather than arrival:
      * severity    — the highest seen, so a summary never under-reports.
      * description — the longest seen, ties broken lexicographically. Arbitrary
                      but total, which is what makes it reproducible.
      * packages    — sorted by the caller once every package has been folded in.
    """
    entry = cve_map.get(cve_id)
    if entry is None:
        entry = cve_map[cve_id] = {
            "id": cve_id,
            "severity": severity,
            "description": _summary_description(description),
            "packages": [],
        }
    else:
        if SEVERITY_RANK.get(severity, 0) > SEVERITY_RANK.get(entry["severity"], 0):
            entry["severity"] = severity
        candidate = _summary_description(description)
        if (len(candidate), candidate) > (len(entry["description"]), entry["description"]):
            entry["description"] = candidate

    if package not in entry["packages"]:
        entry["packages"].append(package)


def _extract_repo_summary_from_graph(slug: str, name: str, graph: GraphResponse) -> WorkspaceRepoSummary:
    """Build a WorkspaceRepoSummary from an already-cached GraphResponse."""
    cve_map: dict[str, dict] = {}
    formats: dict[str, int] = {}
    for node in graph.nodes:
        if node.type != "package":
            continue
        fmt = (node.data.format or "unknown").lower().strip()
        if not fmt or fmt == "n/a":
            fmt = "unknown"
        formats[fmt] = formats.get(fmt, 0) + 1
        for cve in node.data.cves:
            if not cve.id:
                continue
            _merge_cve(cve_map, cve.id, cve.severity, cve.description, node.label)

    for entry in cve_map.values():
        entry["packages"].sort()
    cves = [WorkspaceCveSummary(**v) for v in cve_map.values()]
    s = graph.stats
    max_sev: str | None = None
    if s.critical > 0:
        max_sev = "Critical"
    elif s.high > 0:
        max_sev = "High"
    elif s.medium > 0:
        max_sev = "Medium"
    elif s.low > 0:
        max_sev = "Low"
    elif s.safe > 0:
        max_sev = "None"

    pkg_count = sum(1 for n in graph.nodes if n.type == "package")
    return WorkspaceRepoSummary(
        slug=slug,
        name=name,
        package_count=pkg_count,
        vuln_count=s.total_cves,
        max_severity=max_sev,
        critical=s.critical,
        high=s.high,
        medium=s.medium,
        low=s.low,
        safe=s.safe,
        cves=cves,
        formats=formats,
    )


def _fetch_repo_vuln_summary(session, owner: str, slug: str, name: str) -> WorkspaceRepoSummary:
    """Fetch packages + vulnerabilities for a single repo and return a summary."""
    packages = fetch_all_packages(session, owner, slug)
    if not packages:
        return WorkspaceRepoSummary(slug=slug, name=name)

    # Partition packages: skip the scan API call for those that clearly won't
    # return results (unsupported format or scan not yet run).
    pkg_metas: list[dict] = []  # needs vuln API call
    seen_ids: set[str] = set()
    stats: dict[str, int] = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0, "Safe": 0}
    formats: dict[str, int] = {}
    _ws_stats = get_stats(session)

    for pkg in packages:
        p_slug = pkg["slug_perm"]
        p_name = pkg.get("name") or pkg.get("slug_perm") or ""
        version = pkg.get("version") or ""
        node_id = f"{p_name}@{version}" if version else (p_name or p_slug)
        if node_id in seen_ids:
            continue
        seen_ids.add(node_id)

        fmt = (pkg.get("format", "") or "").lower().strip() or "unknown"
        formats[fmt] = formats.get(fmt, 0) + 1

        if _ws_stats:
            _ws_stats.record_scan_status(pkg.get("security_scan_status") or "")

        raw_status = (pkg.get("security_scan_status") or "").lower()
        if "not supported" in raw_status:
            stats["Safe"] += 1
            continue
        if "awaiting" in raw_status:
            stats["Safe"] += 1
            continue

        pkg_metas.append({"slug": p_slug, "name": p_name, "node_id": node_id})

    MAX_WORKERS = 10

    def _scan(meta: dict):
        return (meta, *get_package_vulnerabilities(session, owner, slug, meta["slug"]))

    total_cves = 0
    cve_map: dict[str, dict] = {}

    if pkg_metas:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(_scan, m): m for m in pkg_metas}
            for fut in as_completed(futures):
                meta, max_sev, vuln_count, vulns = fut.result()
                if max_sev == "Unknown" and vuln_count == 0:
                    max_sev = "None"
                if vuln_count == 0 and max_sev is not None and max_sev not in ("None", "Unknown"):
                    max_sev = "None"
                if max_sev in stats:
                    stats[max_sev] += 1
                else:
                    stats["Safe"] += 1
                total_cves += vuln_count
                for v in vulns:
                    cve_id = v.get("vulnerability_id") or v.get("cve_id") or v.get("identifier", "")
                    if not cve_id:
                        continue
                    v_sev = v.get("severity", v.get("max_severity", "Unknown"))
                    desc = v.get("description") or v.get("title") or v.get("summary", "")
                    _merge_cve(cve_map, cve_id, v_sev, desc, meta["name"])

    for entry in cve_map.values():
        entry["packages"].sort()
    cves = [WorkspaceCveSummary(**v) for v in cve_map.values()]
    max_overall: str | None = None
    for sev in ("Critical", "High", "Medium", "Low"):
        if stats.get(sev, 0) > 0:
            max_overall = sev
            break
    if max_overall is None and stats.get("Safe", 0) > 0:
        max_overall = "None"

    return WorkspaceRepoSummary(
        slug=slug,
        name=name,
        package_count=len(seen_ids),
        vuln_count=total_cves,
        max_severity=max_overall,
        critical=stats.get("Critical", 0),
        high=stats.get("High", 0),
        medium=stats.get("Medium", 0),
        low=stats.get("Low", 0),
        safe=stats.get("Safe", 0),
        cves=cves,
        formats=formats,
    )


@app.get("/api/workspace-overview", response_model=WorkspaceOverviewResponse)
def workspace_overview(owner: str, request: Request, refresh: bool = False):
    """Build a package-vulnerability overview for every repo in a workspace."""
    api_key = _get_api_key(request)
    overview_key = f"workspace-overview:{owner}"

    if not refresh and overview_key in _cache and time.time() - _cache[overview_key]["ts"] < WORKSPACE_CACHE_TTL:
        log.info("Returning cached workspace overview for %s", owner)
        return _cache[overview_key]["data"]

    timer = BuildTimer()
    session = create_session(api_key)
    raw_repos = fetch_repos(session, owner)
    if not raw_repos:
        result = WorkspaceOverviewResponse(owner=owner, repos=[])
        _cache_put(overview_key, result)
        return result

    def _process_repo(r: dict) -> WorkspaceRepoSummary:
        slug = r.get("slug", "")
        name = r.get("name", slug)
        # Re-use any full graph already cached for this repo
        repo_cache_key = f"{owner}/{slug}"
        if repo_cache_key in _cache and time.time() - _cache[repo_cache_key]["ts"] < CACHE_TTL:
            return _extract_repo_summary_from_graph(slug, name, _cache[repo_cache_key]["data"])
        return _fetch_repo_vuln_summary(session, owner, slug, name)

    summaries: list[WorkspaceRepoSummary] = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(_process_repo, r): r for r in raw_repos}
        for fut in as_completed(futures):
            try:
                summaries.append(fut.result())
            except Exception as exc:
                log.warning("Failed to process repo for workspace overview: %s", exc)

    summaries.sort(key=lambda s: (SEVERITY_RANK.get(s.max_severity or "", 0), s.name.lower()), reverse=True)

    # Connections between repos in this workspace. Cheap next to the vulnerability
    # work above — one call per repo, and most workspaces answer instantly or 404.
    known = {s.slug for s in summaries}
    connections: list[RepoConnection] = []

    def _connections_for(slug: str) -> list[tuple[str, dict]]:
        return [(slug, c) for c in fetch_repo_connected(session, owner, slug)]

    with ThreadPoolExecutor(max_workers=6) as pool:
        for found in pool.map(_connections_for, [s.slug for s in summaries]):
            for source, conn in found:
                target = conn.get("target_repository") or ""
                # A connection can point at a repo the caller cannot see; an
                # edge to a node that is not on the graph draws nothing.
                if not target or target not in known:
                    continue
                summary = conn.get("target_repository_summary") or {}
                connections.append(RepoConnection(
                    source=source,
                    target=target,
                    formats=sorted({
                        (u.get("type") or "") for u in (conn.get("configured_upstreams") or [])
                    } - {""}),
                    is_active=bool(conn.get("is_active", True)),
                    priority=conn.get("priority", 0) or 0,
                    target_package_count=summary.get("package_count", 0) or 0,
                ))
    connections.sort(key=lambda c: (c.source, c.target))

    result = WorkspaceOverviewResponse(owner=owner, repos=summaries, connections=connections)
    _cache_put(overview_key, result)

    timer.stop()
    _record_perf(
        overview_key,
        f"workspace-overview {owner}",
        session,
        timer,
        {
            "repos": len(summaries),
            "connections": len(connections),
            "packages": sum(s.package_count for s in summaries),
            "cves": sum(s.vuln_count for s in summaries),
            "bytes": len(result.model_dump_json()) if payload_bytes_enabled() else None,
        },
    )
    return result


# ──────────────────────────────────────────────────────────────
#  Organisation-level graph
# ──────────────────────────────────────────────────────────────

def _build_org_graph(api_key: str, owner: str) -> dict:
    """Build an org-level access graph: repos, members, services, entitlements."""
    timer = BuildTimer()
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
    MAX_WORKERS = 6

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

    # Fetch privileges, entitlements, and upstreams for each repo (parallel).
    #
    # Every format is queried, which is the only way to find them: a Cloudsmith
    # repo holds any mix of formats and exposes no field saying which. This used
    # to pass repository_type_str as the format to limit it to one call per
    # repo, but that field is the repo's *visibility* — every request went to
    # /upstream/private/, returned 404, and was swallowed by the handler that
    # skips formats a repo does not have. The org graph has therefore never
    # shown an upstream. Measured on full-stack-spectrum: 8 repos hold 19
    # upstream configs across 5 formats, and neuro-packages alone spans four of
    # them, so no single-format query could have found them all.
    MAX_WORKERS = 6

    def _fetch_priv(repo_slug: str) -> tuple[str, dict, list[dict], list[dict], list[dict]]:
        privs = fetch_repo_privileges(session, owner, repo_slug)
        ents = fetch_repo_entitlements(session, owner, repo_slug)
        ups = fetch_repo_upstreams(session, owner, repo_slug)
        conns = fetch_repo_connected(session, owner, repo_slug)
        return (repo_slug, privs, ents, ups, conns)

    # Track upstream URLs → which repos use them (for shared-upstream edges)
    upstream_url_repos: dict[str, list[str]] = {}
    # Connections are collected and emitted after the loop: the target repo may
    # not have been processed yet, and an edge to a node that does not exist
    # would be dropped by the renderer.
    connections: list[tuple[str, dict]] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(_fetch_priv, rs) for rs in repo_slugs]
        for fut in as_completed(futures):
            repo_slug, privs, ents, ups, conns = fut.result()
            for conn in conns:
                connections.append((repo_slug, conn))
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

    # Connected repositories: this repo resolves packages from that one. A
    # private upstream inside the workspace, and worth drawing for the same
    # reason an external upstream is — it is a path packages arrive by.
    connected_count = 0
    for source_slug, conn in connections:
        target_slug = conn.get("target_repository") or ""
        sid, tid = f"repo:{source_slug}", f"repo:{target_slug}"
        if not target_slug or sid not in seen or tid not in seen:
            continue
        formats = sorted({
            (u.get("type") or "") for u in (conn.get("configured_upstreams") or [])
        } - {""})
        summary = conn.get("target_repository_summary") or {}
        connected_count += 1
        edges.append({
            "source": sid,
            "target": tid,
            "type": "repo_connected",
            "label": ", ".join(formats) if formats else "connected",
            "data": {
                "is_active": bool(conn.get("is_active", True)),
                "priority": conn.get("priority", 0),
                "formats": formats,
                "target_package_count": summary.get("package_count", 0),
                "disable_reason": conn.get("disable_reason_text") or "",
                "created_at": conn.get("created_at", ""),
            },
        })

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
        "connected_repos": connected_count,
        "total_nodes": len(nodes),
        "total_edges": len(edges),
    }

    result = {"owner": owner, "nodes": nodes, "edges": edges, "stats": stats}

    timer.stop()
    _record_perf(
        f"org:{owner}",
        f"org-graph {owner}",
        session,
        timer,
        {
            "repos": len(repo_slugs),
            "nodes": len(nodes),
            "edges": len(edges),
            "shared_upstream_edges": sum(1 for e in edges if e["type"] == "shared_upstream"),
            "connected_repo_edges": connected_count,
            "bytes": len(json.dumps(result)) if payload_bytes_enabled() else None,
        },
    )
    return result


@app.get("/api/org-graph")
def get_org_graph(owner: str, request: Request, refresh: bool = False):
    api_key = _get_api_key(request)
    if not owner:
        raise HTTPException(status_code=400, detail="owner is required")

    cache_key = f"org:{owner}"
    if not refresh and cache_key in _cache and time.time() - _cache[cache_key]["ts"] < CACHE_TTL:
        return _cache[cache_key]["data"]

    result = _build_org_graph(api_key, owner)
    _cache_put(cache_key, result)
    return result
