/**
 * The repository itself: its formats, severity breakdown and worst packages.
 */
import { useMemo, useState } from "react";
import { currentTheme } from "../../lib/theme";
import SeverityMark from "../SeverityMark";
import type { GraphNode, GraphResponse, Severity } from "../../types";
import { SEVERITY_COLORS, SEVERITY_RANK } from "../../types";
import { apiFetch } from "../../lib/auth";
import { getFormatIcon } from "../../lib/formatIcons";
import { EMPTY_SEVERITIES, MetaRow, packageMatchesFilter } from "./shared";

export default function RepoPanel({
  data,
  node,
  owner,
  repo,
  expanded = false,
  severities = EMPTY_SEVERITIES,
  formatFilter = null,
  onSeveritiesChange,
  onFormatFilterChange,
  onNodeSelect,
}: {
  data: GraphResponse;
  node: GraphNode;
  owner: string;
  repo: string;
  expanded?: boolean;
  severities?: Set<Severity>;
  formatFilter?: string | null;
  onSeveritiesChange?: (s: Set<Severity>) => void;
  onFormatFilterChange?: (f: string | null) => void;
  onNodeSelect?: (id: string) => void;
}) {
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function handleRepoReport() {
    if (reportLoading || reportDone) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const resp = await apiFetch(
        `/api/vulnly-repo-report/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?theme=${currentTheme()}`,
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vulnly-${owner}-${repo}-repo-summary.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setReportDone(true);
      setTimeout(() => setReportDone(false), 2500);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setReportLoading(false);
    }
  }

  const stats = useMemo(() => {
    const packages = data.nodes.filter((n) => n.type === "package");
    const deps = data.nodes.filter((n) => n.type === "dependency");

    /* Format breakdown */
    const formatCounts: Record<string, number> = {};
    const filteredFormatCounts: Record<string, number> = {};
    for (const p of packages) {
      const f = p.data.format || "unknown";
      formatCounts[f] = (formatCounts[f] || 0) + 1;
      if (packageMatchesFilter(p, severities)) {
        filteredFormatCounts[f] = (filteredFormatCounts[f] || 0) + 1;
      }
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

    return { packages, deps, formats, filteredFormatCounts, totalVulns, sevCounts, uniqueCves: allCves.size, topVuln };
  }, [data, severities]);

  const repoUrl = `https://app.cloudsmith.com/${owner}/r/${repo}/`;

  const toggleSeverity = (s: Severity) => {
    if (!onSeveritiesChange) return;
    const next = new Set(severities);
    if (next.has(s)) next.delete(s); else next.add(s);
    onSeveritiesChange(next);
  };
  const toggleFormat = (f: string) => {
    if (!onFormatFilterChange) return;
    onFormatFilterChange(formatFilter === f ? null : f);
  };

  return (
    <div className={`side-panel${expanded ? " side-panel-expanded" : ""}`}>
      <div className="panel-summary">
      <div className="panel-header">
        {/* The Cloudsmith logo used to sit here as a 36px avatar. It is not
            our mark and it made the panel read as Cloudsmith's own UI; the
            repository name is the thing the user is looking at, so it leads.
            The "View in Cloudsmith" link below stays — it goes there, and §8
            says to name things by what the user controls. */}
        <div className="repo-header-row">
          <div>
            <span className="panel-eyebrow">Repository</span>
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
        <button
          className={`vulnly-report-btn${reportDone ? " vulnly-report-btn-done" : ""}`}
          onClick={handleRepoReport}
          disabled={reportLoading || reportDone}
          title={reportLoading ? "Generating report…" : reportDone ? "Report downloaded" : "Download Vulnly repo summary report"}
        >
          {reportLoading ? (
            <span className="vulnly-spinner" aria-hidden="true" />
          ) : reportDone ? (
            <span aria-hidden="true">✓</span>
          ) : (
            <span aria-hidden="true">⬇</span>
          )}
          <span>{reportLoading ? "Generating…" : reportDone ? "Downloaded!" : "Vulnly Report"}</span>
        </button>
      </div>
      {reportError && (
        <div className="vulnly-report-error" role="alert">⚠ {reportError}</div>
      )}

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
          <span className="repo-card-label">Total findings</span>
        </div>
      </div>
      </div>

      <div className="panel-details">

      {/* Format breakdown */}
      <div className="panel-section">
        <h3 className="section-title">Package formats</h3>
        <div className="repo-format-grid">
          {stats.formats.map(([fmt, count]) => {
            const icon = getFormatIcon(fmt);
            const fmtKey = fmt.toLowerCase();
            const active = formatFilter === fmtKey;
            const filteredCount = stats.filteredFormatCounts[fmt] ?? 0;
            const dimmed = severities.size > 0 && filteredCount === 0;
            const clickable = !!onFormatFilterChange && fmt !== "unknown" && !dimmed;
            return (
              <button
                key={fmt}
                type="button"
                className={`repo-format-card${clickable ? " repo-format-card-clickable" : ""}${active ? " active" : ""}${dimmed ? " repo-format-card-dimmed" : ""}`}
                onClick={clickable ? () => toggleFormat(fmtKey) : undefined}
                disabled={!clickable}
                title={dimmed ? `No matching packages in ${fmt}` : active ? "Clear format filter" : `Filter graph by ${fmt}`}
              >
                {severities.size > 0 && filteredCount > 0 && (
                  <span className="repo-format-card-filter-badge">{filteredCount}</span>
                )}
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
              </button>
            );
          })}
        </div>
      </div>

      {/* Severity breakdown */}
      {(["Critical", "High", "Medium", "Low"] as const).some((s) => stats.sevCounts[s] > 0) && (
        <div className="panel-section">
          <h3 className="section-title">Severity breakdown</h3>
          <div className="repo-sev-bars">
            {(["Critical", "High", "Medium", "Low"] as const)
              .filter((s) => stats.sevCounts[s] > 0)
              .map((s) => {
                const count = stats.sevCounts[s];
                const max = Math.max(...Object.values(stats.sevCounts), 1);
                const active = severities.has(s);
                const clickable = !!onSeveritiesChange && count > 0;
                return (
                  <button
                    key={s}
                    type="button"
                    className={`repo-sev-row${clickable ? " repo-sev-row-clickable" : ""}${active ? " active" : ""}`}
                    onClick={clickable ? () => toggleSeverity(s) : undefined}
                    disabled={!clickable}
                    title={active ? `Clear ${s} filter` : `Filter graph by ${s}`}
                  >
                    <span className="repo-sev-label" style={{ color: SEVERITY_COLORS[s] }}>{s}</span>
                    <div className="repo-sev-track">
                      <div
                        className="repo-sev-fill"
                        style={{ width: `${(count / max) * 100}%`, background: SEVERITY_COLORS[s] }}
                      />
                    </div>
                    <span className="repo-sev-count">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Most vulnerable packages */}
      {stats.topVuln.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Most vulnerable</h3>
          <div className="repo-top-vuln">
            {stats.topVuln.map((p) => {
              const s = p.data.max_severity || "None";
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`repo-vuln-row${onNodeSelect ? " repo-vuln-row-clickable" : ""}`}
                  onClick={onNodeSelect ? () => { onSeveritiesChange?.(new Set()); onNodeSelect(p.id); } : undefined}
                  disabled={!onNodeSelect}
                  title={onNodeSelect ? `Select ${p.label}` : undefined}
                >
                  <span className="repo-vuln-name">{p.label}</span>
                  <span
                    className="repo-vuln-badge severity-badge"
                    data-severity={s}
                    title={`${p.data.vuln_count} ${p.data.vuln_count === 1 ? "vulnerability" : "vulnerabilities"}, highest severity ${s}`}
                  >
                    <SeverityMark severity={s} />
                    {p.data.vuln_count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
