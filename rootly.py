#!/usr/bin/env python3
"""Rootly – Cloudsmith artifact dependency & security visualizer."""

import argparse
import base64
import json
import os
import sys
import time

import requests
import networkx as nx
from dotenv import load_dotenv
from pyvis.network import Network
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, MofNCompleteColumn, TimeElapsedColumn
from rich.table import Table
from rich.text import Text

load_dotenv()

console = Console()

# ---------------------------------------------------------------------------
# Cloudsmith API client
# ---------------------------------------------------------------------------

BASE_URL = "https://api.cloudsmith.io/v1"
MAX_RETRIES = 3
RETRY_BACKOFF = 2  # seconds, doubles each retry


def _session(api_key: str) -> requests.Session:
    """Return a configured requests session with auth headers."""
    s = requests.Session()
    s.headers.update({"X-Api-Key": api_key, "Accept": "application/json"})
    return s


def _api_get(session: requests.Session, url: str, params: dict | None = None) -> dict | list:
    """GET with retries and rate-limit back-off."""
    delay = RETRY_BACKOFF
    for attempt in range(1, MAX_RETRIES + 1):
        resp = session.get(url, params=params, timeout=30)

        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", delay))
            console.print(f"  [yellow]⚠ Rate-limited – waiting {retry_after}s (attempt {attempt}/{MAX_RETRIES})[/]")
            time.sleep(retry_after)
            delay *= 2
            continue

        resp.raise_for_status()
        return resp.json()

    console.print(f"[bold red]✘ Max retries exceeded for {url}[/]")
    sys.exit(1)


def fetch_all_packages(session: requests.Session, owner: str, repo: str) -> list[dict]:
    """Fetch every package in the repo, handling pagination."""
    url = f"{BASE_URL}/packages/{owner}/{repo}/"
    page = 1
    all_packages: list[dict] = []

    with console.status("[bold cyan]Fetching packages…", spinner="dots") as status:
        while True:
            status.update(f"[bold cyan]Fetching packages – page {page} ({len(all_packages)} so far)…")
            data = _api_get(session, url, params={"page": page, "page_size": 100})

            if not data:
                break

            all_packages.extend(data)

            if len(data) < 100:
                break
            page += 1

    console.print(f"  [green]✔[/] Fetched [bold]{len(all_packages)}[/] packages from [cyan]{owner}/{repo}[/]")
    return all_packages


def fetch_dependencies(session: requests.Session, owner: str, repo: str, slug: str) -> list[dict]:
    """Fetch dependency list for a single package (best-effort)."""
    url = f"{BASE_URL}/packages/{owner}/{repo}/{slug}/dependencies/"
    try:
        data = _api_get(session, url)
        return data.get("dependencies", []) if isinstance(data, dict) else data
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return []
        raise


def fetch_vulnerability_scans(session: requests.Session, owner: str, repo: str, slug: str) -> list[dict]:
    """List vulnerability scans for a package, returning all scan summaries."""
    url = f"{BASE_URL}/vulnerabilities/{owner}/{repo}/{slug}/"
    try:
        data = _api_get(session, url)
        return data if isinstance(data, list) else data.get("results", [data]) if isinstance(data, dict) else []
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code in (404, 400):
            return []
        raise


def fetch_scan_details(session: requests.Session, owner: str, repo: str, slug: str, scan_id: str) -> dict:
    """Fetch detailed vulnerability scan results including individual CVEs."""
    url = f"{BASE_URL}/vulnerabilities/{owner}/{repo}/{slug}/{scan_id}/"
    try:
        return _api_get(session, url)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return {}
        raise


def _extract_vulns(data: dict | list) -> list[dict]:
    """Try multiple response shapes to extract vulnerability records."""
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    # Direct keys
    for key in ("vulnerabilities", "results", "scan_results"):
        val = data.get(key)
        if isinstance(val, list) and val:
            return val
    # Nested under "scan" object
    scan_obj = data.get("scan")
    if isinstance(scan_obj, dict):
        for key in ("vulnerabilities", "results"):
            val = scan_obj.get(key)
            if isinstance(val, list) and val:
                return val
    return []


def get_package_vulnerabilities(
    session: requests.Session, owner: str, repo: str, slug: str
) -> tuple[str | None, int, list[dict]]:
    """Return (max_severity, vuln_count, vulnerabilities) for a package.

    vuln_count comes from the scan summary (authoritative API count).
    vulnerabilities is the list of individual CVE records from the detail
    endpoint (may be shorter if the detail fetch fails).
    """
    scans = fetch_vulnerability_scans(session, owner, repo, slug)
    if not scans:
        return None, 0, []

    # Pick the most recent scan
    latest = scans[0]
    for s in scans:
        if s.get("created_at", "") > latest.get("created_at", ""):
            latest = s

    # Authoritative count and severity from the scan summary
    api_count = latest.get("num_vulnerabilities") or latest.get("num_security_vulnerabilities") or 0
    max_sev = latest.get("max_severity")

    # Try to extract vulns from the scan list entry itself first
    vulns = _extract_vulns(latest)

    # If no vulns inline, fetch the detail endpoint
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

    # Use parsed vulns count if the API didn't report one
    if not api_count and vulns:
        api_count = len(vulns)

    # Derive max_sev from individual records if still missing
    if not max_sev and vulns:
        best_rank = 0
        for v in vulns:
            v_sev = v.get("severity", v.get("max_severity", ""))
            rank = SEVERITY_RANK.get(v_sev, 0)
            if rank > best_rank:
                best_rank = rank
                max_sev = v_sev

    return max_sev, int(api_count), vulns


