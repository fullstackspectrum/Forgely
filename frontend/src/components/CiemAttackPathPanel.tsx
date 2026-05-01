import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { OrgGraphResponse, OrgGraphNode } from "../types";
import { ORG_NODE_COLORS } from "../types";
import { computeAttackPaths, type IdentityRisk, type AttackPath, type Permission } from "../lib/ciemAttackPaths";

/* ── SVG layout constants ───────────────────────────────────── */
const ROW_H   = 48;
const ROW_GAP = 10;
const TOP_PAD = 24;
const BOT_PAD = 24;
const L_PAD   = 20;

const COL_ID_X   = L_PAD;
const COL_ID_W   = 160;
const COL_TEAM_X = COL_ID_X + COL_ID_W + 48;
const COL_TEAM_W = 132;
const COL_REPO_X = COL_TEAM_X + COL_TEAM_W + 48;
const COL_REPO_W = 160;
const COL_PERM_X = COL_REPO_X + COL_REPO_W + 14;
const COL_PERM_W = 72;
const SVG_W      = COL_PERM_X + COL_PERM_W + L_PAD;

const PERM_C: Record<Permission, { fill: string; stroke: string; text: string; dot: string }> = {
  Admin: { fill: "rgba(255,77,77,0.13)",   stroke: "rgba(255,77,77,0.5)",   text: "#ff7070", dot: "#ff4d4d" },
  Write: { fill: "rgba(255,140,26,0.13)",  stroke: "rgba(255,140,26,0.5)",  text: "#ffa040", dot: "#ff8c1a" },
};

const TYPE_LABELS: Record<string, string> = {
  user: "USER", service: "SERVICE", team: "TEAM", repo: "REPOSITORY",
};
const TYPE_ICONS: Record<string, string> = {
  user: "👤", service: "🤖", team: "👥", repo: "📦",
};

function rowY(i: number)  { return TOP_PAD + i * (ROW_H + ROW_GAP); }
function rowCY(i: number) { return rowY(i) + ROW_H / 2; }

function svgHeight(n: number) {
  return TOP_PAD + n * ROW_H + Math.max(0, n - 1) * ROW_GAP + BOT_PAD;
}

function truncate(s: string, max = 18) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function nodeColor(type: string) {
  const hex = ORG_NODE_COLORS[type as keyof typeof ORG_NODE_COLORS] ?? "#888";
  return {
    fill:   hex + "18",
    stroke: hex + "66",
    text:   hex,
  };
}

/* ── SVG sub-components ─────────────────────────────────────── */

function SvgCard({
  x, y, w, h = ROW_H, type, label,
}: { x: number; y: number; w: number; h?: number; type: string; label: string }) {
  const c = nodeColor(type);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8}
        fill={c.fill} stroke={c.stroke} strokeWidth={1} />
      <text x={x + 10} y={y + 15} fontSize={9} fill={c.text}
        fontWeight="700" letterSpacing="0.6" fontFamily="inherit">
        {TYPE_ICONS[type]} {TYPE_LABELS[type] ?? type.toUpperCase()}
      </text>
      <text x={x + 10} y={y + 32} fontSize={12.5} fill="rgba(230,235,255,0.92)"
        fontWeight="600" fontFamily="inherit">
        {truncate(label)}
      </text>
    </g>
  );
}

function SvgPermBadge({ x, y, perm }: { x: number; y: number; perm: Permission }) {
  const c = PERM_C[perm];
  return (
    <g>
      <rect x={x} y={y + ROW_H / 2 - 14} width={COL_PERM_W} height={28} rx={6}
        fill={c.fill} stroke={c.stroke} strokeWidth={1} />
      <circle cx={x + 12} cy={y + ROW_H / 2} r={4} fill={c.dot} />
      <text x={x + 22} y={y + ROW_H / 2 + 5} fontSize={12} fill={c.text}
        fontWeight="700" fontFamily="inherit">
        {perm}
      </text>
    </g>
  );
}

function SvgArrow({ x1, y1, x2, y2, perm }: {
  x1: number; y1: number; x2: number; y2: number; perm: Permission;
}) {
  const c = PERM_C[perm];
  const mid = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
  return (
    <path d={d} fill="none" stroke={c.dot} strokeWidth={1.5} strokeOpacity={0.55}
      markerEnd={`url(#arr-${perm.toLowerCase()})`} />
  );
}

/* ── Identity paths SVG ─────────────────────────────────────── */

