import { useState } from "react";
import type { OrgGraphResponse, OrgGraphNode } from "../types";
import { ORG_NODE_COLORS } from "../types";

interface Props {
  data: OrgGraphResponse;
  nodeId: string;
  onNodeSelect: (id: string) => void;
  onOpenAttackPaths?: () => void;
  expanded?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  org: "Organisation",
  repo: "Repository",
  user: "User",
  service: "Service Account",
  team: "Team",
  entitlement: "Entitlement Token",
  upstream: "Upstream Source",
};

const TYPE_ICONS: Record<string, string> = {
  org: "🏢",
  repo: "📦",
  user: "👤",
  service: "🤖",
  team: "👥",
  entitlement: "🔑",
  upstream: "🔗",
};

function StatusPill({ active, label }: { active: boolean; label?: string }) {
  return (
    <span className={`org-status-pill ${active ? "org-status-active" : "org-status-inactive"}`}>
      <span className="org-status-dot" />
      {label ?? (active ? "Active" : "Inactive")}
    </span>
  );
}

function StatCard({ icon, value, label }: { icon: string; value: string | number; label: string }) {
  return (
    <div className="org-stat-card">
      <span className="org-stat-card-icon">{icon}</span>
      <span className="org-stat-card-value">{value}</span>
      <span className="org-stat-card-label">{label}</span>
    </div>
  );
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return <div className="org-info-card">{children}</div>;
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="org-detail-row">
      <span className="org-detail-label">{label}</span>
      <span className={`org-detail-value${mono ? " org-detail-mono" : ""}`}>{value}</span>
    </div>
  );
}

export default function OrgSidePanel({ data, nodeId, onNodeSelect, onOpenAttackPaths, expanded = false }: Props) {
  const node = data.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const inEdges = data.edges.filter((e) => e.target === nodeId);
  const outEdges = data.edges.filter((e) => e.source === nodeId);

  const d = node.data as Record<string, unknown>;
  const color = ORG_NODE_COLORS[node.type] ?? "var(--fg-n-600)";

  /* Group connections by type for organised display */
  const allConnections = [
    ...outEdges.map((e) => ({ ...e, direction: "out" as const, peer: data.nodes.find((n) => n.id === e.target) })),
    ...inEdges.map((e) => ({ ...e, direction: "in" as const, peer: data.nodes.find((n) => n.id === e.source) })),
  ];
  const connGroups: Record<string, typeof allConnections> = {};
  for (const c of allConnections) {
    const key = c.peer?.type ?? "unknown";
    if (!connGroups[key]) connGroups[key] = [];
    connGroups[key].push(c);
  }

  return (
    <div className={`side-panel org-side-panel${expanded ? " side-panel-expanded" : ""}`}>
      <div className="panel-summary">
      {/* Header with coloured accent bar */}
      <div className="org-panel-hero" style={{ borderColor: color }}>
        <div className="org-panel-hero-icon" style={{ background: color + "18", color }}>
          {TYPE_ICONS[node.type] ?? "•"}
        </div>
        <div className="org-panel-hero-text">
          <h3 className="org-panel-hero-title">{node.label}</h3>
          <span className="org-panel-hero-type" style={{ color }}>{TYPE_LABELS[node.type] ?? node.type}</span>
        </div>
      </div>

      {/* User details */}
      {node.type === "user" && (
        <>
          <div className="org-stat-row">
            <StatusPill active={!!d.is_active} />
            <StatusPill active={!!d.has_two_factor} label={d.has_two_factor ? "2FA Enabled" : "2FA Disabled"} />
          </div>
          <InfoCard>
            {d.role && <DetailRow label="Role" value={String(d.role)} />}
            {d.email && <DetailRow label="Email" value={String(d.email)} mono />}
            {d.joined_at && <DetailRow label="Joined" value={String(d.joined_at).split("T")[0]} />}
          </InfoCard>
        </>
      )}

      {/* Service details */}
      {node.type === "service" && (
        <>
          <InfoCard>
            {d.role && <DetailRow label="Role" value={String(d.role)} />}
            {d.description && <DetailRow label="Description" value={String(d.description)} />}
            {d.created_at && <DetailRow label="Created" value={String(d.created_at).split("T")[0]} />}
          </InfoCard>
          {Array.isArray(d.teams) && d.teams.length > 0 && (
            <InfoCard>
              <div className="org-info-card-title">Teams</div>
              <div className="org-tag-list">
                {(d.teams as string[]).map((t) => (
                  <span key={t} className="org-tag" style={{ borderColor: ORG_NODE_COLORS.team }}>
                    👥 {t}
                  </span>
                ))}
              </div>
            </InfoCard>
          )}
        </>
      )}

      {/* Repo details */}
      {node.type === "repo" && (
        <>
          <div className="org-stat-row">
            <StatCard icon="📦" value={String(d.package_count ?? 0)} label="Packages" />
            {d.repo_type && <StatCard icon="🏷" value={String(d.repo_type)} label="Type" />}
          </div>
          {d.description && (
            <InfoCard>
              <div className="org-info-card-title">Description</div>
              <p className="org-info-card-text">{String(d.description)}</p>
            </InfoCard>
          )}
        </>
      )}

      {/* Entitlement details */}
      {node.type === "entitlement" && (
        <>
          <div className="org-stat-row">
            <StatusPill active={!!d.is_active} />
          </div>
          <InfoCard>
            {d.limit_package_query && <DetailRow label="Package Query" value={String(d.limit_package_query)} mono />}
            {d.created_at && <DetailRow label="Created" value={String(d.created_at).split("T")[0]} />}
          </InfoCard>
        </>
      )}

      {/* Upstream details */}
      {node.type === "upstream" && (
        <>
          <div className="org-stat-row">
            <StatusPill active={!!d.is_active} />
            <StatusPill active={!!d.verify_ssl} label={d.verify_ssl ? "SSL Verified" : "SSL Unverified"} />
          </div>
          <InfoCard>
            {d.upstream_url && <DetailRow label="URL" value={String(d.upstream_url)} mono />}
            {d.format && <DetailRow label="Format" value={String(d.format)} />}
            {d.mode && <DetailRow label="Mode" value={String(d.mode)} />}
            {d.priority != null && <DetailRow label="Priority" value={String(d.priority)} />}
            {d.created_at && <DetailRow label="Created" value={String(d.created_at).split("T")[0]} />}
          </InfoCard>
        </>
      )}

      {/* Org node — attack paths entry point */}
      {node.type === "org" && onOpenAttackPaths && (
        <button className="cap-node-btn cap-node-btn-block" onClick={onOpenAttackPaths}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          View Attack Paths
        </button>
      )}

      {/* Team — no extra details beyond connections */}
      {node.type === "team" && Object.keys(d).length > 0 && (
        <InfoCard>
          {Object.entries(d).map(([k, v]) => (
            <DetailRow key={k} label={k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} value={String(v)} />
          ))}
        </InfoCard>
      )}
      </div>

      <div className="panel-details">
      {/* Connections — summary cards with expand */}
      {Object.keys(connGroups).length > 0 && (
        <ConnGroups groups={connGroups} onNodeSelect={onNodeSelect} />
      )}
      </div>
    </div>
  );
}

