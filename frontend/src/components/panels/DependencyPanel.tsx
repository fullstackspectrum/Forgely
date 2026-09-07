/**
 * A transitive dependency, and the packages that pull it in.
 */
import { useMemo, useState } from "react";
import type { GraphNode, GraphResponse, Severity } from "../../types";
import { SEVERITY_COLORS, SEVERITY_RANK } from "../../types";
import { EMPTY_SEVERITIES, MetaRow, VersionString } from "./shared";

export default function DependencyPanel({
  data,
  node,
  expanded = false,
  severities = EMPTY_SEVERITIES,
  onSeveritiesChange,
  onNodeSelect,
}: {
  data: GraphResponse;
  node: GraphNode;
  expanded?: boolean;
  severities?: Set<Severity>;
  onSeveritiesChange?: (s: Set<Severity>) => void;
  onNodeSelect?: (id: string) => void;
}) {
  const [pkgQuery, setPkgQuery] = useState("");

  const toggleSeverity = (s: Severity) => {
    if (!onSeveritiesChange) return;
    const next = new Set(severities);
    if (next.has(s)) next.delete(s); else next.add(s);
    onSeveritiesChange(next);
  };

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
          <h3 className="section-title">Linked packages</h3>
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
                const isActive = severities.has(sev as Severity);
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
                        data-severity={sev}
                        onClick={() => toggleSeverity(sev as Severity)}
                        title={isActive ? `Clear ${sev} filter` : `Add ${sev} to the filter`}
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
