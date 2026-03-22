#!/usr/bin/env python3
"""Rootly – Cloudsmith artifact dependency & security visualizer."""

import argparse
import json
import logging
import os
import sys
import time

import requests
import networkx as nx
from dotenv import load_dotenv
from pyvis.network import Network

load_dotenv()

log = logging.getLogger("rootly")

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
            log.warning("Rate-limited – waiting %ds (attempt %d/%d)", retry_after, attempt, MAX_RETRIES)
            time.sleep(retry_after)
            delay *= 2
            continue

        resp.raise_for_status()
        return resp.json()

    log.error("Max retries exceeded for %s", url)
    sys.exit(1)


def fetch_all_packages(session: requests.Session, owner: str, repo: str) -> list[dict]:
    """Fetch every package in the repo, handling pagination."""
    url = f"{BASE_URL}/packages/{owner}/{repo}/"
    page = 1
    all_packages: list[dict] = []

    while True:
        log.info("Fetching packages page %d …", page)
        data = _api_get(session, url, params={"page": page, "page_size": 100})

        if not data:
            break

        all_packages.extend(data)

        # Cloudsmith returns fewer results on the last page
        if len(data) < 100:
            break
        page += 1

    log.info("Fetched %d packages total", len(all_packages))
    return all_packages


def fetch_dependencies(session: requests.Session, owner: str, repo: str, slug: str) -> list[dict]:
    """Fetch dependency list for a single package (best-effort)."""
    url = f"{BASE_URL}/packages/{owner}/{repo}/{slug}/dependencies/"
    try:
        data = _api_get(session, url)
        return data.get("dependencies", []) if isinstance(data, dict) else data
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            log.debug("No dependency info for %s (404)", slug)
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
            log.debug("No vulnerability scans for %s (%d)", slug, exc.response.status_code)
            return []
        raise


def fetch_scan_details(session: requests.Session, owner: str, repo: str, slug: str, scan_id: str) -> dict:
    """Fetch detailed vulnerability scan results including individual CVEs."""
    url = f"{BASE_URL}/vulnerabilities/{owner}/{repo}/{slug}/{scan_id}/"
    try:
        return _api_get(session, url)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            log.debug("Scan %s not found for %s (404)", scan_id, slug)
            return {}
        raise


