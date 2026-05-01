import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { OrgGraphResponse, OrgGraphNode } from "../types";
import { ORG_NODE_COLORS } from "../types";
import { computeAttackPaths, type IdentityRisk, type Permission } from "../lib/ciemAttackPaths";

/* ── Layout constants ─────────────────────────────────────── */
const ICON_R  = 28;
const COL_GAP = 90;
const L_PAD   = 80;
const ROW_H   = 130;
const TOP_PAD = 52;
const BOT_PAD = 64;

const X_ID_C   = L_PAD;
const X_TEAM_C = L_PAD + ICON_R * 2 + COL_GAP;
const X_REPO_C = X_TEAM_C + ICON_R * 2 + COL_GAP;
const SVG_W    = X_REPO_C + ICON_R + L_PAD;

function rowCY(i: number) { return TOP_PAD + i * ROW_H + ROW_H / 2; }
function svgHeight(n: number) { return TOP_PAD + n * ROW_H + BOT_PAD; }

/* ── Permission colors ─────────────────────────────────────── */
const PERM_COLORS: Record<Permission, { circle: string; border: string; pill: string }> = {
  Admin: { circle: "rgba(239,68,68,0.13)",  border: "rgba(239,68,68,0.5)",  pill: "#ef4444" },
  Write: { circle: "rgba(249,115,22,0.13)", border: "rgba(249,115,22,0.5)", pill: "#f97316" },
};
const PERM_ARROW: Record<Permission, string> = {
  Admin: "rgba(239,68,68,0.45)",
  Write: "rgba(249,115,22,0.45)",
};

/* ── Node colors ───────────────────────────────────────────── */
const NODE_COLORS: Record<string, { fill: string; border: string; icon: string }> = {
  user:    { fill: "rgba(59,130,246,0.12)",  border: "rgba(59,130,246,0.45)",  icon: "#3b82f6" },
  service: { fill: "rgba(139,92,246,0.12)",  border: "rgba(139,92,246,0.45)",  icon: "#8b5cf6" },
  team:    { fill: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.45)",  icon: "#f59e0b" },
  repo:    { fill: "rgba(16,185,129,0.12)",  border: "rgba(16,185,129,0.45)",  icon: "#10b981" },
};

const TYPE_SUBLABELS: Record<string, string> = {
  user: "User", service: "Service Account", team: "Team", repo: "Repository",
};

/* ── Sidebar icon constants ────────────────────────────────── */
const TYPE_ICONS: Record<string, string> = {
  user: "👤", service: "🤖", team: "👥", repo: "📦",
};

/* ── Inline SVG icon paths per node type ───────────────────── */
function NodeIconPaths({ type, color }: { type: string; color: string }) {
  const p = { fill: "none", stroke: color, strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "user":
      return <><path {...p} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle {...p} cx="12" cy="7" r="4"/></>;
    case "service":
      return <><rect {...p} x="4" y="4" width="16" height="16" rx="2"/><rect {...p} x="9" y="9" width="6" height="6"/><path {...p} d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" strokeWidth="1.4"/></>;
    case "team":
      return <><path {...p} d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle {...p} cx="9" cy="7" r="4"/><path {...p} d="M23 21v-2a4 4 0 0 0-3-3.87"/><path {...p} d="M16 3.13a4 4 0 0 1 0 7.75"/></>;
    case "repo":
      return <><path {...p} d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>;
    default:
      return <circle {...p} cx="12" cy="12" r="8"/>;
  }
}

