import type { OrgGraphResponse, OrgNodeFilter } from "../types";
import { ORG_NODE_COLORS } from "../types";

type TabType = "packages" | "organisation";

interface Props {
  orgData: OrgGraphResponse | null;
  hasKey: boolean;
  filter: OrgNodeFilter;
  onFilterChange: (f: OrgNodeFilter) => void;
  onTabChange: (t: TabType) => void;
  onConnectClick: () => void;
  onDisconnect: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  repo: "Repositories",
  user: "Members",
  service: "Services",
  team: "Teams",
  entitlement: "Entitlements",
  upstream: "Upstreams",
};

export default function OrgLeftPanel({
  orgData,
  hasKey,
  filter,
  onFilterChange,
  onTabChange,
  onConnectClick,
  onDisconnect,
}: Props) {

  // Counts per node type from the loaded graph
  const counts: Record<string, number> = {};
  let totalFilterable = 0;
  if (orgData?.nodes) {
    for (const n of orgData.nodes) {
      if (n.type === "org") continue;
      counts[n.type] = (counts[n.type] || 0) + 1;
      totalFilterable++;
    }
  }

  const types = (Object.keys(ORG_NODE_COLORS) as Array<keyof typeof ORG_NODE_COLORS>)
    .filter((t) => t !== "org");

  const handleClick = (t: OrgNodeFilter) => {
    // Click active filter again to clear back to "all"
    if (filter === t) onFilterChange("all");
    else onFilterChange(t);
  };

  return (
    <div className="left-panel org-left-panel">
      <div className="left-panel-header">
        <img src="/forgely-logo.png" alt="Forgely" className="left-panel-logo" />
      </div>

      <div className="left-panel-tabs">
        <button className="left-panel-tab" onClick={() => onTabChange("packages")}>
          📦 Artifacts
        </button>
        <button className="left-panel-tab active">
          🏢 Workspace
        </button>
      </div>

      <div className="left-panel-section">
        <div className="org-filter-header">
          <span className="left-panel-section-title">Filter by type</span>
          {filter !== "all" && (
            <button
              type="button"
              className="org-filter-clear"
              onClick={() => onFilterChange("all")}
              title="Show all node types"
            >
              Clear
            </button>
          )}
        </div>
        <div className="org-filter-list">
          <button
            type="button"
            className={`org-filter-row${filter === "all" ? " active" : ""}`}
            onClick={() => onFilterChange("all")}
          >
            <span className="org-filter-dot org-filter-dot-all" />
            <span className="org-filter-label">All types</span>
            <span className="org-filter-count">{totalFilterable}</span>
          </button>
          {types.map((type) => {
            const count = counts[type] || 0;
            const isActive = filter === type;
            const isDisabled = !orgData || count === 0;
            return (
              <button
                key={type}
                type="button"
                className={`org-filter-row${isActive ? " active" : ""}${isDisabled ? " disabled" : ""}`}
                onClick={() => !isDisabled && handleClick(type as OrgNodeFilter)}
                disabled={isDisabled}
                style={isActive ? { borderColor: ORG_NODE_COLORS[type] } : undefined}
              >
                <span
                  className="org-filter-dot"
                  style={{ background: ORG_NODE_COLORS[type] }}
                />
                <span className="org-filter-label">
                  {TYPE_LABELS[type] || type}
                </span>
                <span className="org-filter-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="left-panel-bottom">
        <div className="left-panel-version">v{__APP_VERSION__}</div>
        <div className="left-panel-footer">
          {hasKey ? (
            <button className="btn btn-sm btn-muted" onClick={onDisconnect}>Disconnect</button>
          ) : (
            <button className="btn btn-sm btn-accent" onClick={onConnectClick}>Connect</button>
          )}
        </div>
      </div>
    </div>
  );
}
