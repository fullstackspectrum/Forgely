import React, { useState } from "react";
import type { FilterType } from "../types";

type TabType = "packages" | "organisation";

interface Props {
  filter: FilterType;
  filterFlags: Set<string>;
  filterFlagsMode: "and" | "or";
  hideSharedCveEdges: boolean;
  hideDependencies: boolean;
  hideUnsupported: boolean;
  hideCriticalAnimation: boolean;
  hasKey: boolean;
  tab: TabType;
  disabled?: boolean;
  onTabChange: (t: TabType) => void;
  onFilterChange: (f: FilterType) => void;
  onFilterFlagsChange: (flags: Set<string>) => void;
  onFilterFlagsModeChange: (m: "and" | "or") => void;
  onHideSharedCveEdgesChange: (v: boolean) => void;
  onHideDependenciesChange: (v: boolean) => void;
  onHideUnsupportedChange: (v: boolean) => void;
  onHideCriticalAnimationChange: (v: boolean) => void;
  onConnectClick: () => void;
  onDisconnect: () => void;
}

const STATUS_FILTERS: { key: string; label: string; icon?: React.ReactNode }[] = [
  { key: "vulnerable", label: "Vulnerable", icon: "⚠" },
  { key: "safe",       label: "Safe",       icon: "✔" },
  { key: "quarantined",label: "Quarantined",icon: "🔒" },
  { key: "shared_cve", label: "Shared CVEs",icon: "🔗" },
  { key: "has_deps",   label: "Has Dependencies", icon: "🔀" },
];

const SEVERITY_FILTERS: { key: FilterType; label: string; color: string }[] = [
  { key: "Critical", label: "Critical", color: "#ff4d4d" },
  { key: "High",     label: "High",     color: "#ff8c1a" },
  { key: "Medium",   label: "Medium",   color: "#ffd11a" },
  { key: "Low",      label: "Low",      color: "#79b8ff" },
];

export default function FilterBar({
  filter,
  filterFlags,
  filterFlagsMode,
  hideSharedCveEdges,
  hideDependencies,
  hideUnsupported,
  hideCriticalAnimation,
  hasKey,
  tab,
  disabled = false,
  onTabChange,
  onFilterChange,
  onFilterFlagsChange,
  onFilterFlagsModeChange,
  onHideSharedCveEdgesChange,
  onHideDependenciesChange,
  onHideUnsupportedChange,
  onHideCriticalAnimationChange,
  onConnectClick,
  onDisconnect,
}: Props) {
  const hasAnyFilter = filter !== "all" || filterFlags.size > 0;

  const toggleFlag = (key: string) => {
    const next = new Set(filterFlags);
    if (next.has(key)) next.delete(key); else next.add(key);
    onFilterFlagsChange(next);
  };

  const toggleSeverity = (key: FilterType) => {
    onFilterChange(filter === key ? "all" : key);
  };

  const clearAll = () => {
    onFilterChange("all");
    onFilterFlagsChange(new Set());
  };

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

      <div className={`left-panel-filters${disabled ? " left-panel-filters-disabled" : ""}`}>
        <CollapsibleSection title="Status" defaultOpen={true}>
          {filterFlags.size >= 2 && (
            <div className="filter-mode-row">
              <span className="filter-mode-label">Match</span>
              <div className="filter-mode-toggle">
                <button
                  className={`filter-mode-btn${filterFlagsMode === "and" ? " active" : ""}`}
                  onClick={() => onFilterFlagsModeChange("and")}
                >AND</button>
                <button
                  className={`filter-mode-btn${filterFlagsMode === "or" ? " active" : ""}`}
                  onClick={() => onFilterFlagsModeChange("or")}
                >OR</button>
              </div>
            </div>
          )}
          <div className="left-panel-btn-group">
            {STATUS_FILTERS.map((f) => {
              const active = filterFlags.has(f.key);
              return (
                <button
                  key={f.key}
                  className={`btn btn-block ${active ? "btn-active" : "btn-muted"}`}
                  onClick={() => toggleFlag(f.key)}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {f.icon && <span aria-hidden="true">{f.icon}</span>}
                    {f.label}
                  </span>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Max Severity" defaultOpen={true}>
          <div className="left-panel-btn-group">
            {SEVERITY_FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  className={`btn btn-block ${active ? "btn-active" : "btn-muted"}`}
                  style={!active ? { color: f.color } : { background: f.color, borderColor: f.color, color: "#fff" }}
                  onClick={() => toggleSeverity(f.key)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </CollapsibleSection>

        {hasAnyFilter && (
          <div style={{ padding: "0 12px 4px" }}>
            <button className="btn btn-block btn-muted" style={{ fontSize: 11, opacity: 0.7 }} onClick={clearAll}>
              ✕ Clear all filters
            </button>
          </div>
        )}

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
            <VisibilityToggle
              label="Critical animation"
              visible={!hideCriticalAnimation}
              onToggle={() => onHideCriticalAnimationChange(!hideCriticalAnimation)}
            />
          </div>
        </CollapsibleSection>
      </div>

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
