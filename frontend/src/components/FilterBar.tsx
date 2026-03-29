import type { FilterType, LayoutType, GraphStats } from "../types";

interface Props {
  filter: FilterType;
  layout: LayoutType;
  stats: GraphStats | null;
  onFilterChange: (f: FilterType) => void;
  onLayoutChange: (l: LayoutType) => void;
  onRefresh: () => void;
}

const FILTERS: { key: FilterType; label: string; color?: string }[] = [
  { key: "all", label: "All" },
  { key: "vulnerable", label: "⚠ Vulnerable" },
  { key: "safe", label: "✔ Safe" },
  { key: "Critical", label: "Critical", color: "#ff4d4d" },
  { key: "High", label: "High", color: "#ff8c1a" },
  { key: "Medium", label: "Medium", color: "#ffd11a" },
  { key: "Low", label: "Low", color: "#79b8ff" },
];

const LAYOUTS: { key: LayoutType; label: string }[] = [
  { key: "force", label: "💥 Force" },
  { key: "circular", label: "◎ Circular" },
  { key: "radial", label: "🎯 Radial" },
  { key: "tree", label: "🌳 Tree" },
  { key: "horizontal", label: "↔ Horizontal" },
];

export default function FilterBar({
  filter,
  layout,
  stats,
  onFilterChange,
  onLayoutChange,
  onRefresh,
}: Props) {
  return (
    <div className="left-panel">
      <div className="left-panel-header">
        <span className="left-panel-title">Artigraphly</span>
        <span className="left-panel-sub">Security Map</span>
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
        <span className="left-panel-section-title">Severity Filter</span>
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
        <span className="left-panel-section-title">Layout</span>
        <div className="left-panel-btn-group">
          {LAYOUTS.map((l) => (
            <button
              key={l.key}
              className={`btn btn-block ${layout === l.key ? "btn-active" : "btn-muted"}`}
              onClick={() => onLayoutChange(l.key)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="left-panel-section">
        <button className="btn btn-accent btn-block" onClick={onRefresh}>
          ↻ Refresh Data
        </button>
      </div>
    </div>
  );
}
