import { useMemo } from "react";
import { useState } from "react";
import type { GraphResponse, GraphNode, CVERecord } from "../types";
import { SEVERITY_COLORS, SEVERITY_RANK } from "../types";
import { getFormatIcon } from "../lib/formatIcons";

interface Props {
  data: GraphResponse;
  nodeId: string;
  owner: string;
  repo: string;
  expanded?: boolean;
}

export default function SidePanel({ data, nodeId, owner, repo, expanded = false }: Props) {
  const [sevFilter, setSevFilter] = useState<string>("All");
  const node = data.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  /* Repo node gets a completely different detail view */
  if (node.type === "repo") {
    return <RepoDetail data={data} node={node} owner={owner} repo={repo} expanded={expanded} />;
  }

  const d = node.data;
  const sev = d.max_severity || "None";
  const sevColor = SEVERITY_COLORS[sev] || SEVERITY_COLORS.None;

  const sizeStr =
    d.size > 1048576
      ? `${(d.size / 1048576).toFixed(1)} MB`
      : d.size > 1024
        ? `${(d.size / 1024).toFixed(1)} KB`
        : d.size
          ? `${d.size} B`
          : "—";

  const uploadDate = d.uploaded_at && d.uploaded_at !== "N/A"
    ? new Date(d.uploaded_at).toLocaleDateString()
    : "—";

  /* Build CVE→packages reverse index for "also affects" */
  const cveIndex: Record<string, string[]> = {};
  for (const n of data.nodes) {
    for (const c of n.data.cves) {
      if (!c.id) continue;
      if (!cveIndex[c.id]) cveIndex[c.id] = [];
      if (!cveIndex[c.id].includes(n.id)) cveIndex[c.id].push(n.id);
    }
  }

  const cloudsmithUrl = node.type === "package" && d.slug
    ? `https://app.cloudsmith.com/${owner}/r/${repo}/package-group/${d.format}/${encodeURIComponent(node.label)}/${d.slug}`
    : null;

  return (
    <div className={`side-panel${expanded ? " side-panel-expanded" : ""}`}>
      <div className="panel-summary">
      <div className="panel-header">
        <h2 className="panel-title">{node.label}</h2>
        <span className="panel-version">{d.version}</span>
      </div>

      <div className="panel-status-row">
        <span className="severity-badge" style={{ background: sevColor }}>
          {sev}
        </span>
        <span className="vuln-count-inline" style={d.vuln_count > 0 ? { color: sevColor } : undefined}>
          {d.vuln_count} {d.vuln_count === 1 ? "vulnerability" : "vulnerabilities"}
        </span>
        {cloudsmithUrl && (
          <a
            className="cloudsmith-view-btn"
            href={cloudsmithUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="View in Cloudsmith"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        )}
      </div>

      {/* Metadata grid */}
      <div className="panel-meta">
        <MetaRow label="Format" value={d.format} />
        <MetaRow label="License" value={d.license} />
        <MetaRow label="Size" value={sizeStr} />
        <MetaRow label="Downloads" value={String(d.downloads ?? "—")} />
        <MetaRow label="Scan Status" value={d.scan_status} />
        <MetaRow label="Uploaded" value={uploadDate} />
      </div>
      </div>

      <div className="panel-details">

      {/* CVE list */}
      {d.cves.length > 0 && (() => {
        const sorted = [...d.cves].sort(
          (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
        );
        const sevCounts: Record<string, number> = {};
        for (const c of sorted) {
          sevCounts[c.severity] = (sevCounts[c.severity] || 0) + 1;
        }
        const filtered = sevFilter === "All" ? sorted : sorted.filter((c) => c.severity === sevFilter);
        const filterOptions = ["All", "Critical", "High", "Medium", "Low"].filter(
          (s) => s === "All" || sevCounts[s]
        );

        return (
          <div className="panel-section">
            <h3 className="section-title">
              CVEs ({filtered.length}{filtered.length !== d.cves.length ? ` of ${d.cves.length}` : ""}
              {d.vuln_count > d.cves.length ? ` — ${d.vuln_count} total` : ""})
            </h3>
            <div className="cve-filter-bar">
              {filterOptions.map((s) => (
                <button
                  key={s}
                  className={`cve-filter-btn${sevFilter === s ? " active" : ""}`}
                  style={sevFilter === s && s !== "All" ? { background: SEVERITY_COLORS[s], borderColor: SEVERITY_COLORS[s] } : undefined}
                  onClick={() => setSevFilter(s)}
                >
                  {s}{s !== "All" ? ` (${sevCounts[s]})` : ""}
                </button>
              ))}
            </div>
            <div className="cve-list">
              {filtered.map((cve, i) => (
                <CveCard
                  key={`${cve.id}-${i}`}
                  cve={cve}
                  otherPackages={(cveIndex[cve.id] || []).filter(
                    (id) => id !== nodeId,
                  )}
                />
              ))}
            </div>
          </div>
        );
      })()}

      {d.vuln_count > 0 && d.cves.length === 0 && (
        <div className="panel-section">
          <p style={{ color: "#e8a845" }}>
            ⚠ {d.vuln_count} vulnerabilities detected but details could not be
            retrieved.
          </p>
        </div>
      )}

      {d.vuln_count === 0 && node.type === "package" && (
        <div className="panel-section">
          <p style={{ color: "#666" }}>No CVEs recorded for this package.</p>
        </div>
      )}
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <>
      <span className="meta-label">{label}</span>
      <span className="meta-value" style={valueColor ? { color: valueColor, fontWeight: 600 } : undefined}>
        {value || "—"}
      </span>
    </>
  );
}

function CveCard({
  cve,
  otherPackages,
}: {
  cve: CVERecord;
  otherPackages: string[];
}) {
  const color = SEVERITY_COLORS[cve.severity] || "#666";
  return (
    <div className="cve-card" style={{ borderLeftColor: color }}>
      <div className="cve-header">
        <span className="cve-id">{cve.id || "Unknown"}</span>
        <span
          className="cve-severity-badge"
          style={{ color, borderColor: color }}
        >
          {cve.severity}
        </span>
      </div>
      {cve.affected && (
        <div className="cve-affected">
          📦 <strong>Affected:</strong> {cve.affected}
          {cve.affected_version ? ` @ ${cve.affected_version}` : ""}
        </div>
      )}
      {cve.fixed_in && (
        <div className="cve-fixed">
          ✅ <strong>Fixed in:</strong> {cve.fixed_in}
        </div>
      )}
      {cve.description && (
        <div className="cve-description">
          {cve.description.length > 250
            ? cve.description.slice(0, 250) + "…"
            : cve.description}
        </div>
      )}
      <div className="cve-links">
        {cve.nvd_url && (
          <a href={cve.nvd_url} target="_blank" rel="noopener noreferrer">
            🛡 NVD
          </a>
        )}
        {cve.ghsa_url && (
          <a href={cve.ghsa_url} target="_blank" rel="noopener noreferrer">
            📋 GitHub Advisory
          </a>
        )}
        {cve.url && cve.url !== cve.nvd_url && cve.url !== cve.ghsa_url && (
          <a href={cve.url} target="_blank" rel="noopener noreferrer">
            🔗 Advisory
          </a>
        )}
      </div>
      {otherPackages.length > 0 && (
        <div className="cve-shared">
          ⚠ Also affects: {otherPackages.join(", ")}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Repo Detail View
   ================================================================ */

function RepoDetail({
  data,
  node,
  owner,
  repo,
  expanded = false,
}: {
  data: GraphResponse;
  node: GraphNode;
  owner: string;
  repo: string;
  expanded?: boolean;
}) {
  const stats = useMemo(() => {
    const packages = data.nodes.filter((n) => n.type === "package");
    const deps = data.nodes.filter((n) => n.type === "dependency");

    /* Format breakdown */
    const formatCounts: Record<string, number> = {};
    for (const p of packages) {
      const f = p.data.format || "unknown";
      formatCounts[f] = (formatCounts[f] || 0) + 1;
    }
    const formats = Object.entries(formatCounts)
      .sort((a, b) => b[1] - a[1]);

    /* Vulnerability breakdown */
    let totalVulns = 0;
    const sevCounts: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    const allCves = new Set<string>();
    for (const p of packages) {
      totalVulns += p.data.vuln_count;
      for (const c of p.data.cves) {
        if (c.id) allCves.add(c.id);
        if (sevCounts[c.severity] !== undefined) {
          sevCounts[c.severity]++;
        }
      }
    }

    /* Packages with most vulns */
    const topVuln = [...packages]
      .filter((p) => p.data.vuln_count > 0)
      .sort((a, b) => b.data.vuln_count - a.data.vuln_count)
      .slice(0, 5);

    return { packages, deps, formats, totalVulns, sevCounts, uniqueCves: allCves.size, topVuln };
  }, [data]);

  const repoUrl = `https://app.cloudsmith.com/${owner}/r/${repo}/`;

  return (
    <div className={`side-panel${expanded ? " side-panel-expanded" : ""}`}>
      <div className="panel-summary">
      <div className="panel-header">
        <div className="repo-header-row">
          <img src="/cloudsmith.png" alt="" className="repo-header-logo" />
          <div>
            <h2 className="panel-title">{node.label}</h2>
            <span className="panel-version">{owner}</span>
          </div>
        </div>
      </div>

      <div className="panel-status-row">
        <a
          className="cloudsmith-view-btn"
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="View in Cloudsmith"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
      </div>

      {/* Overview cards */}
      <div className="repo-cards">
        <div className="repo-card">
          <span className="repo-card-value">{stats.packages.length}</span>
          <span className="repo-card-label">Packages</span>
        </div>
        <div className="repo-card">
          <span className="repo-card-value">{stats.deps.length}</span>
          <span className="repo-card-label">Dependencies</span>
        </div>
        <div className="repo-card">
          <span className="repo-card-value">{stats.uniqueCves}</span>
          <span className="repo-card-label">Unique CVEs</span>
        </div>
        <div className="repo-card">
          <span className="repo-card-value">{stats.totalVulns}</span>
          <span className="repo-card-label">Total Findings</span>
        </div>
      </div>
      </div>

      <div className="panel-details">

      {/* Format breakdown */}
      <div className="panel-section">
        <h3 className="section-title">Package Formats</h3>
        <div className="repo-format-grid">
          {stats.formats.map(([fmt, count]) => {
            const icon = getFormatIcon(fmt);
            return (
              <div key={fmt} className="repo-format-card">
                <div className="repo-format-card-icon">
                  {icon ? (
                    <img src={icon} alt={fmt} />
                  ) : (
                    <span className="repo-format-card-icon-fallback">{fmt.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="repo-format-card-meta">
                  <span className="repo-format-card-name">{fmt}</span>
                  <span className="repo-format-card-count">{count}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Severity breakdown */}
      <div className="panel-section">
        <h3 className="section-title">Severity Breakdown</h3>
        <div className="repo-sev-bars">
          {(["Critical", "High", "Medium", "Low"] as const).map((s) => {
            const count = stats.sevCounts[s];
            const max = Math.max(...Object.values(stats.sevCounts), 1);
            return (
              <div key={s} className="repo-sev-row">
                <span className="repo-sev-label" style={{ color: SEVERITY_COLORS[s] }}>{s}</span>
                <div className="repo-sev-track">
                  <div
                    className="repo-sev-fill"
                    style={{ width: `${(count / max) * 100}%`, background: SEVERITY_COLORS[s] }}
                  />
                </div>
                <span className="repo-sev-count">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Most vulnerable packages */}
      {stats.topVuln.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Most Vulnerable</h3>
          <div className="repo-top-vuln">
            {stats.topVuln.map((p) => {
              const s = p.data.max_severity || "None";
              return (
                <div key={p.id} className="repo-vuln-row">
                  <span className="repo-vuln-name">{p.label}</span>
                  <span className="repo-vuln-badge" style={{ background: SEVERITY_COLORS[s] }}>
                    {p.data.vuln_count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