function ConnGroups({
  groups,
  onNodeSelect,
}: {
  groups: Record<string, { direction: "in" | "out"; peer?: OrgGraphNode; label: string; source: string; target: string }[]>;
  onNodeSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const total = Object.values(groups).reduce((s, g) => s + g.length, 0);

  return (
    <div className="org-panel-section">
      <h4 className="org-panel-section-title">
        Connections
        <span className="org-panel-section-count">{total}</span>
      </h4>
      <div className="org-conn-summary-grid">
        {Object.entries(groups).map(([type, conns]) => {
          const isOpen = expanded === type;
          const color = ORG_NODE_COLORS[type] ?? "var(--fg-n-600)";
          return (
            <div key={type} className={`org-conn-summary-card${isOpen ? " open" : ""}`}>
              <button
                className="org-conn-summary-btn"
                onClick={() => setExpanded(isOpen ? null : type)}
                style={{ borderColor: isOpen ? color : undefined }}
              >
                <span className="org-conn-summary-icon" style={{ background: color + "18", color }}>
                  {TYPE_ICONS[type] ?? "•"}
                </span>
                <span className="org-conn-summary-count">{conns.length}</span>
                <span className="org-conn-summary-label">{TYPE_LABELS[type] ?? type}s</span>
                <span className={`org-conn-summary-chevron${isOpen ? " open" : ""}`}>▾</span>
              </button>
              {isOpen && (
                <div className="org-conn-group-items">
                  {conns.map((c, i) => {
                    const peerId = c.direction === "out" ? c.target : c.source;
                    return (
                      <button
                        key={`${c.direction}-${i}`}
                        className="org-conn-card"
                        onClick={() => onNodeSelect(peerId)}
                      >
                        <span className="org-conn-card-icon">{TYPE_ICONS[c.peer?.type ?? ""] ?? "•"}</span>
                        <span className="org-conn-card-name">{c.peer?.label ?? peerId}</span>
                        {c.label && <span className="org-conn-card-badge">{c.label}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
