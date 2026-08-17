import { useMemo, useState, useCallback } from "react";
import type { GraphResponse, GraphNode, CVERecord, FilterType } from "../types";
import { SEVERITY_COLORS, SEVERITY_RANK } from "../types";
import { useCveDescriptions } from "../hooks/useCveDescriptions";

const SEV_FILTERS = new Set<FilterType>(["Critical", "High", "Medium", "Low"]);

function VersionString({ version, mono = false }: { version: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(version).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [version]);
  return (
    <span className="version-string-wrap">
      <span
        className="version-string-text"
        title={version}
        style={mono ? { fontFamily: "var(--fg-font-mono)", color: "var(--fg-blue-200)" } : undefined}
      >
        {version}
      </span>
      <button
        type="button"
        className="version-copy-btn"
        onClick={copy}
        title={copied ? "Copied!" : "Copy version"}
      >
        {copied ? "✓" : "⎘"}
      </button>
    </span>
  );
}

function packageMatchesFilter(p: GraphNode, f: FilterType): boolean {
  if (f === "all") return true;
  if (SEV_FILTERS.has(f)) return p.data.cves.some((c) => c.severity === f);
  if (f === "vulnerable") return p.data.vuln_count > 0;
  if (f === "safe") return p.data.vuln_count === 0;
  if (f === "quarantined") return p.data.is_quarantined === true;
  return true;
}
import { getFormatIcon } from "../lib/formatIcons";
import { apiFetch } from "../lib/auth";

interface Props {
  data: GraphResponse;
  nodeId: string;
  owner: string;
  repo: string;
  expanded?: boolean;
  filter?: FilterType;
  formatFilter?: string | null;
  onFilterChange?: (f: FilterType) => void;
  onFormatFilterChange?: (f: string | null) => void;
  onNodeSelect?: (id: string) => void;
  onOpenAttackGraph?: () => void;
}

