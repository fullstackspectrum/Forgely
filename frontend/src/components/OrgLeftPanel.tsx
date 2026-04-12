import { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth";
import type { OrgGraphResponse, OrgNodeFilter } from "../types";
import { ORG_NODE_COLORS } from "../types";

type TabType = "packages" | "organisation";

interface Namespace {
  slug: string;
  name: string;
  type: string;
}

interface Props {
  owner: string;
  orgData: OrgGraphResponse | null;
  hasKey: boolean;
  refreshKey: number;
  filter: OrgNodeFilter;
  onFilterChange: (f: OrgNodeFilter) => void;
  onTabChange: (t: TabType) => void;
  onOwnerChange: (owner: string) => void;
  onConnectClick: () => void;
  onDisconnect: () => void;
}

export default function OrgLeftPanel({
  owner,
  orgData,
  hasKey,
  refreshKey,
  filter,
  onFilterChange,
  onTabChange,
  onOwnerChange,
  onConnectClick,
  onDisconnect,
}: Props) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loadingNs, setLoadingNs] = useState(false);

  useEffect(() => {
    setLoadingNs(true);
    apiFetch("/api/namespaces")
      .then((r) => r.json())
      .then((data) => setNamespaces(Array.isArray(data) ? data : []))
      .catch(() => setNamespaces([]))
      .finally(() => setLoadingNs(false));
  }, [refreshKey]);

  return (
    <div className="left-panel org-left-panel">
      <div className="left-panel-header">
        <img src="/artigraphly-logo.png" alt="Artigraphly" className="left-panel-logo" />
        <span className="left-panel-sub">Artifact Security Graph</span>
      </div>

      <div className="left-panel-tabs">
        <button className="left-panel-tab" onClick={() => onTabChange("packages")}>
          📦 Packages
        </button>
        <button className="left-panel-tab active">
          🏢 Organisation
        </button>
      </div>

      <div className="left-panel-section">
        <span className="left-panel-section-title">Workspace</span>
        <select
          className="selector-select org-selector"
          value={owner}
          onChange={(e) => onOwnerChange(e.target.value)}
          disabled={loadingNs}
        >
          <option value="">
            {loadingNs ? "Loading…" : "Select workspace"}
          </option>
          {[...namespaces].sort((a, b) => a.name.localeCompare(b.name)).map((ns) => (
            <option key={ns.slug} value={ns.slug}>
              {ns.name}
              {ns.type ? ` (${ns.type})` : ""}
            </option>
          ))}
        </select>
      </div>

      {orgData?.stats && (
        <div className="left-panel-stats">
          <div className="stat-row">
            <span className="stat-label">Repositories</span>
            <span className="stat-value">{orgData.stats.total_repos}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Members</span>
            <span className="stat-value">{orgData.stats.total_members}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Services</span>
            <span className="stat-value">{orgData.stats.total_services}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Nodes</span>
            <span className="stat-value">{orgData.stats.total_nodes}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Edges</span>
            <span className="stat-value">{orgData.stats.total_edges}</span>
          </div>
        </div>
      )}

      <div className="left-panel-section">
        <span className="left-panel-section-title">Filters</span>
        <div className="filter-buttons org-filter-buttons">
          <button
            className={`filter-btn${filter === "all" ? " active" : ""}`}
            onClick={() => onFilterChange("all")}
          >
            All
          </button>
          {(Object.keys(ORG_NODE_COLORS) as Array<keyof typeof ORG_NODE_COLORS>)
            .filter((t) => t !== "org")
            .map((type) => (
              <button
                key={type}
                className={`filter-btn${filter === type ? " active" : ""}`}
                style={{
                  borderColor: ORG_NODE_COLORS[type],
                  ...(filter === type ? { background: ORG_NODE_COLORS[type], color: "#fff" } : {}),
                }}
                onClick={() => onFilterChange(type as OrgNodeFilter)}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
        </div>
      </div>

      <div className="left-panel-section">
        <span className="left-panel-section-title">Legend</span>
        <div className="org-legend">
          {Object.entries(ORG_NODE_COLORS).map(([type, color]) => (
            <div key={type} className="org-legend-item">
              <span className="org-legend-dot" style={{ background: color }} />
              <span className="org-legend-label">{type.charAt(0).toUpperCase() + type.slice(1)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="left-panel-footer">
        {hasKey ? (
          <button className="btn btn-sm btn-muted" onClick={onDisconnect}>Disconnect</button>
        ) : (
          <button className="btn btn-sm btn-accent" onClick={onConnectClick}>Connect</button>
        )}
      </div>
    </div>
  );
}
