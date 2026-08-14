"""Generate a ClickUp-importable CSV from the Forgely performance plan.

Regenerate after editing docs/performance-design.md so the board stays in sync.

Hierarchy: one task per branch, subtasks per commit. ClickUp's importer links
subtasks via `Parent ID` -> `Task ID`.
"""
import csv
import pathlib

OUT = pathlib.Path("/Users/colinmoynes/Dev/Forgely/docs/clickup-import.csv")
DOC = "docs/performance-design.md"

URGENT, HIGH, NORMAL, LOW = 1, 2, 3, 4

# (id, branch, name, tier, priority, status, est_hours, impact, files, accept, commits[])
BRANCHES = [
    (
        "PERF-00A", "perf/00-instrumentation-baseline",
        "Tier 0: Request instrumentation baseline",
        "Tier 0 - Measurement", URGENT, "complete", 6,
        "MERGED (PR #39). Per-build API request counters bucketed by endpoint family. "
        "Everything downstream is validated against the numbers this produces.",
        "backend/perfstats.py (new), backend/cloudsmith.py, backend/main.py",
        "One PERF log record per build; zero behaviour change; baseline captured for small/medium/large repos.",
        [
            ("Add perfstats module with thread-safe bucketed counters", "complete"),
            ("Record call timing, statuses, 429 throttling and rate-limit headers", "complete"),
            ("Track which package formats return dependency data", "complete"),
            ("Expose stats via forgely.perf logger and /api/graph?debug=1", "complete"),
            ("Capture baseline for small / medium / large repos", "complete"),
        ],
    ),
    (
        "PERF-00B", "perf/00-scan-status-histogram",
        "Tier 0: Scan-status histogram (sizes perf/01)",
        "Tier 0 - Measurement", URGENT, "in progress", 3,
        "Adds a security_scan_status histogram so perf/01 can be sized from data rather than assumption. "
        "RESULT: 74.8% of packages on neuro-packages are 'Security Scanning Not Supported' "
        "(5,603 of 7,490) - perf/01 is worth 27% of total network time.",
        "backend/perfstats.py, backend/main.py",
        "Histogram totals match the packages that receive a scan call; snapshot() must not deadlock "
        "(RLock regression test); no behaviour change.",
        [
            ("Add scan_statuses counter and record_scan_status()", "complete"),
            ("Add scan_status_breakdown() classifying exactly as perf/01 will", "complete"),
            ("Switch Lock -> RLock (snapshot() re-enters via breakdown)", "complete"),
            ("Render scanstatus block with perf/01 projection in report", "complete"),
            ("Wire call sites in _build_graph and _fetch_repo_vuln_summary", "complete"),
            ("Commit, push, open PR", "to do"),
        ],
    ),
    (
        "PERF-11", "perf/11-canvas-render-quick-wins",
        "Canvas render quick wins (2 lines, zero risk)",
        "Tier 3 - Frontend", HIGH, "to do", 1,
        "Two-line change, no behavioural risk. WorkspaceOverviewCanvas is the only canvas missing "
        "barnesHutOptimize, making it O(N^2) per iteration across up to 600 iterations where the "
        "others are O(N log N). Merge this first - it needs no measurement to justify.",
        "frontend/src/components/WorkspaceOverviewCanvas.tsx, frontend/src/components/GraphCanvas.tsx",
        "No visual regression; pan/zoom smooth on clique-heavy graphs.",
        [
            ("Add barnesHutOptimize:true to WorkspaceOverviewCanvas FA2 settings", "to do"),
            ("Add hideEdgesOnMove:true to Sigma constructor in GraphCanvas", "to do"),
        ],
    ),
    (
        "PERF-02", "perf/02-gate-dependency-fetch",
        "Gate dependency fetch by format (BIGGEST WIN - 53% of network time)",
        "Tier 1 - Request volume", URGENT, "to do", 6,
        "MEASURED: 10,376 of 10,420 dependency calls return nothing - 99.6% waste, 2,376s of network "
        "time, 53% of the entire build. Only conda/maven/rpm/ruby ever returned data. "
        "WARNING: npm returned empty across 1,822 calls and python across 17, but both formats CAN "
        "carry dependency metadata - an allowlist built from this one workspace risks silently "
        "dropping edges elsewhere. Gate on a DENYLIST, log when a gated format is skipped, and make "
        "the set overridable by env var. Also dedupe by node_id: 2,930 calls are exact duplicates.",
        "backend/cloudsmith.py, backend/main.py",
        "packages.dependencies drops 10,420 -> under 200 on neuro-packages; wall 342.5s -> ~222s; "
        "no dependency edge present on main is missing after the change.",
        [
            ("Add DEPENDENCY_FORMATS denylist constant with env override", "to do"),
            ("Gate the dependency submission loop on package format", "to do"),
            ("Dedupe by node_id before submitting (removes 2,930 dup calls)", "to do"),
            ("Add WARNING log when a gated format is skipped", "to do"),
            ("Verify edge set identical to main on a multi-format repo", "to do"),
            ("Re-run baseline and record new numbers in design doc section 8", "to do"),
        ],
    ),
    (
        "PERF-01", "perf/01-skip-unscannable-packages",
        "Skip scan calls for unscannable packages (27% of network time)",
        "Tier 1 - Request volume", URGENT, "to do", 5,
        "MEASURED: 74.8% of packages (5,603 of 7,490) are 'Security Scanning Not Supported' - "
        "removing those scan calls saves ~1,210s, 27% of the build. Behaviour-neutrality is EVIDENCED: "
        "those packages produced zero detail fetches, proving their scan lists return empty, so "
        "substituting (None, 0, []) is byte-identical. Zero packages were in 'awaiting' state, so skip "
        "'not supported' ONLY - do not chase the awaiting case, the data says it is worth nothing and "
        "it would render pending packages green.",
        "backend/main.py",
        "CRITICAL: total_nodes and total_edges UNCHANGED from main - unscannable packages must still "
        "appear as grey nodes. vulns.scans drops 7,490 -> 1,887. Graph JSON byte-identical.",
        [
            ("Add scannable flag to pkg_metas (do NOT filter the list itself)", "to do"),
            ("Submit only scannable metas to the executor; seed (None,0,[]) for the rest", "to do"),
            ("Verify node count unchanged and unsupported packages still render grey", "to do"),
            ("Diff graph JSON against main on a mixed-format repo", "to do"),
            ("Re-run baseline and record new numbers", "to do"),
        ],
    ),
    (
        "PERF-13", "perf/13-parallel-package-pagination",
        "Parallelise package pagination (36% of wall time)",
        "Tier 1 - Request volume", HIGH, "to do", 6,
        "ADDED AFTER BASELINING - not in the original plan. fetch_all_packages walks pages in a while "
        "loop: 105 sequential calls at a 1,169ms mean = 122.8s, 36% of total wall time, with all 20 "
        "workers idle throughout. Package-list pages are ~5x slower per call than any other endpoint "
        "because each returns 100 full records. Relative importance GROWS as other branches land - "
        "once perf/01 and perf/02 are in, pagination is 76% of what remains.",
        "backend/cloudsmith.py",
        "packages.list wall contribution drops ~123s -> under 20s; package set identical to main "
        "(same count, same slugs, no boundary duplicates); total_nodes unchanged.",
        [
            ("Confirm pagination count header name against a live response", "to do"),
            ("Fetch pages 2..N via ThreadPoolExecutor when total is known", "to do"),
            ("Add speculative batching fallback if no count header exists", "to do"),
            ("Apply to fetch_repos, fetch_org_members, fetch_org_services", "to do"),
            ("Verify no duplicates from boundary over-fetch", "to do"),
        ],
    ),
    (
        "PERF-03", "perf/03-short-circuit-scan-details",
        "Short-circuit scan detail fetches (HIGHEST CORRECTNESS RISK)",
        "Tier 1 - Request volume", HIGH, "to do", 6,
        "7.4% of network time (~331s) but hits 100% of post-perf/01 scan traffic - among SCANNABLE "
        "packages the details:scans ratio is exactly 1.0 (1,887 = 1,887). "
        "RISK: if Cloudsmith does not reliably populate num_vulnerabilities, early return would MASK "
        "REAL VULNERABILITIES - a false negative in a security tool. Validate, do not assume. "
        "Run with the short-circuit disabled behind an env flag for one cycle first.",
        "backend/cloudsmith.py",
        "STRICTER THAN OTHER BRANCHES: graph JSON byte-identical to main for all max_severity, "
        "vuln_count and cves fields. Verify a package where the list reports num_vulnerabilities>0 but "
        "embeds no vuln array still triggers the detail fetch.",
        [
            ("Early-return when api_count==0 and max_severity is absent/None/Unknown", "to do"),
            ("Cap the historical-scan fallback loop at one additional scan", "to do"),
            ("Add env flag to disable short-circuit for shadow validation", "to do"),
            ("Add WARNING when a skipped detail fetch would have returned vulns", "to do"),
            ("Byte-diff graph JSON against main on a known-vulnerable repo", "to do"),
        ],
    ),
    (
        "PERF-04", "perf/04-collapse-cve-cliques",
        "Collapse shared-CVE cliques",
        "Tier 1 - Request volume", NORMAL, "to do", 8,
        "Each CVE affecting k packages emits k(k-1)/2 edges - 300 packages sharing one CVE produces "
        "44,850 edges. Edges are modest on neuro-packages (7,653 for 7,544 nodes) so this matters most "
        "on CVE-dense container repos. THREE OPTIONS - decide before starting: (A) CVE hub nodes, "
        "(B) client-derived cliques, (C) cap clique size. RECOMMEND C: lowest risk, no design debate. "
        "A is arguably the better long-term model but is a product decision, not a performance one. "
        "Apply the same fix to shared_upstream in _build_org_graph.",
        "backend/main.py, frontend/src/types/index.ts, frontend/src/components/GraphCanvas.tsx, "
        "frontend/src/components/FilterBar.tsx, frontend/src/components/Legend.tsx",
        "Edge count drops by the expected factor on the worst-case repo; all eight shared_cve call "
        "sites in GraphCanvas still behave correctly (filter toggle, search highlighting, hide-edges).",
        [
            ("Decide between hub nodes / client-derived / capped clique", "to do"),
            ("Implement chosen approach for shared_cve edges", "to do"),
            ("Apply the same fix to shared_upstream in _build_org_graph", "to do"),
            ("Verify all 8 shared_cve call sites in GraphCanvas", "to do"),
        ],
    ),
    (
        "PERF-12", "perf/12-async-http-client",
        "Async HTTP client (largest remaining lever)",
        "Tier 4 - Concurrency", HIGH, "to do", 16,
        "PROMOTED after measurement. Was 'only if data justifies it' - IT DOES. Zero 429s, 34,050 of "
        "50,000 rate-limit budget unused, and the parallel phases run at exactly 19.8x against "
        "MAX_WORKERS=20, meaning the pool is saturated and concurrency is the binding constraint. "
        "Converting to httpx.AsyncClient with an asyncio.Semaphore allows 100+ concurrent requests at "
        "a fraction of the memory. Projected ~35s -> ~17s. "
        "CAUTION: this workspace may not be representative - re-check X-RateLimit-Remaining on any "
        "account with a smaller quota before raising worker counts in anger.",
        "backend/cloudsmith.py, backend/main.py, backend/requirements.txt",
        "Wall time drops per projection; zero 429s at the new concurrency, or the semaphore is sized "
        "down until true.",
        [
            ("Convert cloudsmith.py from requests to httpx.AsyncClient", "to do"),
            ("Add asyncio.Semaphore concurrency control", "to do"),
            ("Convert FastAPI endpoints from def to async def", "to do"),
            ("Tune concurrency against observed rate-limit headroom", "to do"),
            ("Re-run full baseline", "to do"),
        ],
    ),
    (
        "PERF-05", "perf/05-persistent-scan-cache",
        "Persistent scan cache (warm loads)",
        "Tier 2 - Caching", HIGH, "to do", 12,
        "CACHE_TTL is 300s - SHORTER THAN THE BUILD IT CACHES, so a six-minute build is already stale "
        "on arrival. Cache is also in-process, lost on restart, and unbounded. Scan results are "
        "IMMUTABLE once produced (keyed on slug_perm + scan identifier) so TTL can be effectively "
        "infinite; only new packages cost network. Prefer stdlib SQLite over adding diskcache.",
        "backend/cache.py (new), backend/main.py, backend/cloudsmith.py",
        "Second load of an unchanged 5k-package repo under 5s; cache survives restart; adding one "
        "package fetches exactly one scan.",
        [
            ("Add cache.py wrapping SQLite", "to do"),
            ("Key scan results on (owner, repo, slug_perm, scan_identifier)", "to do"),
            ("Keep package list on a short TTL; raise/remove graph-level TTL", "to do"),
            ("Add cache hit/miss counters to the perf stats block", "to do"),
            ("Add eviction or remove the unbounded in-memory _cache", "to do"),
        ],
    ),
    (
        "PERF-06", "perf/06-inflight-coalescing",
        "In-flight request coalescing",
        "Tier 2 - Caching", NORMAL, "to do", 3,
        "Two tabs, or a second click on Go, launches two complete concurrent builds at 20 workers each. "
        "Keep dict[cache_key, Future] guarded by a lock so concurrent callers await the same build.",
        "backend/main.py",
        "Two simultaneous requests for the same repo produce one set of upstream API calls, verified "
        "via the Tier 0 counter.",
        [
            ("Add Future registry keyed by cache key", "to do"),
            ("Apply to /api/graph, /api/workspace-overview, /api/org-graph", "to do"),
        ],
    ),
    (
        "PERF-08", "perf/08-compression-payload-slim",
        "Compression and payload slimming",
        "Tier 2 - Transport", NORMAL, "to do", 5,
        "Only CORS middleware is registered - no compression on highly repetitive JSON. "
        "MEASURED: payload tracks CVE volume, NOT package count. neuro-containers (214 packages) "
        "serialised to 25.2 MB (~117 KB/node) while neuro-packages (7,490 packages) was only 4.2 MB. "
        "Benefit is concentrated on CVE-dense container repos.",
        "backend/main.py, backend/models.py, frontend/src/components/SidePanel.tsx",
        "Transfer size recorded before/after on neuro-containers; SidePanel still shows full "
        "descriptions on click.",
        [
            ("Register GZipMiddleware with minimum_size=1000", "to do"),
            ("Drop description from CVERecord in the graph payload", "to do"),
            ("Add lazy /api/cve endpoint for on-click detail", "to do"),
            ("Update SidePanel to fetch descriptions on demand", "to do"),
        ],
    ),
    (
        "PERF-07", "perf/07-rate-limit-resilience",
        "Rate-limit resilience and partial results",
        "Tier 2 - Resilience", NORMAL, "to do", 6,
        "DEMOTED after measurement - the throttling collapse this defends against was NEVER OBSERVED "
        "(zero 429s across all builds). Still worth doing for the partial-failure guarantee: today a "
        "single exhausted retry raises RuntimeError through fut.result() and returns HTTP 500, "
        "discarding an entire multi-minute build. A security graph that quietly omits packages is "
        "worse than one that says so.",
        "backend/cloudsmith.py, backend/main.py, backend/models.py",
        "A forced 429 storm yields a partial graph with an accurate failed_count, not a 500.",
        [
            ("Wrap fut.result() call sites to isolate per-package failure", "to do"),
            ("Add partial/failed_count to GraphResponse and surface in UI", "to do"),
            ("Add token bucket seeded from X-RateLimit headers", "to do"),
            ("Raise MAX_RETRIES and add jitter now failure is non-fatal", "to do"),
        ],
    ),
    (
        "PERF-10", "perf/10-fa2-worker-layout",
        "Move ForceAtlas2 to a web worker",
        "Tier 3 - Frontend", NORMAL, "to do", 6,
        "forceAtlas2.assign runs up to 800 iterations SYNCHRONOUSLY on the main thread - the tab is "
        "frozen for the duration, tens of seconds on a 10k-node graph. FA2LayoutSupervisor is already "
        "present in node_modules (verified), so no dependency change is needed. "
        "Independent of all backend work - can be done in parallel by a second person.",
        "frontend/src/components/GraphCanvas.tsx, frontend/src/components/OrgGraphCanvas.tsx, "
        "frontend/src/components/WorkspaceOverviewCanvas.tsx",
        "Main thread never blocks >50ms during layout; no supervisor leaks across layout switches.",
        [
            ("Replace forceAtlas2.assign with FA2LayoutSupervisor", "to do"),
            ("Stop supervisor on unmount and on layout switch", "to do"),
            ("Preserve radial pre-placement and repo re-anchoring", "to do"),
        ],
    ),
    (
        "PERF-09", "perf/09-stream-graph-response",
        "Stream the graph response (largest UX gain)",
        "Tier 2 - UX", NORMAL, "to do", 12,
        "Everything is one blocking request, so the user stares at a spinner for the entire build. "
        "Convert /api/graph to NDJSON over StreamingResponse: emit repo + package nodes immediately "
        "(available from the package-list call alone), then vulnerability data as futures resolve. "
        "THIS DOES NOT MAKE THE LOAD FASTER - it makes it FEEL dramatically faster. First paint ~2s "
        "instead of a multi-minute spinner. "
        "Optional: use vulnerability_policy_violated:true to scan highest-risk packages first. "
        "Strictly a SCHEDULING optimisation - never use it to decide what to skip, since it reflects "
        "only the configured policy threshold and returns nothing where no policy exists.",
        "backend/main.py, frontend/src/hooks/useGraphData.ts, "
        "frontend/src/components/LoadingIndicator.tsx, frontend/src/components/GraphCanvas.tsx",
        "First nodes painted within 3s on a 5k-package repo; progress indicator monotonic; abort on "
        "navigation cancels the backend build.",
        [
            ("Convert /api/graph to NDJSON over StreamingResponse", "to do"),
            ("Rewrite useGraphData to read the stream incrementally", "to do"),
            ("Turn LoadingIndicator into a real progress bar", "to do"),
            ("Defer or stream-integrate the layout run", "to do"),
            ("Optional: risk-first ordering via vulnerability_policy_violated", "to do"),
        ],
    ),
]

