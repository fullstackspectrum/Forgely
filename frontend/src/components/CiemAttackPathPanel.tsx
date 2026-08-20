import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { OrgGraphResponse, OrgGraphNode } from "../types";
import { ORG_NODE_COLORS } from "../types";
import { computeAttackPaths, type IdentityRisk, type AttackPath, type Permission } from "../lib/ciemAttackPaths";

/* ────────────────────────────────────────────────────────────
   Layout constants
   ──────────────────────────────────────────────────────────── */
const ID_R       = 26;    // identity circle radius
const TEAM_R     = 20;    // team circle radius
const REPO_R     = 15;    // repo circle radius

const X_ID_C     = 72;    // identity centre-x
const X_TEAM_C   = 224;   // team centre-x
const X_REPO_C0  = 374;   // first repo-column centre-x
const REPO_COL_W = 108;   // repo column pitch (centre to centre)

const REPO_ROW_H = 90;    // repo row pitch within a group
const GROUP_GAP  = 40;    // vertical gap between groups
const TOP_PAD    = 50;
const BOT_PAD    = 54;

function repoColX(c: number) { return X_REPO_C0 + c * REPO_COL_W; }

/** Number of repo columns for the whole canvas (based on total paths). */
function pickCols(n: number) {
  if (n <= 4)  return 1;
  if (n <= 10) return 2;
  return 3;
}

function calcSvgW(cols: number) {
  return repoColX(cols - 1) + REPO_R + 72;
}

/* ────────────────────────────────────────────────────────────
   Group-based layout types and builder
   ──────────────────────────────────────────────────────────── */
interface LayoutGroup {
  teamId:   string | null;
  teamNode: OrgGraphNode | undefined;
  paths:    AttackPath[];
  startY:   number;
  groupH:   number;
  teamCY:   number;   // vertical centre of this group (team node y)
  cols:     number;
}

function buildGroups(
  paths: AttackPath[],
  nodeMap: Map<string, OrgGraphNode>,
  cols: number,
): LayoutGroup[] {
  const map = new Map<string, AttackPath[]>();
  for (const p of paths) {
    const key = p.pathType === "indirect" && p.teamId ? `t:${p.teamId}` : "direct";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }

  const entries = [...map.entries()].map(([key, gPaths]) => {
    const teamId = key === "direct" ? null : key.slice(2);
    return { teamId, paths: gPaths, teamLabel: teamId ? (nodeMap.get(teamId)?.label ?? teamId) : "" };
  });

  // Sort: teams (by dominant permission then alpha) before direct
  entries.sort((a, b) => {
    const ap = a.paths[0].permission;
    const bp = b.paths[0].permission;
    if (ap !== bp) return ap === "Admin" ? -1 : 1;
    if (a.teamId && !b.teamId) return -1;
    if (!a.teamId && b.teamId)  return 1;
    return a.teamLabel.localeCompare(b.teamLabel);
  });

  let y = TOP_PAD;
  return entries.map(({ teamId, paths: gPaths }) => {
    const rows   = Math.ceil(gPaths.length / cols);
    const groupH = Math.max(rows * REPO_ROW_H, TEAM_R * 2 + 30);
    const g: LayoutGroup = {
      teamId,
      teamNode: teamId ? nodeMap.get(teamId) : undefined,
      paths: gPaths,
      startY: y,
      groupH,
      teamCY: y + groupH / 2,
      cols,
    };
    y += groupH + GROUP_GAP;
    return g;
  });
}

function totalSvgH(groups: LayoutGroup[]) {
  if (!groups.length) return 200;
  const last = groups[groups.length - 1];
  return last.startY + last.groupH + BOT_PAD;
}

function centreY(groups: LayoutGroup[]) {
  if (!groups.length) return 100;
  const last = groups[groups.length - 1];
  return (TOP_PAD + last.startY + last.groupH) / 2;
}

