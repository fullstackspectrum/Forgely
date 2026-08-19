import { useEffect, useMemo, useState } from "react";
import { currentTheme } from "../lib/theme";
import { SEVERITY_COLORS } from "../types";
import type { WorkspaceRepoSummary, WorkspaceCveSummary } from "../types";
import { apiFetch } from "../lib/auth";

interface Props {
  data: WorkspaceRepoSummary;
  owner: string;
  expanded: boolean;
  initialQuery?: string;
  onLoadFullGraph: () => void;
  onClose: () => void;
}

const SEV_ORDER = ["Critical", "High", "Medium", "Low"];

function SevBadge({ severity }: { severity: string }) {
  const color = SEVERITY_COLORS[severity] ?? "var(--t-muted)";
  return (
    <span className="cve-severity-badge" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
      {severity}
    </span>
  );
}

function SevBar({ repo }: { repo: WorkspaceRepoSummary }) {
  const total = repo.critical + repo.high + repo.medium + repo.low + repo.safe;
  if (total === 0) return <div className="wo-sev-bar-empty">No packages scanned</div>;

  const segments = [
    { key: "critical", count: repo.critical, color: SEVERITY_COLORS.Critical },
    { key: "high",     count: repo.high,     color: SEVERITY_COLORS.High },
    { key: "medium",   count: repo.medium,   color: SEVERITY_COLORS.Medium },
    { key: "low",      count: repo.low,      color: SEVERITY_COLORS.Low },
    { key: "safe",     count: repo.safe,     color: SEVERITY_COLORS.None },
  ].filter((s) => s.count > 0);

  return (
    <div className="wo-sev-bar">
      {segments.map((s) => (
        <div
          key={s.key}
          className="wo-sev-bar-seg"
          style={{ flex: s.count, background: s.color, opacity: 0.85 }}
          title={`${s.key[0].toUpperCase() + s.key.slice(1)}: ${s.count}`}
        />
      ))}
    </div>
  );
}

function SevStats({ repo }: { repo: WorkspaceRepoSummary }) {
  return (
    <div className="wo-sev-stats">
      {SEV_ORDER.map((sev) => {
        const count = repo[sev.toLowerCase() as keyof WorkspaceRepoSummary] as number;
        if (count === 0) return null;
        return (
          <span key={sev} className="wo-sev-stat" style={{ color: SEVERITY_COLORS[sev] }}>
            {count} {sev}
          </span>
        );
      })}
      {repo.safe > 0 && (
        <span className="wo-sev-stat" style={{ color: SEVERITY_COLORS.None }}>
          {repo.safe} Safe
        </span>
      )}
    </div>
  );
}

function CveRow({ cve, query }: { cve: WorkspaceCveSummary; query: string }) {
  const highlight = (text: string) => {
    if (!query) return <>{text}</>;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="wo-search-highlight">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div className="wo-cve-row">
      <div className="wo-cve-header">
        <SevBadge severity={cve.severity} />
        <span className="wo-cve-id">{highlight(cve.id)}</span>
      </div>
      {cve.description && (
        <div className="wo-cve-desc">{cve.description.slice(0, 120)}{cve.description.length > 120 ? "…" : ""}</div>
      )}
      <div className="wo-cve-packages">
        {cve.packages.map((pkg) => (
          <span key={pkg} className="wo-pkg-tag">{highlight(pkg)}</span>
        ))}
      </div>
    </div>
  );
}