function PathsSvg({ risk, nodeMap }: { risk: IdentityRisk; nodeMap: Map<string, OrgGraphNode> }) {
  const { paths, node } = risk;
  const n = paths.length;
  const h = svgHeight(n);

  // Identity card spans all rows
  const idCardH = Math.max(ROW_H, n * ROW_H + Math.max(0, n - 1) * ROW_GAP);
  const idCardY = TOP_PAD;

  return (
    <svg width={SVG_W} height={h} style={{ display: "block", minWidth: SVG_W }}>
      <defs>
        {(["admin", "write"] as const).map((k) => {
          const color = k === "admin" ? "#ff4d4d" : "#ff8c1a";
          return (
            <marker key={k} id={`arr-${k}`} markerWidth={7} markerHeight={7}
              refX={6} refY={3.5} orient="auto">
              <path d="M 0 0 L 7 3.5 L 0 7 Z" fill={color} opacity={0.7} />
            </marker>
          );
        })}
      </defs>

      {/* Column headers */}
      {[
        { x: COL_ID_X,   label: "IDENTITY" },
        { x: COL_TEAM_X, label: "VIA TEAM" },
        { x: COL_REPO_X, label: "REPOSITORY" },
        { x: COL_PERM_X, label: "PERMISSION" },
      ].map(({ x, label }) => (
        <text key={label} x={x} y={12} fontSize={9} fill="rgba(150,160,200,0.7)"
          fontWeight="700" letterSpacing="0.6" fontFamily="inherit">
          {label}
        </text>
      ))}

      {/* Identity node */}
      <SvgCard x={COL_ID_X} y={idCardY} w={COL_ID_W} h={idCardH}
        type={node.type} label={node.label} />

      {/* Paths */}
      {paths.map((path, i) => {
        const repoNode  = nodeMap.get(path.repoId);
        const teamNode  = path.teamId ? nodeMap.get(path.teamId) : null;
        const cy        = rowCY(i);
        const idRightX  = COL_ID_X + COL_ID_W;

        return (
          <g key={`${path.repoId}-${i}`}>
            {path.pathType === "indirect" && teamNode ? (
              <>
                <SvgCard x={COL_TEAM_X} y={rowY(i)} w={COL_TEAM_W}
                  type="team" label={teamNode.label} />
                <SvgArrow x1={idRightX} y1={cy}
                  x2={COL_TEAM_X} y2={cy} perm={path.permission} />
                <SvgArrow x1={COL_TEAM_X + COL_TEAM_W} y1={cy}
                  x2={COL_REPO_X} y2={cy} perm={path.permission} />
              </>
            ) : (
              <SvgArrow x1={idRightX} y1={cy}
                x2={COL_REPO_X} y2={cy} perm={path.permission} />
            )}

            <SvgCard x={COL_REPO_X} y={rowY(i)} w={COL_REPO_W}
              type="repo" label={repoNode?.label ?? path.repoId} />

            <SvgPermBadge x={COL_PERM_X} y={rowY(i)} perm={path.permission} />
          </g>
        );
      })}
    </svg>
  );
}

/* ── Risk badges ────────────────────────────────────────────── */

function RiskBadges({ risk }: { risk: IdentityRisk }) {
  return (
    <div className="cap-badges">
      {risk.isServiceAdmin && (
        <span className="cap-badge cap-badge-critical">⚡ Service Admin</span>
      )}
      {risk.isBroadAccess && !risk.isServiceAdmin && (
        <span className="cap-badge cap-badge-high">⚠ Broad Access</span>
      )}
      {risk.permissions.has("Admin") && !risk.isServiceAdmin && (
        <span className="cap-badge cap-badge-admin">● Admin</span>
      )}
      {risk.permissions.has("Write") && (
        <span className="cap-badge cap-badge-write">● Write</span>
      )}
    </div>
  );
}

/* ── Main panel ─────────────────────────────────────────────── */

interface Props {
  data: OrgGraphResponse;
  onClose: () => void;
}