# ---------------------------------------------------------------------------
# Severity helpers
# ---------------------------------------------------------------------------

SEVERITY_COLORS = {
    "Critical": "#ff4d4d",
    "High":     "#ff8c1a",
    "Medium":   "#ffd11a",
    "Low":      "#79b8ff",
}
SAFE_COLOR = "#28a745"
UNKNOWN_COLOR = "#666666"

SEVERITY_RANK = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}

ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")


def _load_image_uri(filename: str) -> str:
    """Load a PNG from assets/ and return a base64 data URI."""
    path = os.path.join(ASSETS_DIR, filename)
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def severity_color(severity: str | None) -> str:
    return SEVERITY_COLORS.get(severity or "", SAFE_COLOR)


def severity_shape(severity: str | None) -> str:
    """Critical/High get a distinct shape so they stand out even in large graphs."""
    if severity in ("Critical", "High"):
        return "diamond"
    return "dot"


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------

def build_graph(
    session: requests.Session,
    owner: str,
    repo: str,
    output: str,
    include_deps: bool = True,
) -> None:
    G = nx.DiGraph()  # directed – tree layout

    repo_image = _load_image_uri("cloudsmith.png")

    packages = fetch_all_packages(session, owner, repo)
    if not packages:
        console.print("[bold red]✘ No packages found – check owner/repo and API key.[/]")
        sys.exit(1)

    # --- Central repository node ---
    repo_label = f"{owner}/{repo}"
    G.add_node(
        repo_label,
        label=repo_label,
        shape="image",
        image=repo_image,
        size=25,
        level=0,
        title=f"<b>{repo_label}</b><br>Cloudsmith Repository",
        font={"size": 14, "color": "white"},
    )

    # Map slug -> display name for edge building
    slug_to_name: dict[str, str] = {}
    # Track stats for the summary table
    stats: dict[str, int] = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0, "Safe": 0}
    total_cves = 0
    # Per-node metadata for the detail panel (embedded in HTML as JS object)
    node_data: dict[str, dict] = {}
    # CVE -> list of package names that contain it (for shared-CVE edges)
    cve_to_packages: dict[str, list[str]] = {}

    console.print()
    progress_cols = [
        SpinnerColumn(),
        TextColumn("[bold cyan]{task.description}"),
        BarColumn(bar_width=40),
        MofNCompleteColumn(),
        TextColumn("•"),
        TimeElapsedColumn(),
    ]
    with Progress(*progress_cols, console=console) as progress:
      vuln_task = progress.add_task("Scanning vulnerabilities", total=len(packages))
      for pkg in packages:
        slug = pkg["slug_perm"]
        name = f"{pkg['name']}@{pkg['version']}"
        downloads = pkg.get("downloads", 0)
        scan_status = pkg.get("security_scan_status", "Unknown")

        progress.update(vuln_task, description=f"Scanning [white]{name}[/]")
        max_sev, api_vuln_count, vulns = get_package_vulnerabilities(session, owner, repo, slug)

        # api_vuln_count = authoritative count from the Cloudsmith scan
        # vulns = individual CVE records (may be fewer if detail fetch failed)
        vuln_count = api_vuln_count
        cve_records: list[dict] = []
        sev_counts: dict[str, int] = {}
        cve_lines: list[str] = []

        for v in vulns:
            v_sev = v.get("severity", v.get("max_severity", "Unknown"))
            sev_counts[v_sev] = sev_counts.get(v_sev, 0) + 1
            cve_id = v.get("cve_id") or v.get("name") or v.get("identifier", "")
            cve_records.append({
                "id": cve_id,
                "severity": v_sev,
                "description": v.get("description", v.get("summary", "")),
                "url": v.get("url", ""),
            })
            if cve_id:
                cve_to_packages.setdefault(cve_id, []).append(name)
            if cve_id and len(cve_lines) < 10:
                cve_lines.append(f"{cve_id} ({v_sev})")

        if sev_counts:
            breakdown = " / ".join(f"{sev}: {cnt}" for sev, cnt in sorted(
                sev_counts.items(), key=lambda x: SEVERITY_RANK.get(x[0], 0), reverse=True
            ))
        elif vuln_count > 0:
            breakdown = f"{vuln_count} (details unavailable)"
        else:
            breakdown = "None found"

        cve_list_html = "<br>".join(cve_lines)
        if len(vulns) > 10:
            cve_list_html += f"<br><i>… and {len(vulns) - 10} more</i>"

        tooltip = (
            f"<b>{name}</b><br>"
            f"Format: {pkg.get('format', 'N/A')}<br>"
            f"Severity: {max_sev or 'None'}<br>"
            f"Vulnerabilities: {vuln_count} ({breakdown})<br>"
            f"Scan: {scan_status}<br>"
            f"Downloads: {downloads}"
        )
        if cve_list_html:
            tooltip += f"<br><br><b>CVEs:</b><br>{cve_list_html}"

        node_size = max(15, min(50, 15 + (downloads or 0) // 100))

        sev_clr = severity_color(max_sev)
        G.add_node(
            name,
            label=name,
            shape="box",
            size=node_size,
            level=1,
            title=tooltip,
            borderWidth=2,
            color={"background": "#2a2a2a", "border": sev_clr, "highlight": {"background": "#3a3a3a", "border": "#ffffff"}},
            font={"color": "white", "size": 12},
        )
        # Edge from repo to package
        G.add_edge(repo_label, name)
        slug_to_name[slug] = name

        # Store structured data for the HTML detail panel
        node_data[name] = {
            "cves": cve_records,
            "max_severity": max_sev or "None",
            "pkg_format": pkg.get("format", "N/A"),
            "vuln_count": vuln_count,
        }

        # Accumulate stats
        total_cves += vuln_count
        if max_sev in stats:
            stats[max_sev] += 1
        else:
            stats["Safe"] += 1

        progress.advance(vuln_task)

    # --- Shared-CVE edges (packages sharing the same CVE are linked) ---
    shared_cve_count = 0
    for cve_id, pkg_names in cve_to_packages.items():
        if len(pkg_names) < 2:
            continue
        for i in range(len(pkg_names)):
            for j in range(i + 1, len(pkg_names)):
                a, b = pkg_names[i], pkg_names[j]
                if G.has_edge(a, b):
                    existing = G[a][b].get("title", "")
                    if cve_id not in existing:
                        G[a][b]["title"] = existing + f", {cve_id}" if existing else cve_id
                else:
                    G.add_edge(a, b,
                        color="#ff4d4d",
                        title=cve_id,
                        dashes=True,
                        width=2,
                    )
                    shared_cve_count += 1

    if shared_cve_count:
        console.print(f"  [red]⚠[/] Added [bold]{shared_cve_count}[/] shared-CVE edges")

    # Dependency edges
    if include_deps:
      with Progress(*progress_cols, console=console) as progress:
        dep_task = progress.add_task("Fetching dependencies", total=len(slug_to_name))
        for slug in slug_to_name:
            progress.update(dep_task, description=f"Deps for [white]{slug_to_name[slug]}[/]")
            deps = fetch_dependencies(session, owner, repo, slug)
            src_name = slug_to_name[slug]
            for dep in deps:
                dep_name = dep.get("name", dep.get("identifier", "unknown"))
                dep_version = dep.get("version", "")
                dep_label = f"{dep_name}@{dep_version}" if dep_version else dep_name

                if dep_label not in G:
                    G.add_node(
                        dep_label,
                        label=dep_label,
                        color=UNKNOWN_COLOR,
                        shape="dot",
                        size=10,
                        level=2,
                        title=f"<b>{dep_label}</b><br>(external / unscanned)",
                    )
                if not G.has_edge(src_name, dep_label):
                    G.add_edge(src_name, dep_label, color="#333333", width=1)
            progress.advance(dep_task)

    # Build interactive visualisation
    net = Network(
        height="100vh",
        width="100%",
        bgcolor="transparent",
        font_color="white",
        directed=True,
        select_menu=False,
        filter_menu=False,
    )
    net.from_nx(G)
    net.set_options("""
    {
      "layout": {
        "hierarchical": {
          "enabled": true,
          "direction": "UD",
          "sortMethod": "directed",
          "levelSeparation": 200,
          "nodeSpacing": 150,
          "treeSpacing": 250,
          "blockShifting": true,
          "edgeMinimization": true,
          "parentCentralization": true
        }
      },
      "physics": {
        "hierarchicalRepulsion": {
          "centralGravity": 0.0,
          "springLength": 150,
          "springConstant": 0.01,
          "nodeDistance": 180,
          "damping": 0.09
        },
        "solver": "hierarchicalRepulsion",
        "stabilization": {"iterations": 300}
      },
      "interaction": {
        "hover": true,
        "tooltipDelay": 100,
        "navigationButtons": true
      },
      "edges": {
        "color": {"color": "#555555", "highlight": "#ffffff"},
        "smooth": {"type": "cubicBezier", "forceDirection": "vertical", "roundness": 0.4},
        "arrows": {"to": {"enabled": true, "scaleFactor": 0.5}}
      }
    }
    """)

    with console.status("[bold cyan]Rendering graph…", spinner="dots"):
        net.save_graph(output)
        _inject_ui(output, node_data)

    # --- Summary output ---
    console.print()
    _print_summary(output, G, stats, total_cves)


SEV_RICH_STYLES = {
    "Critical": "bold red",
    "High":     "bold bright_red",
    "Medium":   "bold yellow",
    "Low":      "bold bright_blue",
    "Safe":     "bold green",
}


def _print_summary(output: str, G: nx.Graph, stats: dict[str, int], total_cves: int) -> None:
    """Print a styled summary table to the terminal."""
    table = Table(title="Scan Summary", title_style="bold white", border_style="dim")
    table.add_column("Severity", style="bold")
    table.add_column("Packages", justify="right")

    for sev in ("Critical", "High", "Medium", "Low", "Safe"):
        count = stats.get(sev, 0)
        style = SEV_RICH_STYLES.get(sev, "")
        table.add_row(f"[{style}]{sev}[/]", f"[{style}]{count}[/]")

    table.add_section()
    table.add_row("Total CVEs", str(total_cves))
    table.add_row("Nodes", str(G.number_of_nodes()))
    table.add_row("Edges", str(G.number_of_edges()))

    console.print(table)
    console.print()
    console.print(
        Panel(
            f"[green]✔[/] Graph saved to [bold cyan]{output}[/]\n"
            f"  Open in your browser to explore the interactive map.",
            title="Rootly",
            border_style="green",
        )
    )


def _inject_ui(html_path: str, node_data: dict[str, dict]) -> None:
    """Inject legend, detail panel, CVE search, and click-to-filter JS."""
    node_data_json = json.dumps(node_data, separators=(",", ":"))
    inject = r"""
<!-- Rootly: graph-paper background -->
<style>
  html, body { margin:0; padding:0; overflow:hidden; height:100%; width:100%; background:#1a1a2e; }
  #mynetwork {
    position:fixed; top:0; left:0; width:100%; height:100%;
    background-color: #1a1a2e;
    background-image:
      linear-gradient(rgba(100,149,237,0.08) 1px, transparent 1px),
      linear-gradient(90deg, rgba(100,149,237,0.08) 1px, transparent 1px),
      linear-gradient(rgba(100,149,237,0.18) 1px, transparent 1px),
      linear-gradient(90deg, rgba(100,149,237,0.18) 1px, transparent 1px);
    background-size: 20px 20px, 20px 20px, 100px 100px, 100px 100px;
    border: none !important;
  }
  #mynetwork canvas { background: transparent !important; }
</style>
<!-- Rootly: legend -->
<div id="rootly-legend" style="
    position:fixed; bottom:16px; right:16px; background:#222; color:#eee;
    padding:14px 18px; border-radius:8px; font-family:sans-serif; font-size:13px;
    box-shadow:0 2px 10px rgba(0,0,0,.5); z-index:9999;">
  <b style="font-size:14px;">Rootly – Legend</b>
  <div style="margin-top:8px;">
    <span style="color:#fff;">&#x2605;</span> Repository &nbsp;
    <span style="color:#ff4d4d;">&#x25C6;</span> Critical &nbsp;
    <span style="color:#ff8c1a;">&#x25CF;</span> High &nbsp;
    <span style="color:#ffd11a;">&#x25CF;</span> Medium &nbsp;
    <span style="color:#79b8ff;">&#x25CF;</span> Low &nbsp;
    <span style="color:#28a745;">&#x25CF;</span> Safe &nbsp;
    <span style="color:#666666;">&#x25CF;</span> Unscanned
  </div>
  <div style="margin-top:6px; font-size:11px; color:#999;">
    <span style="border-bottom:2px dashed #ff4d4d; padding-bottom:1px;">---</span> Shared CVE &nbsp;
    <span style="border-bottom:2px solid #555; padding-bottom:1px;">&#x2014;&#x2014;</span> Dependency
  </div>
</div>

<!-- Rootly: CVE search bar -->
<div id="rootly-search" style="
    position:fixed; top:16px; left:50%; transform:translateX(-50%);
    background:#222; border-radius:8px; padding:10px 16px;
    box-shadow:0 2px 10px rgba(0,0,0,.5); z-index:9999;
    font-family:sans-serif; display:flex; align-items:center; gap:8px;">
  <label for="cve-input" style="color:#aaa; font-size:13px; white-space:nowrap;">&#x1F50D; CVE Search</label>
  <input id="cve-input" type="text" placeholder="e.g. CVE-2024-1234" style="
    background:#333; border:1px solid #555; border-radius:4px; color:#fff;
    padding:6px 10px; font-size:13px; width:220px; outline:none;" />
  <button id="cve-search-btn" style="
    background:#4a90d9; border:none; border-radius:4px; color:#fff;
    padding:6px 14px; font-size:13px; cursor:pointer;">Search</button>
  <button id="cve-clear-btn" style="
    background:#555; border:none; border-radius:4px; color:#ccc;
    padding:6px 10px; font-size:13px; cursor:pointer;">Clear</button>
  <span id="cve-result" style="color:#aaa; font-size:12px; margin-left:4px;"></span>
</div>

<!-- Rootly: vulnerability filter bar -->
<div id="rootly-filters" style="
    position:fixed; top:60px; left:50%; transform:translateX(-50%);
    background:#222; border-radius:8px; padding:8px 14px;
    box-shadow:0 2px 10px rgba(0,0,0,.5); z-index:9999;
    font-family:sans-serif; display:flex; align-items:center; gap:6px; font-size:12px;">
  <span style="color:#aaa; margin-right:4px;">Filter:</span>
  <button class="rootly-filter-btn" data-filter="all" style="
    background:#4a90d9; border:none; border-radius:4px; color:#fff;
    padding:5px 12px; font-size:12px; cursor:pointer;">All</button>
  <button class="rootly-filter-btn" data-filter="vulnerable" style="
    background:#444; border:none; border-radius:4px; color:#ccc;
    padding:5px 12px; font-size:12px; cursor:pointer;">&#x26A0; Vulnerable</button>
  <button class="rootly-filter-btn" data-filter="safe" style="
    background:#444; border:none; border-radius:4px; color:#ccc;
    padding:5px 12px; font-size:12px; cursor:pointer;">&#x2714; Safe</button>
  <span style="color:#333; margin:0 2px;">|</span>
  <button class="rootly-filter-btn" data-filter="Critical" style="
    background:#444; border:none; border-radius:4px; color:#ff4d4d;
    padding:5px 10px; font-size:12px; cursor:pointer;">Critical</button>
  <button class="rootly-filter-btn" data-filter="High" style="
    background:#444; border:none; border-radius:4px; color:#ff8c1a;
    padding:5px 10px; font-size:12px; cursor:pointer;">High</button>
  <button class="rootly-filter-btn" data-filter="Medium" style="
    background:#444; border:none; border-radius:4px; color:#ffd11a;
    padding:5px 10px; font-size:12px; cursor:pointer;">Medium</button>
  <button class="rootly-filter-btn" data-filter="Low" style="
    background:#444; border:none; border-radius:4px; color:#79b8ff;
    padding:5px 10px; font-size:12px; cursor:pointer;">Low</button>
  <span id="filter-count" style="color:#aaa; font-size:11px; margin-left:6px;"></span>
</div>

<!-- Rootly: layout switcher -->
<div id="rootly-layouts" style="
    position:fixed; top:104px; left:50%; transform:translateX(-50%);
    background:#222; border-radius:8px; padding:8px 14px;
    box-shadow:0 2px 10px rgba(0,0,0,.5); z-index:9999;
    font-family:sans-serif; display:flex; align-items:center; gap:6px; font-size:12px;">
  <span style="color:#aaa; margin-right:4px;">Layout:</span>
  <button class="rootly-layout-btn" data-layout="tree" style="
    background:#4a90d9; border:none; border-radius:4px; color:#fff;
    padding:5px 12px; font-size:12px; cursor:pointer;">&#x1F332; Tree</button>
  <button class="rootly-layout-btn" data-layout="force" style="
    background:#444; border:none; border-radius:4px; color:#ccc;
    padding:5px 12px; font-size:12px; cursor:pointer;">&#x1F4A5; Force</button>
  <button class="rootly-layout-btn" data-layout="radial" style="
    background:#444; border:none; border-radius:4px; color:#ccc;
    padding:5px 12px; font-size:12px; cursor:pointer;">&#x25CE; Radial</button>
  <button class="rootly-layout-btn" data-layout="horizontal" style="
    background:#444; border:none; border-radius:4px; color:#ccc;
    padding:5px 12px; font-size:12px; cursor:pointer;">&#x2192; Horizontal</button>
  <button class="rootly-layout-btn" data-layout="cluster" style="
    background:#444; border:none; border-radius:4px; color:#ccc;
    padding:5px 12px; font-size:12px; cursor:pointer;">&#x2B22; Cluster</button>
  <span id="layout-label" style="color:#888; font-size:11px; margin-left:6px;">Tree (top-down)</span>
</div>

<!-- Rootly: CVE detail panel (hidden by default) -->
<div id="rootly-panel" style="
    display:none; position:fixed; top:0; right:0; width:420px; height:100%;
    background:#1e1e1e; color:#ddd; font-family:sans-serif; font-size:13px;
    box-shadow:-4px 0 20px rgba(0,0,0,.6); z-index:10000;
    overflow-y:auto; border-left:2px solid #444;">
  <div style="padding:18px;">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h2 id="panel-title" style="margin:0; font-size:16px; color:#fff;"></h2>
      <button id="panel-close" style="
          background:none; border:none; color:#aaa; font-size:22px;
          cursor:pointer; padding:0 4px;" title="Close">&times;</button>
    </div>
    <div id="panel-meta" style="margin-top:10px; color:#aaa; font-size:12px;"></div>
    <div id="panel-neighbors" style="margin-top:16px;"></div>
    <div id="panel-cves" style="margin-top:16px;"></div>
  </div>
</div>

<!-- Rootly: interaction logic -->
<script>
(function() {
  var ROOTLY_DATA = """ + node_data_json + r""";
  var SEV_COLORS = {
    Critical:'#ff4d4d', High:'#ff8c1a', Medium:'#ffd11a',
    Low:'#79b8ff', None:'#28a745', Unknown:'#666666'
  };

  var panel      = document.getElementById('rootly-panel');
  var panelTitle = document.getElementById('panel-title');
  var panelMeta  = document.getElementById('panel-meta');
  var panelNbrs  = document.getElementById('panel-neighbors');
  var panelCves  = document.getElementById('panel-cves');
  var btnClose   = document.getElementById('panel-close');
  var cveInput   = document.getElementById('cve-input');
  var cveSearchBtn = document.getElementById('cve-search-btn');
  var cveClearBtn  = document.getElementById('cve-clear-btn');
  var cveResult  = document.getElementById('cve-result');
  var filterCount = document.getElementById('filter-count');
  var filterBtns  = document.querySelectorAll('.rootly-filter-btn');
  var layoutBtns   = document.querySelectorAll('.rootly-layout-btn');
  var layoutLabel  = document.getElementById('layout-label');
  var activeFilter = 'all';
  var activeLayout = 'tree';

  /* Build reverse index: CVE ID -> [node IDs] */
  var cveIndex = {};
  Object.keys(ROOTLY_DATA).forEach(function(nodeId) {
    var cves = ROOTLY_DATA[nodeId].cves || [];
    cves.forEach(function(cv) {
      if (!cv.id) return;
      var key = cv.id.toUpperCase();
      if (!cveIndex[key]) cveIndex[key] = [];
      if (cveIndex[key].indexOf(nodeId) === -1) cveIndex[key].push(nodeId);
    });
  });

  /* Wait for vis.js network to be ready */
  var waitForNetwork = setInterval(function() {
    if (typeof network === 'undefined' || !network) return;
    clearInterval(waitForNetwork);
    attachHandlers();
  }, 200);

  function attachHandlers() {
    var allNodes = network.body.data.nodes;

    /* --- CLICK: focus on node + show panel --- */
    network.on('click', function(params) {
      if (params.nodes.length === 0) { resetView(); return; }
      var nodeId = params.nodes[0];
      var node   = allNodes.get(nodeId);
      if (!node) { resetView(); return; }

      var connected = network.getConnectedNodes(nodeId);
      var keep = new Set(connected);
      keep.add(nodeId);

      var updates = [];
      allNodes.forEach(function(n) {
        if (keep.has(n.id)) {
          updates.push({ id:n.id, opacity:1, font:{color:'white'} });
        } else {
          updates.push({ id:n.id, opacity:0.08, font:{color:'rgba(255,255,255,0.08)'} });
        }
      });
      allNodes.update(updates);

      network.focus(nodeId, { scale:1.2, animation:{ duration:400, easingFunction:'easeInOutQuad' } });
      showPanel(node, connected, allNodes);
    });

    /* --- CVE SEARCH --- */
    function doCveSearch() {
      var q = cveInput.value.trim().toUpperCase();
      if (!q) { resetView(); cveResult.textContent = ''; return; }

      var matches = cveIndex[q];
      if (!matches || !matches.length) {
        /* Try partial / substring match */
        matches = [];
        Object.keys(cveIndex).forEach(function(key) {
          if (key.indexOf(q) !== -1) {
            cveIndex[key].forEach(function(nid) {
              if (matches.indexOf(nid) === -1) matches.push(nid);
            });
          }
        });
      }

      if (!matches.length) {
        cveResult.textContent = 'No matches found';
        cveResult.style.color = '#ff4d4d';
        return;
      }

      cveResult.textContent = matches.length + ' package' + (matches.length > 1 ? 's' : '') + ' affected';
      cveResult.style.color = '#ffd11a';

      var keep = new Set(matches);
      var updates = [];
      allNodes.forEach(function(n) {
        if (keep.has(n.id)) {
          updates.push({ id:n.id, opacity:1, font:{color:'white'} });
        } else {
          updates.push({ id:n.id, opacity:0.08, font:{color:'rgba(255,255,255,0.08)'} });
        }
      });
      allNodes.update(updates);

      if (matches.length === 1) {
        network.focus(matches[0], { scale:1.2, animation:{ duration:400, easingFunction:'easeInOutQuad' } });
        var node = allNodes.get(matches[0]);
        if (node) showPanel(node, network.getConnectedNodes(matches[0]), allNodes);
      } else {
        network.fit({ nodes:matches, animation:{ duration:400, easingFunction:'easeInOutQuad' } });
        panel.style.display = 'none';
      }
    }

    cveSearchBtn.addEventListener('click', doCveSearch);
    cveInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doCveSearch(); });
    cveClearBtn.addEventListener('click', function() {
      cveInput.value = '';
      cveResult.textContent = '';
      resetView();
    });

    /* --- VULNERABILITY FILTERS --- */
    var originalNodes = [];
    var originalEdges = [];
    allNodes.forEach(function(n) { originalNodes.push(Object.assign({}, n)); });
    network.body.data.edges.forEach(function(e) { originalEdges.push(Object.assign({}, e)); });

    function nodeMatchesFilter(nodeId, filter) {
      var meta = ROOTLY_DATA[nodeId];
      if (!meta) return true; /* repo node / external deps always visible */
      var vc = meta.vuln_count || 0;
      var sev = meta.max_severity || 'None';
      if (filter === 'all') return true;
      if (filter === 'vulnerable') return vc > 0;
      if (filter === 'safe') return vc === 0;
      /* severity-specific filter */
      return sev === filter;
    }

    function applyFilter(filter) {
      activeFilter = filter;
      /* Update button styles */
      filterBtns.forEach(function(btn) {
        if (btn.getAttribute('data-filter') === filter) {
          btn.style.background = '#4a90d9';
          btn.style.color = '#fff';
        } else {
          btn.style.background = '#444';
          var f = btn.getAttribute('data-filter');
          var colorMap = {Critical:'#ff4d4d',High:'#ff8c1a',Medium:'#ffd11a',Low:'#79b8ff'};
          btn.style.color = colorMap[f] || '#ccc';
        }
      });

      /* Determine which nodes to keep */
      var keepIds = new Set();
      var shown = 0;
      originalNodes.forEach(function(n) {
        if (nodeMatchesFilter(n.id, filter)) {
          keepIds.add(n.id);
          shown++;
        }
      });

      /* Always keep repo node visible */
      originalNodes.forEach(function(n) {
        if (!ROOTLY_DATA[n.id] && (n.shape === 'image' || n.shape === 'database')) keepIds.add(n.id);
      });

      /* Update nodes: add/remove based on filter */
      var currentIds = new Set();
      allNodes.forEach(function(n) { currentIds.add(n.id); });

      /* Remove nodes that shouldn't be visible */
      var toRemove = [];
      currentIds.forEach(function(id) {
        if (!keepIds.has(id)) toRemove.push(id);
      });
      if (toRemove.length) allNodes.remove(toRemove);

      /* Add back nodes that should be visible but aren't */
      var toAdd = [];
      originalNodes.forEach(function(n) {
        if (keepIds.has(n.id) && !currentIds.has(n.id)) toAdd.push(n);
      });
      if (toAdd.length) allNodes.update(toAdd);

      /* Restore edges for visible node pairs */
      var allEdges = network.body.data.edges;
      allEdges.clear();
      var edgesToAdd = [];
      originalEdges.forEach(function(e) {
        if (keepIds.has(e.from) && keepIds.has(e.to)) edgesToAdd.push(e);
      });
      allEdges.update(edgesToAdd);

      filterCount.textContent = shown + ' / ' + originalNodes.length + ' shown';

      panel.style.display = 'none';
      network.fit({ animation:{ duration:400, easingFunction:'easeInOutQuad' } });
    }

    filterBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        applyFilter(btn.getAttribute('data-filter'));
      });
    });

    /* --- LAYOUT SWITCHER --- */
    var LAYOUTS = {
      tree: {
        label: 'Tree (top-down)',
        opts: {
          layout: { hierarchical: { enabled:true, direction:'UD', sortMethod:'directed',
            levelSeparation:200, nodeSpacing:150, treeSpacing:250,
            blockShifting:true, edgeMinimization:true, parentCentralization:true }},
          physics: { hierarchicalRepulsion: { centralGravity:0, springLength:150,
            springConstant:0.01, nodeDistance:180, damping:0.09 },
            solver:'hierarchicalRepulsion', stabilization:{iterations:300} },
          edges: { color:{color:'#555555',highlight:'#ffffff'},
            smooth:{type:'cubicBezier',forceDirection:'vertical',roundness:0.4},
            arrows:{to:{enabled:true,scaleFactor:0.5}} }
        }
      },
      force: {
        label: 'Force-directed',
        opts: {
          layout: { hierarchical: { enabled:false } },
          physics: { forceAtlas2Based: { gravitationalConstant:-120, centralGravity:0.012,
            springLength:160, springConstant:0.03, damping:0.4 },
            solver:'forceAtlas2Based', stabilization:{iterations:300} },
          edges: { color:{color:'#555555',highlight:'#ffffff'},
            smooth:{type:'continuous'},
            arrows:{to:{enabled:true,scaleFactor:0.5}} }
        }
      },
      radial: {
        label: 'Radial',
        opts: {
          layout: { hierarchical: { enabled:false } },
          physics: { barnesHut: { gravitationalConstant:-3000, centralGravity:0.5,
            springLength:120, springConstant:0.04, damping:0.09 },
            solver:'barnesHut', stabilization:{iterations:300} },
          edges: { color:{color:'#555555',highlight:'#ffffff'},
            smooth:{type:'continuous'},
            arrows:{to:{enabled:true,scaleFactor:0.5}} }
        },
        afterStabilize: function() {
          /* Pin repo node to center */
          var repoId = originalNodes.find(function(n){ return !ROOTLY_DATA[n.id]; });
          if (repoId) {
            network.moveNode(repoId.id, 0, 0);
            allNodes.update({id:repoId.id, fixed:{x:true,y:true}});
          }
        }
      },
      horizontal: {
        label: 'Horizontal (left-right)',
        opts: {
          layout: { hierarchical: { enabled:true, direction:'LR', sortMethod:'directed',
            levelSeparation:250, nodeSpacing:120, treeSpacing:200,
            blockShifting:true, edgeMinimization:true, parentCentralization:true }},
          physics: { hierarchicalRepulsion: { centralGravity:0, springLength:150,
            springConstant:0.01, nodeDistance:160, damping:0.09 },
            solver:'hierarchicalRepulsion', stabilization:{iterations:300} },
          edges: { color:{color:'#555555',highlight:'#ffffff'},
            smooth:{type:'cubicBezier',forceDirection:'horizontal',roundness:0.4},
            arrows:{to:{enabled:true,scaleFactor:0.5}} }
        }
      },
      cluster: {
        label: 'Clustered',
        opts: {
          layout: { hierarchical: { enabled:false } },
          physics: { repulsion: { centralGravity:0.2, springLength:200,
            springConstant:0.05, nodeDistance:250, damping:0.09 },
            solver:'repulsion', stabilization:{iterations:400} },
          edges: { color:{color:'#555555',highlight:'#ffffff'},
            smooth:{type:'dynamic'},
            arrows:{to:{enabled:true,scaleFactor:0.5}} }
        }
      }
    };

    function applyLayout(key) {
      activeLayout = key;
      var layout = LAYOUTS[key];
      /* Update button styles */
      layoutBtns.forEach(function(btn) {
        if (btn.getAttribute('data-layout') === key) {
          btn.style.background = '#4a90d9';
          btn.style.color = '#fff';
        } else {
          btn.style.background = '#444';
          btn.style.color = '#ccc';
        }
      });
      layoutLabel.textContent = layout.label;

      /* Unfix all nodes before switching */
      var updates = [];
      allNodes.forEach(function(n) {
        updates.push({id:n.id, fixed:{x:false,y:false}});
      });
      allNodes.update(updates);

      network.setOptions(layout.opts);

      if (layout.afterStabilize) {
        network.once('stabilized', layout.afterStabilize);
      }

      network.stabilize(300);
      setTimeout(function() {
        network.fit({ animation:{ duration:600, easingFunction:'easeInOutQuad' } });
      }, 500);
    }

    layoutBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        applyLayout(btn.getAttribute('data-layout'));
      });
    });

    /* --- CLOSE / RESET --- */
    btnClose.addEventListener('click', function() { resetView(); });

    function resetView() {
      panel.style.display = 'none';
      if (activeFilter !== 'all') {
        applyFilter('all');
        return;
      }
      var updates = [];
      allNodes.forEach(function(n) {
        updates.push({ id:n.id, opacity:1, font:{color:'white'} });
      });
      allNodes.update(updates);
      network.fit({ animation:{ duration:400, easingFunction:'easeInOutQuad' } });
    }
  }

  function showPanel(node, neighborIds, allNodes) {
    panel.style.display = 'block';
    var nodeId = node.label || node.id;
    panelTitle.textContent = nodeId;

    var meta = ROOTLY_DATA[nodeId] || {};
    var sev  = meta.max_severity || 'None';
    var fmt  = meta.pkg_format   || '';
    var vc   = meta.vuln_count   != null ? meta.vuln_count : '\u2014';
    panelMeta.innerHTML =
      '<b>Format:</b> ' + esc(fmt) +
      ' &nbsp;|&nbsp; <b>Severity:</b> <span style="color:' +
      (SEV_COLORS[sev]||'#28a745') + '">' + esc(sev) + '</span>' +
      ' &nbsp;|&nbsp; <b>Vulns:</b> ' + vc;

    /* Neighbors section */
    var nbrs = [];
    neighborIds.forEach(function(nid) {
      var nn = allNodes.get(nid);
      if (nn) nbrs.push(nn);
    });
    if (nbrs.length) {
      var h = '<h3 style="margin:0 0 6px; font-size:14px; color:#ccc;">Connected Packages (' + nbrs.length + ')</h3>';
      h += '<div style="max-height:180px; overflow-y:auto;">';
      nbrs.forEach(function(nn) {
        var c = nn.color;
        if (typeof c === 'object') c = c.border || c.background || '#666';
        if (!c || typeof c !== 'string') c = '#666';
        h += '<div style="padding:3px 0; border-bottom:1px solid #333;">' +
             '<span style="color:' + c + ';">&#x25CF;</span> ' + esc(nn.label || nn.id) + '</div>';
      });
      h += '</div>';
      panelNbrs.innerHTML = h;
    } else {
      panelNbrs.innerHTML = '';
    }

    /* CVE section */
    var cves = meta.cves || [];
    if (cves.length) {
      var h = '<h3 style="margin:0 0 6px; font-size:14px; color:#ccc;">CVEs (' + cves.length + ')</h3>';
      h += '<div style="max-height:400px; overflow-y:auto;">';
      cves.forEach(function(cv) {
        var sc = SEV_COLORS[cv.severity] || '#666';
        h += '<div style="padding:8px; margin-bottom:6px; background:#2a2a2a; border-radius:4px; border-left:3px solid ' + sc + ';">';
        var label = esc(cv.id || 'Unknown');
        if (cv.url) {
          h += '<a href="' + esc(cv.url) + '" target="_blank" rel="noopener" style="color:#6cb6ff; text-decoration:none; font-weight:bold;">' + label + '</a>';
        } else {
          h += '<b>' + label + '</b>';
        }
        h += ' <span style="color:' + sc + '; font-size:11px; font-weight:bold;">' + esc(cv.severity) + '</span>';
        /* Show which other packages share this CVE */
        var shared = cveIndex[(cv.id||'').toUpperCase()] || [];
        var others = shared.filter(function(s) { return s !== nodeId; });
        if (others.length) {
          h += '<div style="margin-top:3px; font-size:11px; color:#e8a845;">\u26a0 Shared with: ' + others.map(esc).join(', ') + '</div>';
        }
        if (cv.description) {
          h += '<div style="margin-top:4px; color:#999; font-size:12px;">' + esc(cv.description).substring(0, 200);
          if (cv.description.length > 200) h += '\u2026';
          h += '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
      panelCves.innerHTML = h;
    } else {
      panelCves.innerHTML = '<p style="color:#666;">No CVEs recorded for this package.</p>';
    }
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s)));
    return d.innerHTML;
  }
})();
</script>
"""
    with open(html_path, "r") as f:
        content = f.read()
    content = content.replace("</body>", inject + "</body>")
    with open(html_path, "w") as f:
        f.write(content)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="rootly",
        description="Visualize Cloudsmith artifact dependencies & security status.",
    )
    p.add_argument("-o", "--owner", default=os.getenv("CLOUDSMITH_OWNER"), help="Cloudsmith org/owner (env: CLOUDSMITH_OWNER)")
    p.add_argument("-r", "--repo", default=os.getenv("CLOUDSMITH_REPO"), help="Cloudsmith repository (env: CLOUDSMITH_REPO)")
    p.add_argument("-k", "--api-key", default=os.getenv("CLOUDSMITH_API_KEY"), help="API key (env: CLOUDSMITH_API_KEY)")
    p.add_argument("--output", default="cloudsmith_security_map.html", help="Output HTML file (default: cloudsmith_security_map.html)")
    p.add_argument("--no-deps", action="store_true", help="Skip fetching per-package dependencies (faster)")
    return p.parse_args(argv)


BANNER = r"""
[bold green] ____             _   _
|  _ \ ___   ___ | |_| |_   _
| |_) / _ \ / _ \| __| | | | |
|  _ < (_) | (_) | |_| | |_| |
|_| \_\___/ \___/ \__|_|\__, |
                        |___/[/]
[dim]Cloudsmith Artifact Security Visualizer[/]
"""


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)

    console.print(BANNER)

    missing = []
    if not args.api_key:
        missing.append("--api-key / CLOUDSMITH_API_KEY")
    if not args.owner:
        missing.append("--owner / CLOUDSMITH_OWNER")
    if not args.repo:
        missing.append("--repo / CLOUDSMITH_REPO")
    if missing:
        console.print(
            Panel(
                "[bold red]Missing required configuration:[/]\n"
                + "\n".join(f"  • [yellow]{m}[/]" for m in missing)
                + "\n\n[dim]Set via CLI flags or environment variables (see .env.example).[/]",
                title="✘ Configuration Error",
                border_style="red",
            )
        )
        sys.exit(1)

    console.print(f"  [bold]Owner:[/] [cyan]{args.owner}[/]")
    console.print(f"  [bold]Repo:[/]  [cyan]{args.repo}[/]")
    console.print(f"  [bold]Output:[/] [cyan]{args.output}[/]")
    console.print()

    session = _session(args.api_key)
    build_graph(session, args.owner, args.repo, args.output, include_deps=not args.no_deps)


if __name__ == "__main__":
    main()