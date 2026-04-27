import { useState, useRef, useEffect, useCallback } from "react";
import type { GraphResponse, CVERecord } from "../types";
import { SEVERITY_COLORS } from "../types";

/* ── Layout constants ───────────────────────────────────────── */
const NW = 164;       // node card width
const NH = 62;        // node card height
const NR = 10;        // card corner radius
const HX = 200;       // horizontal gap between stages
const CVE_NH = 80;    // CVE card height (more text)
const CVE_VGAP = 16;  // vertical gap between CVE cards

const X_INTERNET = 0;
const X_REGISTRY  = X_INTERNET + NW + HX;
const X_REPO      = X_REGISTRY  + NW + HX;
const X_PKG       = X_REPO      + NW + HX;
const X_CVE       = X_PKG       + NW + HX;

const STAGE_COLORS: Record<string, { accent: string; border: string; icon: string }> = {
  internet: { accent: "#4a90d9", border: "rgba(74,144,217,0.45)",  icon: "#4a90d9" },
  registry: { accent: "#8b5cf6", border: "rgba(139,92,246,0.45)", icon: "#8b5cf6" },
  repo:     { accent: "#10b981", border: "rgba(16,185,129,0.45)",  icon: "#10b981" },
  package:  { accent: "#ff4d4d", border: "rgba(255,77,77,0.45)",   icon: "#ff4d4d" },
  cve:      { accent: "#ef4444", border: "rgba(239,68,68,0.45)",   icon: "#ef4444" },
};

interface Props {
  packageNodeId: string;
  data: GraphResponse;
  owner: string;
  onClose: () => void;
}

export default function AttackGraphPanel({ packageNodeId, data, owner, onClose }: Props) {
  const [cveExpanded, setCveExpanded] = useState(false);

  const packageNode = data.nodes.find((n) => n.id === packageNodeId);
  if (!packageNode) return null;

  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
  const repoNodes = data.edges
    .filter((e) => e.type === "repo_package")
    .flatMap((e) => {
      if (e.target === packageNodeId) return [nodeMap.get(e.source)];
      if (e.source === packageNodeId) return [nodeMap.get(e.target)];
      return [];
    })
    .filter((n): n is NonNullable<typeof n> => !!n && n.type === "repo");

  const seenRepos = new Set<string>();
  const displayRepos = repoNodes.filter((n) => {
    if (seenRepos.has(n.id)) return false;
    seenRepos.add(n.id);
    return true;
  });
  if (displayRepos.length === 0) {
    const fb = data.nodes.find((n) => n.type === "repo");
    if (fb) displayRepos.push(fb);
  }

  const criticalCves = packageNode.data.cves.filter((c) => c.severity === "Critical");
  const maxSev = packageNode.data.max_severity;

  return (
    <div className="attack-graph-panel">
      <div className="ag-header">
        <div className="ag-header-left">
          <svg className="ag-header-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <span className="ag-header-title">Attack Graph</span>
          <span className="ag-header-pkg">{packageNode.label}</span>
        </div>
        <button className="ag-close-btn" onClick={onClose} title="Close">×</button>
      </div>

      <AttackGraphCanvas
        packageNode={packageNode}
        displayRepos={displayRepos}
        criticalCves={criticalCves}
        cveExpanded={cveExpanded}
        onToggleCve={() => setCveExpanded((v) => !v)}
        owner={owner}
        repoSlug={data.repo}
        maxSev={maxSev}
      />
    </div>
  );
}

/* ── Interactive SVG canvas ─────────────────────────────────── */

interface CanvasProps {
  packageNode: ReturnType<GraphResponse["nodes"]["find"]> & {};
  displayRepos: NonNullable<ReturnType<Map<string, any>["get"]>>[];
  criticalCves: CVERecord[];
  cveExpanded: boolean;
  onToggleCve: () => void;
  owner: string;
  repoSlug: string;
  maxSev: string | null;
}