def get_package_vulnerabilities(
    session: requests.Session, owner: str, repo: str, slug: str
) -> tuple[str | None, list[dict]]:
    """Return (max_severity, vulnerabilities) for a package.

    Queries the scan list endpoint to find the most recent scan, then
    fetches its details to extract individual vulnerability records.
    """
    scans = fetch_vulnerability_scans(session, owner, repo, slug)
    if not scans:
        return None, []

    # Pick the most recent scan (first in list, or sort by created_at)
    latest = scans[0]
    for s in scans:
        if s.get("created_at", "") > latest.get("created_at", ""):
            latest = s

    scan_id = latest.get("identifier") or latest.get("slug_perm") or latest.get("id")
    if not scan_id:
        log.debug("No scan identifier found for %s", slug)
        return latest.get("max_severity"), []

    details = fetch_scan_details(session, owner, repo, slug, str(scan_id))
    if not details:
        return latest.get("max_severity"), []

    vulns = details.get("vulnerabilities", details.get("results", []))
    if not isinstance(vulns, list):
        vulns = []

    # Determine max severity from actual vulnerability data
    max_sev = details.get("max_severity")
    if not max_sev and vulns:
        best_rank = 0
        for v in vulns:
            v_sev = v.get("severity", v.get("max_severity", ""))
            rank = SEVERITY_RANK.get(v_sev, 0)
            if rank > best_rank:
                best_rank = rank
                max_sev = v_sev

    return max_sev, vulns


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
    G = nx.DiGraph()

    packages = fetch_all_packages(session, owner, repo)
    if not packages:
        log.error("No packages found in %s/%s – check owner/repo and API key.", owner, repo)
        sys.exit(1)

    # Map slug -> display name for edge building
    slug_to_name: dict[str, str] = {}

    for idx, pkg in enumerate(packages, 1):
        slug = pkg["slug_perm"]
        name = f"{pkg['name']}@{pkg['version']}"
        downloads = pkg.get("downloads", 0)
        scan_status = pkg.get("security_scan_status", "Unknown")

        # Fetch real vulnerability data from scan endpoints
        log.info("Fetching vulns %d/%d: %s", idx, len(packages), name)
        max_sev, vulns = get_package_vulnerabilities(session, owner, repo, slug)

        # Build vulnerability breakdown for tooltip
        vuln_count = len(vulns)
        # Structured CVE records for the detail panel
        cve_records: list[dict] = []
        if vulns:
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
                if cve_id and len(cve_lines) < 10:  # cap at 10 CVEs in tooltip
                    cve_lines.append(f"{cve_id} ({v_sev})")

            breakdown = " / ".join(f"{sev}: {cnt}" for sev, cnt in sorted(
                sev_counts.items(), key=lambda x: SEVERITY_RANK.get(x[0], 0), reverse=True
            ))
            cve_list_html = "<br>".join(cve_lines)
            if len(vulns) > 10:
                cve_list_html += f"<br><i>… and {len(vulns) - 10} more</i>"
        else:
            breakdown = "None found"
            cve_list_html = ""

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

        G.add_node(
            name,
            label=name,
            color=severity_color(max_sev),
            shape=severity_shape(max_sev),
            size=node_size,
            title=tooltip,
            # Structured data used by the click-to-filter panel
            cves=json.dumps(cve_records),
            max_severity=max_sev or "None",
            pkg_format=pkg.get("format", "N/A"),
            vuln_count=vuln_count,
        )
        slug_to_name[slug] = name

    # Dependency edges
    if include_deps:
        for idx, slug in enumerate(slug_to_name, 1):
            log.info("Fetching deps %d/%d: %s", idx, len(slug_to_name), slug)
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
                        title=f"<b>{dep_label}</b><br>(external / unscanned)",
                    )
                G.add_edge(src_name, dep_label)

    # Build interactive visualisation
    net = Network(
        height="900px",
        width="100%",
        bgcolor="#1a1a1a",
        font_color="white",
        directed=True,
        select_menu=True,
        filter_menu=True,
    )
    net.from_nx(G)
    net.set_options("""
    {
      "physics": {
        "forceAtlas2Based": {
          "gravitationalConstant": -80,
          "centralGravity": 0.008,
          "springLength": 120,
          "springConstant": 0.04
        },
        "solver": "forceAtlas2Based",
        "stabilization": {"iterations": 200}
      },
      "interaction": {
        "hover": true,
        "tooltipDelay": 100,
        "navigationButtons": true
      },
      "edges": {
        "arrows": {"to": {"enabled": true, "scaleFactor": 0.5}},
        "color": {"color": "#555555", "highlight": "#ffffff"},
        "smooth": {"type": "continuous"}
      }
    }
    """)

    net.save_graph(output)

    # Inject legend + click-to-filter panel into the saved HTML
    _inject_ui(output)

    log.info("Graph saved → %s  (%d nodes, %d edges)", output, G.number_of_nodes(), G.number_of_edges())


