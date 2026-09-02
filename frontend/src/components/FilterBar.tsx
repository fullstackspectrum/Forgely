import React, { useState } from "react";
import { SeverityNodeMark } from "./SeverityMark";
import type { Severity } from "../types";
import ChangelogModal from "./ChangelogModal";

type TabType = "packages" | "organisation";

interface Props {
  severities: Set<Severity>;
  filterFlags: Set<string>;
  filterFlagsMode: "and" | "or";
  hasKey: boolean;
  tab: TabType;
  disabled?: boolean;
  onTabChange: (t: TabType) => void;
  onSeveritiesChange: (s: Set<Severity>) => void;
  onFilterFlagsChange: (flags: Set<string>) => void;
  onFilterFlagsModeChange: (m: "and" | "or") => void;
  onOpenSettings: () => void;
}

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "vulnerable",  label: "Vulnerable" },
  { key: "safe",        label: "Safe" },
  { key: "quarantined", label: "Quarantined" },
  { key: "shared_cve",  label: "Shared CVEs" },
  { key: "has_deps",    label: "Has dependencies" },
];

const SEVERITY_FILTERS: { key: Severity; label: string; color: string }[] = [
  { key: "Critical", label: "Critical", color: "var(--s-critical)" },
  { key: "High",     label: "High",     color: "var(--s-high)" },
  { key: "Medium",   label: "Medium",   color: "var(--s-medium)" },
  { key: "Low",      label: "Low",      color: "var(--s-low)" },
];

export default function FilterBar({
  severities,
  filterFlags,
  filterFlagsMode,
  hasKey,
  tab,
  disabled = false,
  onTabChange,
  onSeveritiesChange,
  onFilterFlagsChange,
  onFilterFlagsModeChange,
  onOpenSettings,
}: Props) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const hasAnyFilter = severities.size > 0 || filterFlags.size > 0;

  const toggleFlag = (key: string) => {
    const next = new Set(filterFlags);
    if (next.has(key)) next.delete(key); else next.add(key);
    onFilterFlagsChange(next);
  };

  /* Additive: selecting Critical and High shows both, rather than the second
     click replacing the first. Clicking a selected level clears just it. */
  const toggleSeverity = (key: Severity) => {
    const next = new Set(severities);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSeveritiesChange(next);
  };

  const clearAll = () => {
    onSeveritiesChange(new Set());
    onFilterFlagsChange(new Set());
  };

  return (
    <div className="left-panel">
      <div className="left-panel-header">
        <img src="/forgely-lockup-horizontal.svg" alt="Forgely" className="left-panel-logo logo-light" />
        <img src="/forgely-lockup-horizontal-reversed.svg" alt="" aria-hidden="true" className="left-panel-logo logo-dark" />
      </div>

      <div className="left-panel-tabs">
        <button
          className={`left-panel-tab${tab === "packages" ? " active" : ""}`}
          onClick={() => onTabChange("packages")}
        >
          📦 SCA
        </button>
        <button
          className={`left-panel-tab${tab === "organisation" ? " active" : ""}`}
          onClick={() => onTabChange("organisation")}
        >
          🔐 CIEM
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
                  {f.label}
                </button>
              );
            })}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Severity" defaultOpen={true}>
          <div className="left-panel-btn-group">
            {SEVERITY_FILTERS.map((f) => {
              const active = severities.has(f.key);
              return (
                <button
                  key={f.key}
                  className={`btn btn-block btn-sev ${active ? "btn-active" : "btn-muted"}`}
                  onClick={() => toggleSeverity(f.key)}
                >
                  <SeverityNodeMark severity={f.key} />
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

      </div>

      <div className="left-panel-bottom">
        <button className="settings-btn" onClick={onOpenSettings} title="Settings">
          <span className="settings-btn-icon" aria-hidden="true">⚙</span>
          Settings
          {/* The connection lives in the dialog now, so its state has to be
              legible from the button or a disconnected app looks fine until
              something fails. */}
          <span className={`settings-btn-dot${hasKey ? " connected" : ""}`} />
        </button>
        <button className="left-panel-version" onClick={() => setChangelogOpen(true)}>
          v{__APP_VERSION__}
        </button>
      </div>

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
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