export default function SidePanel({
  data,
  nodeId,
  owner,
  repo,
  expanded = false,
  filter = "all",
  formatFilter = null,
  onFilterChange,
  onFormatFilterChange,
  onNodeSelect,
  onOpenAttackGraph,
}: Props) {
  const [sevFilter, setSevFilter] = useState<string>("All");
  const [showSharedOnly, setShowSharedOnly] = useState(false);
  const [cveQuery, setCveQuery] = useState<string>("");
  const [cvePage, setCvePage] = useState(0);
  const [depsExpanded, setDepsExpanded] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const node = data.nodes.find((n) => n.id === nodeId);

  /* Direct dependencies of this node (outgoing "dependency" edges).
     Must be declared before any early returns to satisfy the Rules of Hooks. */
  const dependencies = useMemo(() => {
    if (!node || node.type !== "package") return [];
    const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const list: GraphNode[] = [];
    for (const e of data.edges) {
      if (e.type !== "dependency" || e.source !== nodeId) continue;
      if (seen.has(e.target)) continue;
      seen.add(e.target);
      const target = nodeMap.get(e.target);
      if (target) list.push(target);
    }
    list.sort((a, b) => {
      const av = (b.data.vuln_count || 0) - (a.data.vuln_count || 0);
      return av !== 0 ? av : a.label.localeCompare(b.label);
    });
    return list;
  }, [data, nodeId, node]);

  /* CVE descriptions are fetched on demand rather than carried in the graph
     payload (perf/08). Declared before the early returns for the same reason
     as `dependencies` above. */
  const { descriptions: cveDescriptions } = useCveDescriptions(
    owner,
    repo,
    node?.type === "package" && node.data.cves.length > 0 ? node.data.slug : "",
  );

  if (!node) return null;

  /* Repo node gets a completely different detail view */
  if (node.type === "repo") {
    return (
      <RepoDetail
        data={data}
        node={node}
        owner={owner}
        repo={repo}
        expanded={expanded}
        filter={filter}
        formatFilter={formatFilter}
        onFilterChange={onFilterChange}
        onFormatFilterChange={onFormatFilterChange}
        onNodeSelect={onNodeSelect}
      />
    );
  }

  /* Dependency node view */
  if (node.type === "dependency") {
    return (
      <DependencyDetail
        data={data}
        node={node}
        expanded={expanded}
        filter={filter}
        onFilterChange={onFilterChange}
        onNodeSelect={onNodeSelect}
      />
    );
  }

  const toggleSeverity = (s: FilterType) => {
    if (!onFilterChange) return;
    onFilterChange(filter === s ? "all" : s);
  };
  const toggleFormat = (f: string) => {
    if (!onFormatFilterChange) return;
    onFormatFilterChange(formatFilter === f ? null : f);
  };

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

  const canGenerateReport =
    node.type === "package" &&
    !!d.slug &&
    (d.vuln_count > 0 || /scanned/i.test(d.scan_status || ""));
  const handleGenerateReport = async () => {
    if (!canGenerateReport || reportLoading) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const resp = await apiFetch(
        `/api/vulnly-report/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(d.slug)}`,
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-");
      const filename = `vulnly-${safe(node.label)}${d.version ? `-${safe(d.version)}` : ""}.html`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setReportDone(true);
      setTimeout(() => setReportDone(false), 2500);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className={`side-panel${expanded ? " side-panel-expanded" : ""}`}>
      <div className="panel-summary">
      <div className="panel-header">
        <h2 className="panel-title">{node.label}</h2>
        {d.version && <span className="panel-version"><VersionString version={d.version} /></span>}
      </div>

      <div className="panel-status-row">
        <div className="panel-status-badges">
          <button
            type="button"
            className={`severity-badge severity-badge-clickable${filter === sev ? " active" : ""}`}
            style={{ background: sevColor }}
            onClick={() => toggleSeverity(sev as FilterType)}
            title={filter === sev ? `Clear ${sev} filter — showing all` : `Filter graph by ${sev}`}
            disabled={!onFilterChange || sev === "None" || sev === "Unknown"}
          >
            {sev}
          </button>
          <span className="vuln-count-inline" style={d.vuln_count > 0 ? { color: sevColor } : undefined}>
            {d.vuln_count} {d.vuln_count === 1 ? "vulnerability" : "vulnerabilities"}
          </span>
          {d.is_quarantined && (
            <span className="quarantine-badge" title="This package is quarantined">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Quarantined
            </span>
          )}
        </div>
        {((onOpenAttackGraph && (d.max_severity === "Critical" || d.max_severity === "High")) || canGenerateReport || cloudsmithUrl) && (
        <div className="panel-status-actions">
          {onOpenAttackGraph && (d.max_severity === "Critical" || d.max_severity === "High") && (
            <button
              type="button"
              className="attack-graph-btn"
              onClick={onOpenAttackGraph}
              title="View Attack Path"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              <span>Attack Path</span>
            </button>
          )}
          {(canGenerateReport || cloudsmithUrl) && (
            <>
            {canGenerateReport && (
              <button
                type="button"
                className={`vulnly-report-btn${d.vuln_count === 0 ? " vulnly-report-btn-clean" : ""}${reportDone ? " vulnly-report-btn-done" : ""}`}
                onClick={handleGenerateReport}
                disabled={reportLoading || reportDone}
                title={reportLoading ? "Generating report…" : reportDone ? "Report downloaded" : "Download Vulnly HTML report"}
              >
                {reportLoading ? (
                  <span className="vulnly-spinner" aria-hidden="true" />
                ) : reportDone ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                )}
                <span>{reportLoading ? "Generating…" : reportDone ? "Downloaded!" : "Vulnly Report"}</span>
              </button>
            )}
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
            </>
          )}
        </div>
        )}
      </div>
      {reportError && (
        <div className="vulnly-report-error" role="alert">
          ⚠ {reportError}
        </div>
      )}

      {/* Metadata grid */}
      <div className="panel-meta">
        <MetaRow
          label="Format"
          value={d.format}
          onClick={d.format ? () => toggleFormat(d.format.toLowerCase()) : undefined}
          active={!!d.format && formatFilter === d.format.toLowerCase()}
        />
        <MetaRow label="License" value={d.license} />
        <MetaRow label="Size" value={sizeStr} />
        <MetaRow label="Downloads" value={String(d.downloads ?? "—")} />
        <MetaRow label="Scan Status" value={d.scan_status} />
        <MetaRow label="Uploaded" value={uploadDate} />
      </div>
      </div>

      <div className="panel-details">

      {/* Dependencies */}
      {dependencies.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Dependencies</h3>
          <button
            type="button"
            className={`dep-summary-card dep-summary-card-clickable${depsExpanded ? " expanded" : ""}`}
            onClick={() => setDepsExpanded((v) => !v)}
            aria-expanded={depsExpanded}
            title={depsExpanded ? "Hide dependency list" : "Show dependency list"}
          >
            <span className="dep-summary-value">{dependencies.length}</span>
            <span className="dep-summary-label">
              direct {dependencies.length === 1 ? "dependency" : "dependencies"}
            </span>
            <span className="dep-summary-chevron" aria-hidden="true">
              {depsExpanded ? "▾" : "▸"}
            </span>
          </button>
          {depsExpanded && (
            <div className="dep-list">
              {dependencies.map((dep) => {
                const sev = dep.data.max_severity || "None";
                const sevColor = SEVERITY_COLORS[sev] || SEVERITY_COLORS.None;
                const hasVulns = dep.data.vuln_count > 0;
                const clickable = !!onNodeSelect;
                return (
                  <button
                    key={dep.id}
                    type="button"
                    className={`dep-row${clickable ? " dep-row-clickable" : ""}`}
                    onClick={clickable ? () => onNodeSelect!(dep.id) : undefined}
                    disabled={!clickable}
                    title={clickable ? `Focus ${dep.label} in graph` : dep.label}
                  >
                    <span className="dep-row-name">{dep.label}</span>
                    {dep.data.version && (
                      <span className="dep-row-version">{dep.data.version}</span>
                    )}
                    {hasVulns && (
                      <span
                        className="dep-row-badge"
                        style={{ background: sevColor }}
                        title={`${dep.data.vuln_count} ${dep.data.vuln_count === 1 ? "vulnerability" : "vulnerabilities"}`}
                      >
                        {dep.data.vuln_count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CVE list */}
      {d.cves.length > 0 && (() => {
        const sorted = [...d.cves].sort(
          (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
        );
        const sevCounts: Record<string, number> = {};
        for (const c of sorted) {
          sevCounts[c.severity] = (sevCounts[c.severity] || 0) + 1;
        }
        const sharedCount = sorted.filter((c) => (cveIndex[c.id]?.length ?? 0) > 1).length;
        const q = cveQuery.trim().toLowerCase();
        const filtered = sorted.filter((c) => {
          if (sevFilter !== "All" && c.severity !== sevFilter) return false;
          if (showSharedOnly && (cveIndex[c.id]?.length ?? 0) <= 1) return false;
          if (!q) return true;
          return (
            (c.id || "").toLowerCase().includes(q) ||
            (cveDescriptions[c.id] || c.description || "").toLowerCase().includes(q) ||
            (c.affected || "").toLowerCase().includes(q)
          );
        });
        const filterOptions = ["All", "Critical", "High", "Medium", "Low"].filter(
          (s) => s === "All" || sevCounts[s]
        );

        const pageSize = expanded ? 15 : 5;
        const totalPages = Math.ceil(filtered.length / pageSize);
        const safePage = Math.min(cvePage, Math.max(0, totalPages - 1));
        const paginated = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

        return (
          <div className="panel-section">
            <h3 className="section-title">
              CVEs ({filtered.length}{filtered.length !== d.cves.length ? ` of ${d.cves.length}` : ""}
              {d.vuln_count > d.cves.length ? ` — ${d.vuln_count} total` : ""})
            </h3>
            <div className="cve-search-row">
              <span className="cve-search-icon" aria-hidden="true">⌕</span>
              <input
                type="text"
                className="cve-search-input"
                placeholder="Search CVEs (e.g. CVE-2024-1234)"
                value={cveQuery}
                onChange={(e) => { setCveQuery(e.target.value); setCvePage(0); }}
              />
              {cveQuery && (
                <button
                  type="button"
                  className="cve-search-clear"
                  onClick={() => { setCveQuery(""); setCvePage(0); }}
                  title="Clear"
                >
                  ×
                </button>
              )}
            </div>
            <div className="cve-filter-bar">
              {filterOptions.map((s) => (
                <button
                  key={s}
                  className={`cve-filter-btn${sevFilter === s ? " active" : ""}`}
                  style={sevFilter === s && s !== "All" ? { background: SEVERITY_COLORS[s], borderColor: SEVERITY_COLORS[s] } : undefined}
                  onClick={() => { setSevFilter(s); setCvePage(0); }}
                >
                  {s}{s !== "All" ? ` (${sevCounts[s]})` : ""}
                </button>
              ))}
              {sharedCount > 0 && (
                <button
                  className={`cve-filter-btn cve-filter-btn-shared${showSharedOnly ? " active" : ""}`}
                  onClick={() => { setShowSharedOnly((v) => !v); setCvePage(0); }}
                  title="Show only CVEs shared with other packages"
                >
                  Shared ({sharedCount})
                </button>
              )}
            </div>
            <div className="cve-list">
              {filtered.length === 0 ? (
                <div className="cve-empty">No CVEs match your search.</div>
              ) : paginated.map((cve, i) => (
                <CveCard
                  key={`${cve.id}-${i}`}
                  cve={cve}
                  description={cveDescriptions[cve.id] || cve.description}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="cve-pagination">
                <button
                  className="cve-page-btn"
                  onClick={() => setCvePage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                >
                  ‹
                </button>
                <span className="cve-page-label">
                  {safePage + 1} / {totalPages}
                </span>
                <button
                  className="cve-page-btn"
                  onClick={() => setCvePage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage === totalPages - 1}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {d.vuln_count > 0 && d.cves.length === 0 && (
        <div className="panel-section">
          <p style={{ color: "var(--s-medium)" }}>
            ⚠ {d.vuln_count} vulnerabilities detected but details could not be
            retrieved.
          </p>
        </div>
      )}

      {d.vuln_count === 0 && node.type === "package" && (() => {
        const unsupported = /not supported/i.test(d.scan_status || "");
        if (unsupported) {
          return (
            <div className="panel-section">
              <div className="no-cves-card no-cves-card-unsupported">
                <div className="no-cves-icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="no-cves-text">
                  <strong>Scan not supported</strong>
                  <span>Security scanning isn't available for this package format.</span>
                </div>
              </div>
            </div>
          );
        }
        return (
          <div className="panel-section">
            <div className="no-cves-card">
              <div className="no-cves-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div className="no-cves-text">
                <strong>All clear</strong>
                <span>No CVEs recorded for this package.</span>
              </div>
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  valueColor,
  onClick,
  active,
}: {
  label: string;
  value: string;
  valueColor?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const text = value || "—";
  return (
    <>
      <span className="meta-label">{label}</span>
      {onClick ? (
        <button
          type="button"
          className={`meta-value meta-value-clickable${active ? " active" : ""}`}
          style={valueColor ? { color: valueColor, fontWeight: 600 } : undefined}
          onClick={onClick}
          title={active ? "Clear filter" : `Filter graph by ${value}`}
        >
          {text}
        </button>
      ) : (
        <span className="meta-value" style={valueColor ? { color: valueColor, fontWeight: 600 } : undefined}>
          {text}
        </span>
      )}
    </>
  );
}

/* `description` is passed in rather than read off `cve`: it arrives from
   /api/cve after the graph has rendered, and falls back to the record's own
   value when the graph still carries one. */
function CveCard({ cve, description }: { cve: CVERecord; description: string }) {
  const color = SEVERITY_COLORS[cve.severity] || "var(--fg-n-600)";
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
      {description && (
        <div className="cve-description">
          {description.length > 250
            ? description.slice(0, 250) + "…"
            : description}
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
    </div>
  );
}

/* ================================================================
   Dependency Detail View
   ================================================================ */

function DependencyDetail({
  data,
  node,
  expanded = false,
  filter,
  onFilterChange,
  onNodeSelect,
}: {
  data: GraphResponse;
  node: GraphNode;
  expanded?: boolean;
  filter?: FilterType;
  onFilterChange?: (f: FilterType) => void;
  onNodeSelect?: (id: string) => void;
}) {
  const [pkgQuery, setPkgQuery] = useState("");

  const linkedPackages = useMemo(() => {
    const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const list: { pkg: GraphNode; versionExpr: string }[] = [];
    for (const e of data.edges) {
      if (e.type !== "dependency" || e.target !== node.id) continue;
      if (seen.has(e.source)) continue;
      seen.add(e.source);
      const src = nodeMap.get(e.source);
      if (src) list.push({ pkg: src, versionExpr: e.label || "" });
    }
    list.sort((a, b) => {
      const bv = (b.pkg.data.vuln_count || 0) - (a.pkg.data.vuln_count || 0);
      return bv !== 0 ? bv : a.pkg.label.localeCompare(b.pkg.label);
    });
    return list;
  }, [data, node.id]);

  const filtered = pkgQuery
    ? linkedPackages.filter(({ pkg }) => pkg.label.toLowerCase().includes(pkgQuery.toLowerCase()))
    : linkedPackages;

  return (
    <div className={`side-panel${expanded ? " side-panel-expanded" : ""}`}>
      <div className="panel-summary">
        <div className="panel-header">
          <h2 className="panel-title">{node.label}</h2>
          {node.data.version && (
            <span className="panel-version">
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>requires </span>
              <VersionString version={node.data.version} mono />
            </span>
          )}
        </div>
        <div className="dep-panel-type-row">
          <span className="dep-panel-badge">Dependency</span>
          <span className="dep-panel-count">{linkedPackages.length} {linkedPackages.length === 1 ? "package" : "packages"}</span>
        </div>
      </div>

      <div className="panel-details">
        <div className="panel-section">
          <h3 className="section-title">Linked Packages</h3>
          <input
            className="dep-panel-search"
            type="search"
            placeholder="Filter packages…"
            value={pkgQuery}
            onChange={(e) => setPkgQuery(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="dep-panel-empty">{pkgQuery ? "No matches" : "No linked packages"}</p>
          ) : (
            <ul className="dep-pkg-list">
              {filtered.map(({ pkg, versionExpr }) => {
                const sev = pkg.data.max_severity || "None";
                const sevColor = SEVERITY_COLORS[sev] || SEVERITY_COLORS.None;
                const isActive = filter === sev;
                return (
                  <li key={pkg.id} className="dep-pkg-row">
                    <button
                      type="button"
                      className="dep-pkg-name"
                      onClick={() => onNodeSelect?.(pkg.id)}
                      title={`Select ${pkg.label}`}
                    >
                      <span className="dep-pkg-label">{pkg.label}</span>
                      {pkg.data.version && <span className="dep-pkg-version">{pkg.data.version}</span>}
                      {versionExpr && <span className="dep-pkg-expr" title="Required version expression">{versionExpr}</span>}
                    </button>
                    {sev !== "None" && (
                      <button
                        type="button"
                        className={`severity-badge severity-badge-clickable${isActive ? " active" : ""}`}
                        style={{ background: sevColor }}
                        onClick={() => onFilterChange?.(isActive ? "all" : sev as FilterType)}
                        title={isActive ? `Clear ${sev} filter` : `Filter graph by ${sev}`}
                      >
                        {sev}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
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
  filter = "all",
  formatFilter = null,
  onFilterChange,
  onFormatFilterChange,
  onNodeSelect,
}: {
  data: GraphResponse;
  node: GraphNode;
  owner: string;
  repo: string;
  expanded?: boolean;
  filter?: FilterType;
  formatFilter?: string | null;
  onFilterChange?: (f: FilterType) => void;
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
        `/api/vulnly-repo-report/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
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
      if (packageMatchesFilter(p, filter)) {
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
  }, [data, filter]);

  const repoUrl = `https://app.cloudsmith.com/${owner}/r/${repo}/`;

  const toggleSeverity = (s: FilterType) => {
    if (!onFilterChange) return;
    onFilterChange(filter === s ? "all" : s);
  };
  const toggleFormat = (f: string) => {
    if (!onFormatFilterChange) return;
    onFormatFilterChange(formatFilter === f ? null : f);
  };

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
            const fmtKey = fmt.toLowerCase();
            const active = formatFilter === fmtKey;
            const filteredCount = stats.filteredFormatCounts[fmt] ?? 0;
            const dimmed = filter !== "all" && filteredCount === 0;
            const clickable = !!onFormatFilterChange && fmt !== "unknown" && !dimmed;
            return (
              <button
                key={fmt}
                type="button"
                className={`repo-format-card${clickable ? " repo-format-card-clickable" : ""}${active ? " active" : ""}${dimmed ? " repo-format-card-dimmed" : ""}`}
                onClick={clickable ? () => toggleFormat(fmtKey) : undefined}
                disabled={!clickable}
                title={dimmed ? `No ${filter} packages in ${fmt}` : active ? "Clear format filter" : `Filter graph by ${fmt}`}
              >
                {filter !== "all" && filteredCount > 0 && (
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
          <h3 className="section-title">Severity Breakdown</h3>
          <div className="repo-sev-bars">
            {(["Critical", "High", "Medium", "Low"] as const)
              .filter((s) => stats.sevCounts[s] > 0)
              .map((s) => {
                const count = stats.sevCounts[s];
                const max = Math.max(...Object.values(stats.sevCounts), 1);
                const active = filter === s;
                const clickable = !!onFilterChange && count > 0;
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
          <h3 className="section-title">Most Vulnerable</h3>
          <div className="repo-top-vuln">
            {stats.topVuln.map((p) => {
              const s = p.data.max_severity || "None";
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`repo-vuln-row${onNodeSelect ? " repo-vuln-row-clickable" : ""}`}
                  onClick={onNodeSelect ? () => { onFilterChange?.("all"); onNodeSelect(p.id); } : undefined}
                  disabled={!onNodeSelect}
                  title={onNodeSelect ? `Select ${p.label}` : undefined}
                >
                  <span className="repo-vuln-name">{p.label}</span>
                  <span className="repo-vuln-badge" style={{ background: SEVERITY_COLORS[s] }}>
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
