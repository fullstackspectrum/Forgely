import { useState } from "react";
import type { OrgGraphResponse, OrgNodeType } from "../types";
import { ORG_NODE_COLORS } from "../types";
import ChangelogModal from "./ChangelogModal";

type TabType = "packages" | "organisation";

interface Props {
  orgData: OrgGraphResponse | null;
  hasKey: boolean;
  /** Types to show. Empty means every type. */
  filters: Set<string>;
  onFiltersChange: (f: Set<string>) => void;
  onTabChange: (t: TabType) => void;
  onOpenSettings: () => void;
  onOpenAttackPaths?: () => void;
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
  filters,
  onFiltersChange,
  onTabChange,
  onOpenSettings,
  onOpenAttackPaths,
}: Props) {
  const [changelogOpen, setChangelogOpen] = useState(false);

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

  /* Types accumulate rather than replace: asking for repositories and
     upstreams together is the normal question, not an edge case. Clicking a
     selected type removes it, and removing the last one is the same as
     asking for everything. */
  const handleClick = (t: OrgNodeType) => {
    const next = new Set(filters);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onFiltersChange(next);
  };

  return (
    <div className="left-panel org-left-panel">
      <div className="left-panel-header">
        <img src="/forgely-lockup-horizontal.svg" alt="Forgely" className="left-panel-logo logo-light" />
        <img src="/forgely-lockup-horizontal-reversed.svg" alt="" aria-hidden="true" className="left-panel-logo logo-dark" />
      </div>

      <div className="left-panel-tabs">
        <button className="left-panel-tab" onClick={() => onTabChange("packages")}>
          📦 SCA
        </button>
        <button className="left-panel-tab active">
          🔐 CIEM
        </button>
      </div>

      <div className="left-panel-section">
        <div className="org-filter-header">
          <span className="left-panel-section-title">Filter by type</span>
          {filters.size > 0 && (
            <button
              type="button"
              className="org-filter-clear"
              onClick={() => onFiltersChange(new Set())}
              title="Show all node types"
            >
              Clear
            </button>
          )}
        </div>
        <div className="org-filter-list">
          <button
            type="button"
            className={`org-filter-row${filters.size === 0 ? " active" : ""}`}
            onClick={() => onFiltersChange(new Set())}
          >
            <span className="org-filter-dot org-filter-dot-all" />
            <span className="org-filter-label">All types</span>
            <span className="org-filter-count">{totalFilterable}</span>
          </button>
          {types.map((type) => {
            const count = counts[type] || 0;
            const isActive = filters.has(type);
            const isDisabled = !orgData || count === 0;
            return (
              <button
                key={type}
                type="button"
                className={`org-filter-row${isActive ? " active" : ""}${isDisabled ? " disabled" : ""}`}
                aria-pressed={isActive}
                onClick={() => !isDisabled && handleClick(type as OrgNodeType)}
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

      {onOpenAttackPaths && orgData && (
        <div className="cap-global-btn-wrap">
          <button className="cap-global-btn" onClick={onOpenAttackPaths}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Attack Paths
          </button>
        </div>
      )}

      <div className="left-panel-bottom">
        <button className="settings-btn" onClick={onOpenSettings} title="Settings">
          <span className="settings-btn-icon" aria-hidden="true">⚙</span>
          Settings
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