function repoPos(group: LayoutGroup, idx: number) {
  return {
    x: repoColX(idx % group.cols),
    y: group.startY + Math.floor(idx / group.cols) * REPO_ROW_H + REPO_ROW_H / 2,
  };
}

/* ────────────────────────────────────────────────────────────
   Colours
   ──────────────────────────────────────────────────────────── */
const PERM_C: Record<Permission, { fill: string; border: string; arrow: string; pill: string }> = {
  Admin: { fill: "rgba(232, 117, 107,0.13)",  border: "rgba(232, 117, 107,0.5)",  arrow: "rgba(232, 117, 107,0.5)",  pill: "var(--s-critical)" },
  Write: { fill: "rgba(240, 138, 90,0.13)", border: "rgba(240, 138, 90,0.5)", arrow: "rgba(240, 138, 90,0.5)", pill: "var(--s-high)" },
};

const NODE_C: Record<string, { fill: string; border: string; icon: string }> = {
  user:    { fill: "rgba(55, 138, 221,0.12)",  border: "rgba(55, 138, 221,0.45)",  icon: "var(--c-action)" },
  service: { fill: "rgba(92, 159, 228,0.12)",  border: "rgba(92, 159, 228,0.45)",  icon: "var(--fg-blue-300)" },
  team:    { fill: "rgba(217, 182, 92,0.12)",  border: "rgba(217, 182, 92,0.45)",  icon: "var(--s-medium)" },
};

const TYPE_SUBLABELS: Record<string, string> = {
  user: "User", service: "Service Account", team: "Team",
};

const TYPE_ICONS: Record<string, string> = {
  user: "👤", service: "🤖", team: "👥", repo: "📦",
};

/* ────────────────────────────────────────────────────────────
   SVG icon paths (inline, no foreignObject)
   ──────────────────────────────────────────────────────────── */