export default function WorkspaceRepoPanel({ data, owner, expanded, initialQuery, onLoadFullGraph, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [sevFilter, setSevFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function handleRepoReport() {
    if (reportLoading || reportDone) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const resp = await apiFetch(
        `/api/vulnly-repo-report/${encodeURIComponent(owner)}/${encodeURIComponent(data.slug)}?theme=${currentTheme()}`,
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vulnly-${owner}-${data.slug}-repo-summary.html`;
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

  const pageSize = expanded ? 35 : 10;

  /* Reset to first page when any filter/size changes */
  useEffect(() => { setPage(0); }, [query, sevFilter, pageSize]);

  /* Which severities are present in the data */
  const presentSevs = useMemo(() => {
    const s = new Set(data.cves.map((c) => c.severity));
    return SEV_ORDER.filter((sev) => s.has(sev));
  }, [data.cves]);

  const filteredCves = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.cves.filter(
      (c) =>
        (!sevFilter || c.severity === sevFilter) &&
        (!q || c.id.toLowerCase().includes(q) || c.packages.some((p) => p.toLowerCase().includes(q))),
    );
  }, [data.cves, query, sevFilter]);

  /* Sort CVEs by severity rank */
  const sortedCves = useMemo(() => {
    const rank: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
    return [...filteredCves].sort(
      (a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0),
    );
  }, [filteredCves]);

  const totalPages = Math.ceil(sortedCves.length / pageSize);
  const pageCves = sortedCves.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="side-panel wo-panel">
      {/* Header */}
      <div className="panel-header">
        <div className="panel-pkg-name">{data.name}</div>
        <div className="panel-pkg-sub">{owner}</div>
      </div>

      {/* Stats row */}
      <div className="wo-stats-row">
        <div className="wo-stat-item">
          <span className="wo-stat-value">{data.package_count}</span>
          <span className="wo-stat-label">Packages</span>
        </div>
        <div className="wo-stat-item">
          <span className="wo-stat-value" style={{ color: data.vuln_count > 0 ? SEVERITY_COLORS[data.max_severity ?? ""] ?? "var(--s-critical)" : "var(--s-none)" }}>
            {data.vuln_count}
          </span>
          <span className="wo-stat-label">Vulnerabilities</span>
        </div>
        <div className="wo-stat-item">
          <span className="wo-stat-value">{data.cves.length}</span>
          <span className="wo-stat-label">Unique CVEs</span>
        </div>
      </div>

      {/* Primary actions sit above the findings, not below them. Paginated or
          not, a list of hundreds of CVEs pushed these off the bottom of the
          panel — §8: lead with what the user can act on. */}
      <div className="wo-actions">
      {/* Vulnly repo summary */}
      <button
        className={`vulnly-report-btn wo-vulnly-btn${reportDone ? " vulnly-report-btn-done" : ""}`}
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
        <span>{reportLoading ? "Generating…" : reportDone ? "Downloaded!" : "Vulnly Repo Report"}</span>
      </button>
      {reportError && (
        <div className="vulnly-report-error" role="alert">⚠ {reportError}</div>
      )}

      {/* Load full graph */}
      <button className="btn btn-accent btn-block wo-load-btn" onClick={onLoadFullGraph}>
        Load Full Graph
      </button>
      </div>

      {/* Severity bar */}
      <SevBar repo={data} />
      <SevStats repo={data} />

      {/* CVE search */}
      {data.cves.length > 0 && (
        <>
          <div className="wo-cve-section-label">
            CVEs
            {(query || sevFilter) && filteredCves.length !== data.cves.length && (
              <span className="wo-cve-count-badge">{filteredCves.length} / {data.cves.length}</span>
            )}
          </div>
          {presentSevs.length > 0 && (
            <div className="wo-sev-filters">
              {presentSevs.map((sev) => {
                const color = SEVERITY_COLORS[sev];
                const active = sevFilter === sev;
                return (
                  <button
                    key={sev}
                    className={`wo-sev-filter-btn${active ? " active" : ""}`}
                    style={{ "--sev-color": color } as React.CSSProperties}
                    onClick={() => setSevFilter(active ? null : sev)}
                  >
                    {sev}
                  </button>
                );
              })}
            </div>
          )}
          <div className="wo-search-row">
            <input
              className="wo-search-input"
              type="text"
              placeholder="Search by CVE ID or package…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="wo-search-clear" onClick={() => setQuery("")} title="Clear">×</button>
            )}
          </div>
          <div className="wo-cve-list">
            {sortedCves.length === 0 ? (
              <div className="wo-cve-empty">No CVEs match{query ? ` "${query}"` : ""}{sevFilter ? ` (${sevFilter})` : ""}</div>
            ) : (
              pageCves.map((cve) => <CveRow key={cve.id} cve={cve} query={query} />)
            )}
          </div>
          {totalPages > 1 && (
            <div className="wo-pagination">
              <button className="wo-page-btn" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>‹</button>
              <span className="wo-page-info">{page + 1} / {totalPages}</span>
              <button className="wo-page-btn" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}>›</button>
            </div>
          )}
        </>
      )}

      {data.cves.length === 0 && (
        <div className="wo-no-cves">
          {data.vuln_count === 0 ? "No vulnerabilities found." : "No CVE details available."}
        </div>
      )}

    </div>
  );
}
