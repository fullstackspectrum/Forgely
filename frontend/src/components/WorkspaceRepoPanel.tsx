import { useEffect, useMemo, useState } from "react";
import { SEVERITY_COLORS } from "../types";
import type { WorkspaceRepoSummary, WorkspaceCveSummary } from "../types";

interface Props {
  data: WorkspaceRepoSummary;
  owner: string;
  expanded: boolean;
  onLoadFullGraph: () => void;
  onClose: () => void;
}

const SEV_ORDER = ["Critical", "High", "Medium", "Low"];

function SevBadge({ severity }: { severity: string }) {
  const color = SEVERITY_COLORS[severity] ?? "#888";
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

export default function WorkspaceRepoPanel({ data, owner, expanded, onLoadFullGraph, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const pageSize = expanded ? 35 : 10;

  /* Reset to first page when query or page size changes */
  useEffect(() => { setPage(0); }, [query, pageSize]);

  const filteredCves = useMemo(() => {
    if (!query.trim()) return data.cves;
    const q = query.trim().toLowerCase();
    return data.cves.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.packages.some((p) => p.toLowerCase().includes(q)),
    );
  }, [data.cves, query]);

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
          <span className="wo-stat-value" style={{ color: data.vuln_count > 0 ? SEVERITY_COLORS[data.max_severity ?? ""] ?? "#ff4d4d" : "#28a745" }}>
            {data.vuln_count}
          </span>
          <span className="wo-stat-label">Vulnerabilities</span>
        </div>
        <div className="wo-stat-item">
          <span className="wo-stat-value">{data.cves.length}</span>
          <span className="wo-stat-label">Unique CVEs</span>
        </div>
      </div>

      {/* Severity bar */}
      <SevBar repo={data} />
      <SevStats repo={data} />

      {/* CVE search */}
      {data.cves.length > 0 && (
        <>
          <div className="wo-cve-section-label">
            CVEs
            {query && filteredCves.length !== data.cves.length && (
              <span className="wo-cve-count-badge">{filteredCves.length} / {data.cves.length}</span>
            )}
          </div>
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
              <div className="wo-cve-empty">No CVEs match "{query}"</div>
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

      {/* Load full graph */}
      <button className="btn btn-accent btn-block wo-load-btn" onClick={onLoadFullGraph}>
        Load Full Graph
      </button>
    </div>
  );
}