/* ── SVG node: circle + icon + label + pill ─────────────────── */
function CiemSvgNode({
  cx, cy, type, label, pill, delay = "0s", permOverride,
}: {
  cx: number; cy: number; type: string; label: string;
  pill?: { text: string; color: string };
  delay?: string;
  permOverride?: Permission;
}) {
  const c = permOverride
    ? { fill: PERM_COLORS[permOverride].circle, border: PERM_COLORS[permOverride].border, icon: PERM_COLORS[permOverride].pill }
    : (NODE_COLORS[type] ?? { fill: "rgba(136,136,136,0.12)", border: "rgba(136,136,136,0.45)", icon: "#888" });

  const sub = TYPE_SUBLABELS[type] ?? type;
  const truncLabel = label.length > 15 ? label.slice(0, 14) + "…" : label;
  const truncSub   = sub.length > 18   ? sub.slice(0, 17) + "…"   : sub;

  const iconScale = 22 / 24;
  const iconOff   = ICON_R - 11;

  return (
    <g className="ciem-node-enter" style={{ animationDelay: delay, transformOrigin: `${cx}px ${cy}px` }}>
      {/* Circle background */}
      <circle cx={cx} cy={cy} r={ICON_R} fill={c.fill} stroke={c.border} strokeWidth="1.5" />

      {/* Icon — native SVG, no foreignObject */}
      <g transform={`translate(${cx - iconOff}, ${cy - iconOff}) scale(${iconScale})`}>
        <NodeIconPaths type={type} color={c.icon} />
      </g>

      {/* Label */}
      <text x={cx} y={cy + ICON_R + 17} textAnchor="middle"
        fontSize="12" fontWeight="600" fill="#1e293b" fontFamily="Geist, system-ui, sans-serif">
        {truncLabel}
      </text>

      {/* Sub-label */}
      <text x={cx} y={cy + ICON_R + 30} textAnchor="middle"
        fontSize="10" fill="#64748b" fontFamily="Geist, system-ui, sans-serif">
        {truncSub}
      </text>

      {/* Permission pill */}
      {pill && (() => {
        const pw = pill.text.length * 6.5 + 14;
        const pillY = cy + ICON_R + 40;
        return (
          <>
            <rect x={cx - pw / 2} y={pillY} width={pw} height={17} rx={8} fill={pill.color} opacity={0.92} />
            <text x={cx} y={pillY + 12} textAnchor="middle"
              fontSize="9.5" fontWeight="700" fill="#fff" letterSpacing="0.04em"
              fontFamily="Geist, system-ui, sans-serif">
              {pill.text}
            </text>
          </>
        );
      })()}
    </g>
  );
}

/* ── Bezier arrow ──────────────────────────────────────────── */
function CiemSvgArrow({
  x1, y1, x2, y2, perm, delay = "0s",
}: {
  x1: number; y1: number; x2: number; y2: number; perm: Permission; delay?: string;
}) {
  const mid = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
  return (
    <path
      d={d} fill="none"
      stroke={PERM_ARROW[perm]} strokeWidth="1.5"
      markerEnd={`url(#ciem-arr-${perm.toLowerCase()})`}
      strokeDasharray="800"
      className="ciem-edge-draw"
      style={{ animationDelay: delay }}
    />
  );
}

/* ── Interactive path canvas ───────────────────────────────── */
interface CanvasProps {
  risk: IdentityRisk;
  nodeMap: Map<string, OrgGraphNode>;
}