function AttackGraphCanvas({
  packageNode, displayRepos, criticalCves, cveExpanded,
  onToggleCve, owner, repoSlug, maxSev,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const initialized = useRef(false);
  const [animKey, setAnimKey] = useState(0);

  /* Centre graph on first render and whenever layout changes */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    if (cw === 0) return;

    const numCves = cveExpanded ? criticalCves.length : 1;
    const cveH = cveExpanded
      ? numCves * CVE_NH + (numCves - 1) * CVE_VGAP
      : CVE_NH;
    const graphW = X_CVE + NW;
    const graphH = Math.max(NH, cveH);

    const padX = 80;
    const padY = 60;
    const scaleX = (cw - padX * 2) / graphW;
    const scaleY = (ch - padY * 2) / (graphH + 36 /* label */);
    const s = Math.min(scaleX, scaleY, 1.2);
    const stx = (cw - graphW * s) / 2;
    const sty = (ch - graphH * s) / 2 + 18 * s;

    setScale(s);
    setTx(stx);
    setTy(sty);
    if (!initialized.current) initialized.current = true;
    setAnimKey((k) => k + 1);
  }, [cveExpanded, criticalCves.length, displayRepos.length]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest("[data-clickable]")) return;
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
      const ns = Math.max(0.25, Math.min(3, s * factor));
      setTx((x) => mx - (mx - x) * (ns / s));
      setTy((y) => my - (my - y) * (ns / s));
      return ns;
    });
  }, []);

  /* Repo Y positions */
  const repoCount = displayRepos.length;
  const totalRepoH = repoCount * NH + (repoCount - 1) * 12;
  const repoStartY = -totalRepoH / 2;

  /* CVE Y positions */
  const numCves = criticalCves.length;
  const totalCveH = numCves * CVE_NH + Math.max(0, numCves - 1) * CVE_VGAP;
  const cveStartY = -totalCveH / 2;

  /* Package centre Y */
  const pkgY = -NH / 2;

  return (
    <div
      ref={containerRef}
      className="ag-canvas-bg"
      style={{ cursor: dragging.current ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      <svg
        key={animKey}
        className="ag-canvas-svg"
        width="100%"
        height="100%"
        style={{ overflow: "visible" }}
      >
        <defs>
          {/* Arrowhead for flow edges */}
          <marker id="ag-arrow-flow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="rgba(100,116,180,0.6)" />
          </marker>
          {/* Arrowhead for CVE edges */}
          <marker id="ag-arrow-cve" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="rgba(239,68,68,0.7)" />
          </marker>
          <style>{`
            .ag-node-enter { animation: agNodeIn 0.35s cubic-bezier(0.16,1,0.3,1) both; }
            .ag-edge-draw  { animation: agEdgeDraw 0.6s ease both; }
            .ag-edge-draw-cve { animation: agEdgeDraw 0.5s ease both; }
            @keyframes agNodeIn {
              from { opacity: 0; transform: scale(0.85); }
              to   { opacity: 1; transform: scale(1); }
            }
            @keyframes agEdgeDraw {
              from { stroke-dashoffset: 800; opacity: 0; }
              to   { stroke-dashoffset: 0;   opacity: 1; }
            }
          `}</style>
        </defs>

        <g transform={`translate(${tx},${ty}) scale(${scale})`}>

          {/* ── Stage labels ── */}
          {[
            { label: "Origin",       x: X_INTERNET + NW / 2 },
            { label: "Registry",     x: X_REGISTRY  + NW / 2 },
            { label: "Repository",   x: X_REPO      + NW / 2 },
            { label: "Package",      x: X_PKG       + NW / 2 },
            { label: "Vulnerabilities", x: X_CVE    + NW / 2 },
          ].map(({ label, x }) => (
            <text key={label} x={x} y={-NH / 2 - 18} textAnchor="middle"
              fontSize="10" fontWeight="600" letterSpacing="0.06em"
              fill="rgba(0,0,0,0.35)" fontFamily="Geist, system-ui, sans-serif"
              style={{ textTransform: "uppercase" }}>
              {label}
            </text>
          ))}

          {/* ── Flow edges: Internet → Registry → Repo → Package ── */}
          {[
            { x1: X_INTERNET + NW, y1: 0, x2: X_REGISTRY, y2: 0, delay: "0.1s" },
            { x1: X_REGISTRY  + NW, y1: 0, x2: X_REPO,    y2: repoCount === 1 ? 0 : repoStartY + NH / 2, delay: "0.2s" },
          ].map((e, i) => (
            <line key={i}
              x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
              stroke="rgba(100,116,180,0.45)" strokeWidth="1.5"
              markerEnd="url(#ag-arrow-flow)"
              strokeDasharray="800" className="ag-edge-draw"
              style={{ animationDelay: e.delay }}
            />
          ))}

          {/* Repo → Package edge(s) */}
          {displayRepos.map((repo, i) => {
            const ry = repoStartY + i * (NH + 12) + NH / 2;
            return (
              <line key={repo.id}
                x1={X_REPO + NW} y1={ry} x2={X_PKG} y2={0}
                stroke="rgba(100,116,180,0.45)" strokeWidth="1.5"
                markerEnd="url(#ag-arrow-flow)"
                strokeDasharray="800" className="ag-edge-draw"
                style={{ animationDelay: "0.3s" }}
              />
            );
          })}

          {/* ── Package → CVE edge(s) ── */}
          {cveExpanded ? (
            criticalCves.map((cve, i) => {
              const cveY = cveStartY + i * (CVE_NH + CVE_VGAP) + CVE_NH / 2;
              const ox = X_PKG + NW;
              const oy = 0;
              const ex = X_CVE;
              const ey = cveY;
              const cpx = (ox + ex) / 2;
              return (
                <path key={cve.id}
                  d={`M ${ox} ${oy} C ${cpx} ${oy}, ${cpx} ${ey}, ${ex} ${ey}`}
                  stroke="rgba(239,68,68,0.5)" strokeWidth="1.5" fill="none"
                  markerEnd="url(#ag-arrow-cve)"
                  strokeDasharray="800" className="ag-edge-draw-cve"
                  style={{ animationDelay: `${0.05 * i}s` }}
                />
              );
            })
          ) : (
            <line
              x1={X_PKG + NW} y1={0} x2={X_CVE} y2={0}
              stroke="rgba(239,68,68,0.5)" strokeWidth="1.5"
              markerEnd="url(#ag-arrow-cve)"
              strokeDasharray="800" className="ag-edge-draw"
              style={{ animationDelay: "0.4s" }}
            />
          )}

          {/* ── Internet node ── */}
          <SvgNode
            id="internet"
            x={X_INTERNET} y={-NH / 2}
            w={NW} h={NH} r={NR}
            color={STAGE_COLORS.internet}
            label="Internet"
            sub="Public access"
            delay="0s"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke={STAGE_COLORS.internet.icon}
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            }
          />

          {/* ── Registry node ── */}
          <SvgNode
            id="registry"
            x={X_REGISTRY} y={-NH / 2}
            w={NW} h={NH} r={NR}
            color={STAGE_COLORS.registry}
            label="Cloudsmith"
            sub={owner}
            delay="0.15s"
            icon={
              <image href="/cloudsmith.png" x="0" y="0" width="20" height="20"
                style={{ borderRadius: 4 }} />
            }
          />

          {/* ── Repo node(s) ── */}
          {displayRepos.map((repo, i) => {
            const ry = repoStartY + i * (NH + 12);
            return (
              <SvgNode
                key={repo.id}
                id={`repo-${i}`}
                x={X_REPO} y={ry}
                w={NW} h={NH} r={NR}
                color={STAGE_COLORS.repo}
                label={repo.label || repoSlug}
                sub="Repository"
                delay={`${0.25 + i * 0.05}s`}
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke={STAGE_COLORS.repo.icon}
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                }
              />
            );
          })}

          {/* ── Package node ── */}
          <SvgNode
            id="package"
            x={X_PKG} y={pkgY}
            w={NW} h={NH} r={NR}
            color={STAGE_COLORS.package}
            label={packageNode!.label}
            sub={packageNode!.data.version || ""}
            pill={{ text: "Critical", color: SEVERITY_COLORS.Critical }}
            delay="0.35s"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke={STAGE_COLORS.package.icon}
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            }
          />

          {/* ── CVE node(s) ── */}
          {cveExpanded ? (
            criticalCves.map((cve, i) => {
              const cy = cveStartY + i * (CVE_NH + CVE_VGAP);
              return (
                <SvgNode
                  key={cve.id}
                  id={`cve-${i}`}
                  x={X_CVE} y={cy}
                  w={NW} h={CVE_NH} r={NR}
                  color={STAGE_COLORS.cve}
                  label={cve.id || "Unknown"}
                  sub={cve.affected
                    ? `${cve.affected}${cve.affected_version ? ` @ ${cve.affected_version}` : ""}`
                    : (cve.description || "").slice(0, 30) + "…"}
                  labelMono
                  delay={`${0.1 * i}s`}
                  icon={
                    <svg viewBox="0 0 24 24" fill="none" stroke={STAGE_COLORS.cve.icon}
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  }
                />
              );
            })
          ) : (
            /* CVE summary — clickable */
            <g
              data-clickable="1"
              onClick={onToggleCve}
              style={{ cursor: "pointer" }}
            >
              <SvgNode
                id="cve-summary"
                x={X_CVE} y={-NH / 2}
                w={NW} h={NH} r={NR}
                color={STAGE_COLORS.cve}
                label={`${criticalCves.length} Critical CVE${criticalCves.length !== 1 ? "s" : ""}`}
                sub="Click to expand ▾"
                delay="0.45s"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke={STAGE_COLORS.cve.icon}
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                }
                clickable
              />
            </g>
          )}

          {/* Collapse button when CVEs are expanded */}
          {cveExpanded && (
            <foreignObject
              x={X_CVE}
              y={cveStartY + totalCveH + 10}
              width={NW}
              height={28}
              data-clickable="1"
            >
              <button
                onClick={onToggleCve}
                style={{
                  width: "100%", height: "100%",
                  background: "none", border: "none",
                  color: "rgba(0,0,0,0.4)", fontSize: "11px", fontWeight: 600,
                  cursor: "pointer", fontFamily: "Geist, system-ui, sans-serif",
                  letterSpacing: "0.05em",
                }}
              >
                ▸ Collapse
              </button>
            </foreignObject>
          )}

        </g>
      </svg>
    </div>
  );
}