export default function CiemAttackPathPanel({ data, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodeMap = useMemo(
    () => new Map(data.nodes.map((n) => [n.id, n])),
    [data],
  );

  const risks = useMemo(() => computeAttackPaths(data), [data]);

  const selected = selectedId ? risks.find((r) => r.nodeId === selectedId) ?? null : null;

  // Summary stats
  const totalIdentities = risks.length;
  const totalAdmin  = risks.filter((r) => r.permissions.has("Admin")).length;
  const totalBroad  = risks.filter((r) => r.isBroadAccess).length;
  const totalPaths  = risks.reduce((s, r) => s + r.paths.length, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="cap-backdrop" onClick={onClose}>
      <div className="cap-panel" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="cap-header">
          <div className="cap-header-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>CIEM Attack Paths</span>
            <span className="cap-header-sub">Write &amp; Admin access paths</span>
          </div>
          <button className="cap-close" onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div className="cap-body">

          {/* Left sidebar — identity list */}
          <div className="cap-sidebar">
            <div className="cap-sidebar-stats">
              <div className="cap-stat"><span className="cap-stat-val">{totalIdentities}</span><span className="cap-stat-label">Identities</span></div>
              <div className="cap-stat"><span className="cap-stat-val cap-stat-red">{totalAdmin}</span><span className="cap-stat-label">Admin</span></div>
              <div className="cap-stat"><span className="cap-stat-val cap-stat-orange">{totalBroad}</span><span className="cap-stat-label">Broad</span></div>
              <div className="cap-stat"><span className="cap-stat-val">{totalPaths}</span><span className="cap-stat-label">Paths</span></div>
            </div>

            {risks.length === 0 ? (
              <div className="cap-empty">No write or admin access paths found.</div>
            ) : (
              <div className="cap-identity-list">
                {risks.map((risk) => {
                  const color = ORG_NODE_COLORS[risk.node.type as keyof typeof ORG_NODE_COLORS] ?? "#888";
                  const isSelected = selectedId === risk.nodeId;
                  return (
                    <button
                      key={risk.nodeId}
                      className={`cap-identity-item${isSelected ? " selected" : ""}`}
                      onClick={() => setSelectedId(isSelected ? null : risk.nodeId)}
                      style={{ borderLeftColor: isSelected ? color : "transparent" }}
                    >
                      <span className="cap-identity-icon" style={{ color }}>
                        {TYPE_ICONS[risk.node.type] ?? "•"}
                      </span>
                      <div className="cap-identity-info">
                        <span className="cap-identity-name">{risk.node.label}</span>
                        <div className="cap-identity-meta">
                          <span>{risk.repoCount} repo{risk.repoCount !== 1 ? "s" : ""}</span>
                          {risk.isServiceAdmin && <span className="cap-meta-critical">Service Admin</span>}
                          {risk.isBroadAccess && !risk.isServiceAdmin && <span className="cap-meta-high">Broad Access</span>}
                        </div>
                      </div>
                      <div className="cap-identity-perms">
                        {risk.permissions.has("Admin") && (
                          <span className="cap-perm-dot cap-perm-admin" title="Admin" />
                        )}
                        {risk.permissions.has("Write") && (
                          <span className="cap-perm-dot cap-perm-write" title="Write" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right detail area */}
          <div className="cap-detail">
            {selected ? (
              <>
                <div className="cap-detail-header">
                  <div className="cap-detail-title">
                    <span style={{ color: ORG_NODE_COLORS[selected.node.type as keyof typeof ORG_NODE_COLORS] }}>
                      {TYPE_ICONS[selected.node.type]}
                    </span>
                    <span>{selected.node.label}</span>
                  </div>
                  <RiskBadges risk={selected} />
                  <div className="cap-detail-meta">
                    {selected.paths.filter((p) => p.permission === "Admin").length > 0 && (
                      <span className="cap-detail-stat cap-detail-stat-red">
                        {selected.paths.filter((p) => p.permission === "Admin").length} Admin path{selected.paths.filter((p) => p.permission === "Admin").length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {selected.paths.filter((p) => p.permission === "Write").length > 0 && (
                      <span className="cap-detail-stat cap-detail-stat-orange">
                        {selected.paths.filter((p) => p.permission === "Write").length} Write path{selected.paths.filter((p) => p.permission === "Write").length !== 1 ? "s" : ""}
                      </span>
                    )}
                    <span className="cap-detail-stat">
                      {selected.repoCount} repo{selected.repoCount !== 1 ? "s" : ""} accessible
                    </span>
                  </div>
                </div>
                <div className="cap-svg-scroll">
                  <PathsSvg risk={selected} nodeMap={nodeMap} />
                </div>
              </>
            ) : (
              <div className="cap-detail-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                  stroke="rgba(150,160,210,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <p>Select an identity to explore its attack paths</p>
                <p className="cap-empty-sub">
                  Attack paths show how identities can reach repositories with write or admin access — directly or via team membership.
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>,
    document.body,
  );
}