def _inject_ui(html_path: str) -> None:
    """Inject legend, detail panel, and click-to-filter JS into the HTML."""
    inject = r"""
<!-- Rootly: severity legend -->
<div id="rootly-legend" style="
    position:fixed; bottom:16px; right:16px; background:#222; color:#eee;
    padding:14px 18px; border-radius:8px; font-family:sans-serif; font-size:13px;
    box-shadow:0 2px 10px rgba(0,0,0,.5); z-index:9999;">
  <b style="font-size:14px;">Rootly – Severity Legend</b>
  <div style="margin-top:8px;">
    <span style="color:#ff4d4d;">&#x25C6;</span> Critical &nbsp;
    <span style="color:#ff8c1a;">&#x25CF;</span> High &nbsp;
    <span style="color:#ffd11a;">&#x25CF;</span> Medium &nbsp;
    <span style="color:#79b8ff;">&#x25CF;</span> Low &nbsp;
    <span style="color:#28a745;">&#x25CF;</span> Safe &nbsp;
    <span style="color:#666666;">&#x25CF;</span> Unscanned
  </div>
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

<!-- Rootly: click-to-filter logic -->
<script>
(function() {
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

  /* Wait for vis.js network to be ready */
  var waitForNetwork = setInterval(function() {
    if (typeof network === 'undefined' || !network) return;
    clearInterval(waitForNetwork);
    attachHandlers();
  }, 200);

  function attachHandlers() {
    var allNodes  = network.body.data.nodes;
    var allEdges  = network.body.data.edges;
    var origNodes = {}; /* cache original visual properties */

    allNodes.forEach(function(n) {
      origNodes[n.id] = { color: n.color, hidden: false, opacity: 1 };
    });

    /* --- CLICK: focus on node + show panel --- */
    network.on('click', function(params) {
      if (params.nodes.length === 0) { resetView(); return; }
      var nodeId = params.nodes[0];
      var node   = allNodes.get(nodeId);
      if (!node) { resetView(); return; }

      /* Connected neighbor IDs */
      var connected = network.getConnectedNodes(nodeId);
      var keep = new Set(connected);
      keep.add(nodeId);

      /* Dim non-related nodes */
      var updates = [];
      allNodes.forEach(function(n) {
        if (keep.has(n.id)) {
          updates.push({ id:n.id, opacity:1, font:{color:'white'} });
        } else {
          updates.push({ id:n.id, opacity:0.08, font:{color:'rgba(255,255,255,0.08)'} });
        }
      });
      allNodes.update(updates);

      /* Focus camera */
      network.focus(nodeId, { scale:1.2, animation:{ duration:400, easingFunction:'easeInOutQuad' } });

      /* Populate panel */
      showPanel(node, connected, allNodes);
    });

    /* --- CLOSE / RESET --- */
    btnClose.addEventListener('click', function() { resetView(); });

    function resetView() {
      panel.style.display = 'none';
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
    panelTitle.textContent = node.label || node.id;

    var sev  = node.max_severity || 'None';
    var fmt  = node.pkg_format   || '';
    var vc   = node.vuln_count   != null ? node.vuln_count : '—';
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
        if (typeof c === 'object') c = c.background || c.border || '#666';
        h += '<div style="padding:3px 0; border-bottom:1px solid #333;">' +
             '<span style="color:' + c + ';">&#x25CF;</span> ' + esc(nn.label || nn.id) + '</div>';
      });
      h += '</div>';
      panelNbrs.innerHTML = h;
    } else {
      panelNbrs.innerHTML = '';
    }

    /* CVE section */
    var cves = [];
    try { cves = JSON.parse(node.cves || '[]'); } catch(e) {}
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
        if (cv.description) {
          h += '<div style="margin-top:4px; color:#999; font-size:12px;">' + esc(cv.description).substring(0, 200);
          if (cv.description.length > 200) h += '…';
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
    p.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    missing = []
    if not args.api_key:
        missing.append("--api-key / CLOUDSMITH_API_KEY")
    if not args.owner:
        missing.append("--owner / CLOUDSMITH_OWNER")
    if not args.repo:
        missing.append("--repo / CLOUDSMITH_REPO")
    if missing:
        log.error("Missing required config: %s", ", ".join(missing))
        log.error("Set via CLI flags or environment variables (see .env.example).")
        sys.exit(1)

    session = _session(args.api_key)
    build_graph(session, args.owner, args.repo, args.output, include_deps=not args.no_deps)


if __name__ == "__main__":
    main()