HEADER = ["Task ID", "Task Name", "Task Content", "Status", "Priority",
          "Tags", "Parent ID", "Time Estimated", "Branch"]


def main() -> None:
    rows = []
    for (tid, branch, name, tier, prio, status, est, impact, files, accept, commits) in BRANCHES:
        body = (
            f"BRANCH: {branch}\n"
            f"TIER: {tier}\n\n"
            f"{impact}\n\n"
            f"FILES\n{files}\n\n"
            f"ACCEPTANCE CRITERIA\n{accept}\n\n"
            f"Full spec: {DOC}\n\n"
            f"Create with:\n  git checkout main && git pull && git checkout -b {branch}"
        )
        rows.append([tid, name, body, status, prio, f"performance,{tier}", "", est, branch])
        for i, (ctitle, cstatus) in enumerate(commits, 1):
            rows.append([
                f"{tid}-{i:02d}", ctitle,
                f"Commit on {branch}\n\nParent: {name}",
                cstatus, prio, "performance,commit", tid, "", branch,
            ])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(HEADER)
        w.writerows(rows)

    parents = sum(1 for r in rows if not r[6])
    print(f"wrote {OUT}")
    print(f"  {len(rows)} rows — {parents} branch tasks, {len(rows)-parents} commit subtasks")


if __name__ == "__main__":
    main()