/* ── SVG node card ───────────────────────────────────────────── */

interface SvgNodeProps {
  id: string;
  x: number; y: number; w: number; h: number; r: number;
  color: { accent: string; border: string; icon: string };
  label: string;
  sub?: string;
  pill?: { text: string; color: string };
  icon?: React.ReactNode;
  delay?: string;
  labelMono?: boolean;
  clickable?: boolean;
}

function SvgNode({ id, x, y, w, h, r, color, label, sub, pill, icon, delay = "0s", labelMono, clickable }: SvgNodeProps) {
  const clipId = `clip-${id}`;
  return (
    <g
      className="ag-node-enter"
      style={{ animationDelay: delay, transformOrigin: `${x + w / 2}px ${y + h / 2}px` }}
    >
      {/* Shadow */}
      <rect x={x + 1} y={y + 3} width={w} height={h} rx={r} fill="rgba(0,0,0,0.07)" />
      {/* Card */}
      <rect
        x={x} y={y} width={w} height={h} rx={r}
        fill={clickable ? "rgba(255,245,245,0.9)" : "rgba(255,255,255,0.95)"}
        stroke={color.border}
        strokeWidth="1"
      />
      {/* Accent bar */}
      <clipPath id={clipId}>
        <rect x={x} y={y} width={w} height={h} rx={r} />
      </clipPath>
      <rect x={x} y={y} width={w} height={4} fill={color.accent} clipPath={`url(#${clipId})`} />

      {/* Icon */}
      {icon && (
        <foreignObject x={x + 10} y={y + 14} width={20} height={20}>
          <div style={{ width: 20, height: 20 }}>{icon}</div>
        </foreignObject>
      )}

      {/* Label */}
      <text
        x={x + (icon ? 38 : 12)} y={y + h / 2 - (sub ? 8 : 0) - (pill ? 4 : 0)}
        fontSize="12.5" fontWeight="600"
        fill="#111827"
        fontFamily={labelMono ? 'ui-monospace,"SF Mono",Consolas,monospace' : "Geist, system-ui, sans-serif"}
      >
        {label.length > 18 ? label.slice(0, 17) + "…" : label}
      </text>

      {/* Sub */}
      {sub && (
        <text
          x={x + (icon ? 38 : 12)} y={y + h / 2 + 10 - (pill ? 4 : 0)}
          fontSize="10.5" fill="#6b7280"
          fontFamily="Geist, system-ui, sans-serif"
        >
          {sub.length > 22 ? sub.slice(0, 21) + "…" : sub}
        </text>
      )}

      {/* Pill badge */}
      {pill && (
        <>
          <rect x={x + (icon ? 38 : 12)} y={y + h - 18} width={pill.text.length * 6.5 + 10} height={13} rx={3}
            fill={pill.color} opacity="0.9" />
          <text x={x + (icon ? 43 : 17)} y={y + h - 8}
            fontSize="9.5" fontWeight="700" fill="#fff"
            fontFamily="Geist, system-ui, sans-serif" letterSpacing="0.04em">
            {pill.text}
          </text>
        </>
      )}
    </g>
  );
}
