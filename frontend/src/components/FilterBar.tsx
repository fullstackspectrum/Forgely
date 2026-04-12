import type { FilterType, GraphStats } from "../types";

interface Props {
  filter: FilterType;
  stats: GraphStats | null;
  hideSharedCveEdges: boolean;
  hideDependencies: boolean;
  hasKey: boolean;
  onFilterChange: (f: FilterType) => void;
  onHideSharedCveEdgesChange: (v: boolean) => void;
  onHideDependenciesChange: (v: boolean) => void;
  onConnectClick: () => void;
  onDisconnect: () => void;
}

const FILTERS: { key: FilterType; label: string; color?: string }[] = [
  { key: "all", label: "All" },
  { key: "vulnerable", label: "⚠ Vulnerable" },
  { key: "safe", label: "✔ Safe" },
  { key: "shared_cve", label: "🔗 Shared CVEs" },
  { key: "has_deps", label: "🔀 Has Dependencies" },
  { key: "Critical", label: "Critical", color: "#ff4d4d" },
  { key: "High", label: "High", color: "#ff8c1a" },
  { key: "Medium", label: "Medium", color: "#ffd11a" },
  { key: "Low", label: "Low", color: "#79b8ff" },
];

export default function FilterBar({
  filter,
  stats,
  hideSharedCveEdges,
  hideDependencies,
  hasKey,
  onFilterChange,
  onHideSharedCveEdgesChange,
  onHideDependenciesChange,
  onConnectClick,
  onDisconnect,
}: Props) {
  return (
    <div className="left-panel">
      <div className="left-panel-header">
        <img src="/artigraphly-logo.png" alt="Artigraphly" className="left-panel-logo" />
        <span className="left-panel-sub">Artifact Security Graph</span>
      </div>

      {stats && (
        <div className="left-panel-stats">
          <div className="stat-row">
            <span className="stat-label">Nodes</span>
            <span className="stat-value">{stats.total_nodes}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">CVEs</span>
            <span className="stat-value">{stats.total_cves}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label stat-critical">Critical</span>
            <span className="stat-value stat-critical">{stats.critical}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label stat-high">High</span>
            <span className="stat-value stat-high">{stats.high}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label stat-medium">Medium</span>
            <span className="stat-value stat-medium">{stats.medium}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label stat-low">Low</span>
            <span className="stat-value stat-low">{stats.low}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label stat-safe">Safe</span>
            <span className="stat-value stat-safe">{stats.safe}</span>
          </div>
        </div>
      )}

      <div className="left-panel-section">
        <span className="left-panel-section-title">Filters</span>
        <div className="left-panel-btn-group">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`btn btn-block ${filter === f.key ? "btn-active" : "btn-muted"}`}
              style={
                f.color && filter !== f.key ? { color: f.color } : undefined
              }
              onClick={() => onFilterChange(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="left-panel-section">
        <span className="left-panel-section-title">Visibility</span>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={hideSharedCveEdges}
            onChange={(e) => onHideSharedCveEdgesChange(e.target.checked)}
          />
          <span>Hide shared CVE edges</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={hideDependencies}
            onChange={(e) => onHideDependenciesChange(e.target.checked)}
          />
          <span>Hide dependencies</span>
        </label>
      </div>

      <div className="left-panel-connection">
        <button
          className={`connect-btn ${hasKey ? "connected" : ""}`}
          onClick={onConnectClick}
        >
          <span className="connect-btn-dot" />
          {hasKey ? "Connected" : "Connect"}
        </button>
        {hasKey && (
          <button
            className="disconnect-btn"
            title="Disconnect"
            onClick={onDisconnect}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