function IconPaths({ type, color }: { type: string; color: string }) {
  const p = {
    fill: "none", stroke: color, strokeWidth: "1.8" as const,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  switch (type) {
    case "user":
      return <><path {...p} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle {...p} cx="12" cy="7" r="4"/></>;
    case "service":
      return <><rect {...p} x="4" y="4" width="16" height="16" rx="2"/><rect {...p} x="9" y="9" width="6" height="6"/><path {...p} strokeWidth="1.3" d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></>;
    case "team":
      return <><path {...p} d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle {...p} cx="9" cy="7" r="4"/><path {...p} d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>;
    case "repo":
      return <path {...p} d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>;
    default:
      return <circle {...p} cx="12" cy="12" r="8"/>;
  }
}

/* ────────────────────────────────────────────────────────────
   Circle node  (identity + team)
   ──────────────────────────────────────────────────────────── */
function CircleNode({
  cx, cy, r, type, label, subLabel, delay = "0s",
}: {
  cx: number; cy: number; r: number;
  type: string; label: string; subLabel?: string; delay?: string;
}) {
  const c = NODE_C[type] ?? { fill: "rgba(139, 156, 175,0.12)", border: "rgba(139, 156, 175,0.45)", icon: "var(--t-muted)" };
  const scale = (r * 1.15) / 24;
  const off   = (24 * scale) / 2;
  const maxLen = r < 22 ? 13 : 15;
  const trunc  = (s: string) => s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
  return (
    <g className="ciem-node-enter" style={{ animationDelay: delay, transformOrigin: `${cx}px ${cy}px` }}>
      <circle cx={cx} cy={cy} r={r} fill={c.fill} stroke={c.border} strokeWidth="1.5"/>
      <g transform={`translate(${cx - off},${cy - off}) scale(${scale})`}>
        <IconPaths type={type} color={c.icon}/>
      </g>
      <text x={cx} y={cy + r + 16} textAnchor="middle"
        fontSize={r < 22 ? "11" : "12"} fontWeight="600" fill="var(--c-surface-raised)"
        fontFamily="var(--fg-font-body)">
        {trunc(label)}
      </text>
      {subLabel && (
        <text x={cx} y={cy + r + 28} textAnchor="middle"
          fontSize="9.5" fill="var(--fg-n-600)" fontFamily="var(--fg-font-body)">
          {subLabel}
        </text>
      )}
    </g>
  );
}

/* ────────────────────────────────────────────────────────────
   Compact repo node
   ──────────────────────────────────────────────────────────── */
function RepoNode({
  cx, cy, label, perm, delay = "0s",
}: {
  cx: number; cy: number; label: string; perm: Permission; delay?: string;
}) {
  const c = PERM_C[perm];
  const iconScale = (REPO_R * 1.1) / 24;
  const iconOff   = (24 * iconScale) / 2;
  const truncated = label.length > 11 ? label.slice(0, 10) + "…" : label;
  const pw = perm.length * 5.5 + 12;
  return (
    <g className="ciem-node-enter" style={{ animationDelay: delay, transformOrigin: `${cx}px ${cy}px` }}>
      <circle cx={cx} cy={cy} r={REPO_R} fill={c.fill} stroke={c.border} strokeWidth="1.5"/>
      <g transform={`translate(${cx - iconOff},${cy - iconOff}) scale(${iconScale})`}>
        <IconPaths type="repo" color={c.pill}/>
      </g>
      <text x={cx} y={cy + REPO_R + 14} textAnchor="middle"
        fontSize="10" fontWeight="600" fill="var(--c-surface-raised)"
        fontFamily="var(--fg-font-body)">
        {truncated}
      </text>
      <rect x={cx - pw / 2} y={cy + REPO_R + 26} width={pw} height={13} rx={6}
        fill={c.pill} opacity={0.88}/>
      <text x={cx} y={cy + REPO_R + 36} textAnchor="middle"
        fontSize="7.5" fontWeight="700" fill="var(--t-primary)" letterSpacing="0.05em"
        fontFamily="var(--fg-font-body)">
        {perm.toUpperCase()}
      </text>
    </g>
  );
}

/* ────────────────────────────────────────────────────────────
   Bezier arrow
   ──────────────────────────────────────────────────────────── */
function BezierEdge({
  x1, y1, x2, y2, perm, delay = "0s",
}: {
  x1: number; y1: number; x2: number; y2: number; perm: Permission; delay?: string;
}) {
  const mid = (x1 + x2) / 2;
  return (
    <path
      d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
      fill="none"
      stroke={PERM_C[perm].arrow}
      strokeWidth="1.4"
      markerEnd={`url(#ciem-arr-${perm.toLowerCase()})`}
      strokeDasharray="800"
      className="ciem-edge-draw"
      style={{ animationDelay: delay }}
    />
  );
}

/* ────────────────────────────────────────────────────────────
   Interactive grouped canvas
   ──────────────────────────────────────────────────────────── */
function CiemPathCanvas({ risk, nodeMap }: { risk: IdentityRisk; nodeMap: Map<string, OrgGraphNode> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const dragging  = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [animKey, setAnimKey] = useState(0);

  const cols   = useMemo(() => pickCols(risk.paths.length), [risk.paths.length]);
  const groups = useMemo(() => buildGroups(risk.paths, nodeMap, cols), [risk.paths, nodeMap, cols]);
  const svgH   = useMemo(() => totalSvgH(groups), [groups]);
  const idCY   = useMemo(() => centreY(groups), [groups]);
  const svgW   = useMemo(() => calcSvgW(cols), [cols]);

  const hasTeams = useMemo(() => groups.some((g) => g.teamId !== null), [groups]);

  const fitToContainer = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    if (!cw || !ch) return;
    const s = Math.min((cw - 80) / svgW, (ch - 80) / svgH, 1.2);
    setScale(s);
    setTx((cw - svgW * s) / 2);
    setTy((ch - svgH * s) / 2);
    setAnimKey((k) => k + 1);
  }, [svgW, svgH]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    fitToContainer();
    const ro = new ResizeObserver(fitToContainer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setTx((v) => v + dx);
    setTy((v) => v + dy);
  }, []);

  const onMouseUp = useCallback(() => { dragging.current = false; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const { left, top } = el.getBoundingClientRect();
    const mx = e.clientX - left;
    const my = e.clientY - top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setScale((s) => {
      const ns = Math.max(0.15, Math.min(4, s * factor));
      setTx((x) => mx - (mx - x) * (ns / s));
      setTy((y) => my - (my - y) * (ns / s));
      return ns;
    });
  }, []);

  return (
    <div
      ref={containerRef}
      className="ag-canvas-bg"
      style={{ flex: 1, cursor: dragging.current ? "grabbing" : "grab" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      <svg key={animKey} className="ag-canvas-svg" width="100%" height="100%" style={{ overflow: "visible" }}>
        <defs>
          {(["admin", "write"] as const).map((k) => {
            const color = k === "admin" ? "var(--s-critical)" : "var(--s-high)";
            return (
              <marker key={k} id={`ciem-arr-${k}`} markerWidth="7" markerHeight="7"
                refX="6" refY="3.5" orient="auto">
                <path d="M 0 0 L 7 3.5 L 0 7 Z" fill={color} opacity={0.75}/>
              </marker>
            );
          })}
          <style>{`
            .ciem-node-enter { animation: ciemNodeIn 0.32s cubic-bezier(0.16,1,0.3,1) both; }
            .ciem-edge-draw  { animation: ciemEdgeDraw 0.5s ease both; }
            @keyframes ciemNodeIn   { from { opacity:0; transform:scale(0.78); } to { opacity:1; transform:scale(1); } }
            @keyframes ciemEdgeDraw { from { stroke-dashoffset:800; opacity:0; } to { stroke-dashoffset:0; opacity:1; } }
          `}</style>
        </defs>

        <g transform={`translate(${tx},${ty}) scale(${scale})`}>

          {/* ── Column headers ─────────────────────────────── */}
          <text x={X_ID_C} y={24} textAnchor="middle" fontSize="9" fontWeight="700"
            letterSpacing="0.07em" fill="rgba(139, 156, 175,0.65)"
            fontFamily="var(--fg-font-body)">IDENTITY</text>

          {hasTeams && (
            <text x={X_TEAM_C} y={24} textAnchor="middle" fontSize="9" fontWeight="700"
              letterSpacing="0.07em" fill="rgba(139, 156, 175,0.65)"
              fontFamily="var(--fg-font-body)">VIA TEAM</text>
          )}

          <text
            x={X_REPO_C0 + ((cols - 1) * REPO_COL_W) / 2}
            y={24} textAnchor="middle" fontSize="9" fontWeight="700"
            letterSpacing="0.07em" fill="rgba(139, 156, 175,0.65)"
            fontFamily="var(--fg-font-body)">REPOSITORY</text>

          {/* ── Group-separator labels ──────────────────────── */}
          {groups.length > 1 && groups.map((g) => (
            <text key={`sep-${g.teamId}`}
              x={X_REPO_C0 - 8} y={g.startY - 8}
              fontSize="8" fontWeight="700" letterSpacing="0.06em"
              fill="rgba(139, 156, 175,0.45)"
              fontFamily="var(--fg-font-body)">
              {g.teamId
                ? (g.teamNode?.label ?? g.teamId).toUpperCase()
                : "DIRECT ACCESS"}
            </text>
          ))}

          {/* ── Identity node ──────────────────────────────── */}
          <CircleNode
            cx={X_ID_C} cy={idCY} r={ID_R}
            type={risk.node.type} label={risk.node.label}
            subLabel={TYPE_SUBLABELS[risk.node.type]}
            delay="0s"
          />

          {/* ── Per-group: team node + repo grid ───────────── */}
          {groups.map((group, gi) => {
            const groupBaseDelay = 0.05 + gi * 0.07;
            const idRight  = X_ID_C + ID_R;

            return (
              <g key={group.teamId ?? "direct"}>

                {/* Team node (indirect) or "DIRECT" ghost */}
                {group.teamId && group.teamNode ? (
                  <>
                    <BezierEdge
                      x1={idRight} y1={idCY}
                      x2={X_TEAM_C - TEAM_R} y2={group.teamCY}
                      perm={group.paths[0].permission}
                      delay={`${groupBaseDelay}s`}
                    />
                    <CircleNode
                      cx={X_TEAM_C} cy={group.teamCY} r={TEAM_R}
                      type="team" label={group.teamNode.label}
                      delay={`${groupBaseDelay}s`}
                    />
                  </>
                ) : (
                  hasTeams && (
                    <text x={X_TEAM_C} y={group.teamCY + 4} textAnchor="middle"
                      fontSize="8.5" fontWeight="700" letterSpacing="0.06em"
                      fill="rgba(139, 156, 175,0.4)"
                      fontFamily="var(--fg-font-body)">DIRECT</text>
                  )
                )}

                {/* Repo nodes + edges */}
                {group.paths.map((path, pi) => {
                  const pos      = repoPos(group, pi);
                  const label    = nodeMap.get(path.repoId)?.label ?? path.repoId;
                  const nodeDelay = `${groupBaseDelay + 0.04 + pi * 0.025}s`;

                  // Edge source: team right edge (indirect) or identity right edge (direct)
                  const srcX = group.teamId ? X_TEAM_C + TEAM_R : idRight;
                  const srcY = group.teamId ? group.teamCY      : idCY;

                  return (
                    <g key={`${path.repoId}-${pi}`}>
                      <BezierEdge
                        x1={srcX} y1={srcY}
                        x2={pos.x - REPO_R} y2={pos.y}
                        perm={path.permission}
                        delay={nodeDelay}
                      />
                      <RepoNode
                        cx={pos.x} cy={pos.y}
                        label={label}
                        perm={path.permission}
                        delay={nodeDelay}
                      />
                    </g>
                  );
                })}

              </g>
            );
          })}

        </g>
      </svg>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Risk badges
   ──────────────────────────────────────────────────────────── */
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

/* ────────────────────────────────────────────────────────────
   Main panel
   ──────────────────────────────────────────────────────────── */
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
  const selected = selectedId ? (risks.find((r) => r.nodeId === selectedId) ?? null) : null;

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
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>CIEM Attack Paths</span>
            <span className="cap-header-sub">Write &amp; Admin access paths</span>
          </div>
          <button className="cap-close" onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div className="cap-body">

          {/* Left sidebar */}
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
                  const color = ORG_NODE_COLORS[risk.node.type as keyof typeof ORG_NODE_COLORS] ?? "var(--t-muted)";
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
                          {risk.isServiceAdmin && <span className="cap-meta-critical">Service admin</span>}
                          {risk.isBroadAccess && !risk.isServiceAdmin && <span className="cap-meta-high">Broad access</span>}
                        </div>
                      </div>
                      <div className="cap-identity-perms">
                        {risk.permissions.has("Admin") && (
                          <span className="cap-perm-dot cap-perm-admin" title="Admin"/>
                        )}
                        {risk.permissions.has("Write") && (
                          <span className="cap-perm-dot cap-perm-write" title="Write"/>
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
                  <RiskBadges risk={selected}/>
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
                {/* key=nodeId remounts the canvas on identity switch, resetting pan/zoom and animations */}
                <CiemPathCanvas key={selected.nodeId} risk={selected} nodeMap={nodeMap}/>
              </>
            ) : (
              <div className="cap-detail-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                  stroke="rgba(139, 156, 175,0.45)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
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
