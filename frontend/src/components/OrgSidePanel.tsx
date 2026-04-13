import type { OrgGraphResponse, OrgGraphNode } from "../types";
import { ORG_NODE_COLORS } from "../types";

interface Props {
  data: OrgGraphResponse;
  nodeId: string;
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

export default function OrgSidePanel({ data, nodeId }: Props) {
  const node = data.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const inEdges = data.edges.filter((e) => e.target === nodeId);
  const outEdges = data.edges.filter((e) => e.source === nodeId);

  const d = node.data as Record<string, unknown>;

  return (
    <div className="side-panel org-side-panel">
      <div className="side-panel-header">
        <span className="org-side-icon">{TYPE_ICONS[node.type] ?? "•"}</span>
        <div>
          <h3 className="side-panel-title">{node.label}</h3>
          <span className="org-side-type" style={{ color: ORG_NODE_COLORS[node.type] }}>
            {TYPE_LABELS[node.type] ?? node.type}
          </span>
        </div>
      </div>

      <div className="side-panel-section">
        <h4 className="side-panel-section-title">Details</h4>
        <div className="org-side-details">
          {node.type === "user" && (
            <>
              {d.role && <DetailRow label="Role" value={String(d.role)} />}
              {d.email && <DetailRow label="Email" value={String(d.email)} />}
              <DetailRow label="Active" value={d.is_active ? "Yes" : "No"} />
              <DetailRow label="2FA" value={d.has_two_factor ? "Enabled" : "Disabled"} />
              {d.joined_at && <DetailRow label="Joined" value={String(d.joined_at).split("T")[0]} />}
            </>
          )}
          {node.type === "service" && (
            <>
              {d.role && <DetailRow label="Role" value={String(d.role)} />}
              {d.description && <DetailRow label="Description" value={String(d.description)} />}
              {d.created_at && <DetailRow label="Created" value={String(d.created_at).split("T")[0]} />}
              {Array.isArray(d.teams) && d.teams.length > 0 && (
                <DetailRow label="Teams" value={(d.teams as string[]).join(", ")} />
              )}
            </>
          )}
          {node.type === "repo" && (
            <>
              {d.description && <DetailRow label="Description" value={String(d.description)} />}
              <DetailRow label="Packages" value={String(d.package_count ?? 0)} />
              {d.repo_type && <DetailRow label="Type" value={String(d.repo_type)} />}
            </>
          )}
          {node.type === "entitlement" && (
            <>
              <DetailRow label="Active" value={d.is_active ? "Yes" : "No"} />
              {d.limit_package_query && <DetailRow label="Package Query" value={String(d.limit_package_query)} />}
              {d.created_at && <DetailRow label="Created" value={String(d.created_at).split("T")[0]} />}
            </>
          )}
          {node.type === "upstream" && (
            <>
              {d.upstream_url && <DetailRow label="URL" value={String(d.upstream_url)} />}
              {d.format && <DetailRow label="Format" value={String(d.format)} />}
              {d.mode && <DetailRow label="Mode" value={String(d.mode)} />}
              <DetailRow label="Active" value={d.is_active ? "Yes" : "No"} />
              <DetailRow label="SSL Verify" value={d.verify_ssl ? "Yes" : "No"} />
              {d.priority != null && <DetailRow label="Priority" value={String(d.priority)} />}
              {d.created_at && <DetailRow label="Created" value={String(d.created_at).split("T")[0]} />}
            </>
          )}
        </div>
      </div>

      {/* Connections */}
      {(inEdges.length > 0 || outEdges.length > 0) && (
        <div className="side-panel-section">
          <h4 className="side-panel-section-title">Connections</h4>
          <div className="org-side-connections">
            {outEdges.map((e, i) => {
              const target = data.nodes.find((n) => n.id === e.target);
              return (
                <div key={`out-${i}`} className="org-conn-row">
                  <span className="org-conn-icon">{TYPE_ICONS[target?.type ?? ""] ?? "•"}</span>
                  <span className="org-conn-label">{target?.label ?? e.target}</span>
                  {e.label && <span className="org-conn-perm">{e.label}</span>}
                </div>
              );
            })}
            {inEdges.map((e, i) => {
              const source = data.nodes.find((n) => n.id === e.source);
              return (
                <div key={`in-${i}`} className="org-conn-row">
                  <span className="org-conn-icon">{TYPE_ICONS[source?.type ?? ""] ?? "•"}</span>
                  <span className="org-conn-label">{source?.label ?? e.source}</span>
                  {e.label && <span className="org-conn-perm">{e.label}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="org-detail-row">
      <span className="org-detail-label">{label}</span>
      <span className="org-detail-value">{value}</span>
    </div>
  );
}
