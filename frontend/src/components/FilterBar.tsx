import { useState } from "react";
import type { FilterType, GraphStats } from "../types";

type TabType = "packages" | "organisation";

interface Props {
  filter: FilterType;
  stats: GraphStats | null;
  hideSharedCveEdges: boolean;
  hideDependencies: boolean;
  hideUnsupported: boolean;
  hasKey: boolean;
  tab: TabType;
  onTabChange: (t: TabType) => void;
  onFilterChange: (f: FilterType) => void;
  onHideSharedCveEdgesChange: (v: boolean) => void;
  onHideDependenciesChange: (v: boolean) => void;
  onHideUnsupportedChange: (v: boolean) => void;
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
  hideUnsupported,
  hasKey,
  tab,
  onTabChange,
  onFilterChange,
  onHideSharedCveEdgesChange,
  onHideDependenciesChange,
  onHideUnsupportedChange,
  onConnectClick,
  onDisconnect,
}: Props) {
  return (
    <div className="left-panel">
      <div className="left-panel-header">
        <img src="/forgely-logo.png" alt="Forgely" className="left-panel-logo" />
      </div>

      <div className="left-panel-tabs">
        <button
          className={`left-panel-tab${tab === "packages" ? " active" : ""}`}
          onClick={() => onTabChange("packages")}
        >
          📦 Artifacts
        </button>
        <button
          className={`left-panel-tab${tab === "organisation" ? " active" : ""}`}
          onClick={() => onTabChange("organisation")}
        >
          🏢 Workspace
        </button>
      </div>

      {stats && (
        <CollapsibleSection title="Stats" defaultOpen={false} badge={String(stats.total_nodes)}>
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
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Filters" defaultOpen={true}>
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
      </CollapsibleSection>

      <CollapsibleSection title="Visibility" defaultOpen={false}>
        <div className="visibility-toggles">
          <VisibilityToggle
            label="Shared CVE edges"
            visible={!hideSharedCveEdges}
            onToggle={() => onHideSharedCveEdgesChange(!hideSharedCveEdges)}
          />
          <VisibilityToggle
            label="Dependencies"
            visible={!hideDependencies}
            onToggle={() => onHideDependenciesChange(!hideDependencies)}
          />
          <VisibilityToggle
            label="Unsupported scans"
            visible={!hideUnsupported}
            onToggle={() => onHideUnsupportedChange(!hideUnsupported)}
          />
        </div>
      </CollapsibleSection>

      <div className="left-panel-bottom">
        <div className="left-panel-version">v{__APP_VERSION__}</div>
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
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`left-panel-section collapsible${open ? " open" : ""}`}>
      <button
        type="button"
        className="left-panel-section-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="left-panel-section-title">{title}</span>
        {badge != null && <span className="left-panel-section-badge">{badge}</span>}
        <svg className="left-panel-section-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="left-panel-section-body">{children}</div>}
    </div>
  );
}

function VisibilityToggle({
  label,
  visible,
  onToggle,
}: {
  label: string;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`vis-toggle${visible ? " vis-toggle-on" : " vis-toggle-off"}`}
      onClick={onToggle}
      aria-pressed={visible}
      title={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
    >
      <span className="vis-toggle-icon" aria-hidden="true">
        {visible ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.77 19.77 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.86 19.86 0 0 1-3.17 4.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        )}
      </span>
      <span className="vis-toggle-label">{label}</span>
      <span className="vis-toggle-state">{visible ? "Visible" : "Hidden"}</span>
    </button>
  );
}