function CiemPathCanvas({ risk, nodeMap }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [animKey, setAnimKey] = useState(0);

  const { paths, node } = risk;
  const n = paths.length;
  const svgH = svgHeight(n);

  const fitToContainer = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    if (cw === 0 || ch === 0) return;
    const padX = 48; const padY = 48;
    const s = Math.min((cw - padX * 2) / SVG_W, (ch - padY * 2) / svgH, 1.15);
    setScale(s);
    setTx((cw - SVG_W * s) / 2);
    setTy((ch - svgH * s) / 2);
    setAnimKey((k) => k + 1);
  }, [svgH]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    fitToContainer();
    const ro = new ResizeObserver(() => fitToContainer());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setTx((v) => v + dx);
    setTy((v) => v + dy);
  }, []);

  const handleMouseUp = useCallback(() => { dragging.current = false; }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setScale((s) => {
      const ns = Math.max(0.2, Math.min(3, s * factor));
      setTx((x) => mx - (mx - x) * (ns / s));
      setTy((y) => my - (my - y) * (ns / s));
      return ns;
    });
  }, []);

  const idCY = svgH / 2;

  return (
    <div
      ref={containerRef}
      className="ag-canvas-bg"
      style={{ cursor: dragging.current ? "grabbing" : "grab", flex: 1 }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      <svg key={animKey} className="ag-canvas-svg" width="100%" height="100%" style={{ overflow: "visible" }}>
        <defs>
          {(["admin", "write"] as const).map((k) => {
            const color = k === "admin" ? "#ef4444" : "#f97316";
            return (
              <marker key={k} id={`ciem-arr-${k}`} markerWidth="7" markerHeight="7"
                refX="6" refY="3.5" orient="auto">
                <path d="M 0 0 L 7 3.5 L 0 7 Z" fill={color} opacity={0.8} />
              </marker>
            );
          })}
          <style>{`
            .ciem-node-enter { animation: ciemNodeIn 0.35s cubic-bezier(0.16,1,0.3,1) both; }
            .ciem-edge-draw  { animation: ciemEdgeDraw 0.55s ease both; }
            @keyframes ciemNodeIn {
              from { opacity: 0; transform: scale(0.82); }
              to   { opacity: 1; transform: scale(1); }
            }
            @keyframes ciemEdgeDraw {
              from { stroke-dashoffset: 800; opacity: 0; }
              to   { stroke-dashoffset: 0;   opacity: 1; }
            }
          `}</style>
        </defs>

        <g transform={`translate(${tx},${ty}) scale(${scale})`}>

          {/* Column headers */}
          {[
            { x: X_ID_C,   label: "IDENTITY" },
            { x: X_TEAM_C, label: "VIA TEAM" },
            { x: X_REPO_C, label: "REPOSITORY" },
          ].map(({ x, label }) => (
            <text key={label} x={x} y={22} textAnchor="middle"
              fontSize="9" fontWeight="700" letterSpacing="0.07em"
              fill="rgba(100,116,139,0.65)" fontFamily="Geist, system-ui, sans-serif">
              {label}
            </text>
          ))}

          {/* Identity node — vertically centred across all rows */}
          <CiemSvgNode
            cx={X_ID_C} cy={idCY}
            type={node.type}
            label={node.label}
            delay="0s"
          />

          {/* Path rows */}
          {paths.map((path, i) => {
            const repoNode = nodeMap.get(path.repoId);
            const teamNode = path.teamId ? nodeMap.get(path.teamId) : null;
            const cy = rowCY(i);
            const baseDelay = 0.08 + i * 0.06;

            return (
              <g key={`${path.repoId}-${path.permission}-${i}`}>
                {path.pathType === "indirect" && teamNode ? (
                  <>
                    <CiemSvgArrow
                      x1={X_ID_C + ICON_R} y1={idCY}
                      x2={X_TEAM_C - ICON_R} y2={cy}
                      perm={path.permission} delay={`${baseDelay}s`}
                    />
                    <CiemSvgArrow
                      x1={X_TEAM_C + ICON_R} y1={cy}
                      x2={X_REPO_C - ICON_R} y2={cy}
                      perm={path.permission} delay={`${baseDelay + 0.1}s`}
                    />
                    <CiemSvgNode
                      cx={X_TEAM_C} cy={cy}
                      type="team"
                      label={teamNode.label}
                      delay={`${baseDelay}s`}
                    />
                  </>
                ) : (
                  <CiemSvgArrow
                    x1={X_ID_C + ICON_R} y1={idCY}
                    x2={X_REPO_C - ICON_R} y2={cy}
                    perm={path.permission} delay={`${baseDelay}s`}
                  />
                )}

                <CiemSvgNode
                  cx={X_REPO_C} cy={cy}
                  type="repo"
                  label={repoNode?.label ?? path.repoId}
                  permOverride={path.permission}
                  pill={{ text: path.permission, color: PERM_COLORS[path.permission].pill }}
                  delay={`${baseDelay + 0.05}s`}
                />
              </g>
            );
          })}

        </g>
      </svg>
    </div>
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

  const totalIdentities = risks.length;
  const totalAdmin = risks.filter((r) => r.permissions.has("Admin")).length;
  const totalBroad = risks.filter((r) => r.isBroadAccess).length;
  const totalPaths = risks.reduce((s, r) => s + r.paths.length, 0);

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
                <CiemPathCanvas risk={selected} nodeMap={nodeMap} />
              </>
            ) : (
              <div className="cap-detail-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                  stroke="rgba(100,116,139,0.45)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
