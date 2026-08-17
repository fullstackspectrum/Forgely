import { useState, useRef, useEffect, useCallback } from "react";
import type { GraphResponse, CVERecord } from "../types";
import { SEVERITY_COLORS } from "../types";

/* ── Layout constants ───────────────────────────────────────── */
const NW = 164;       // main node card width
const NH = 62;        // main node card height
const NR = 10;        // main node corner radius
const ICON_R = 24;    // icon circle radius
const HX = 100;       // horizontal gap between stages
const CVE_NH = 80;    // CVE card height
const CVE_VGAP = 16;  // gap between CVE cards

const CNW = 148;      // client tool node width
const CNH = 46;       // client tool node height
const CGAP = 10;      // vertical gap between client tool nodes
const CPAD_X = 18;    // client box horizontal padding
const CPAD_Y = 18;    // client box vertical padding
const CLIENT_BOX_W = CNW + CPAD_X * 2;  // = 184

const X_INTERNET = CLIENT_BOX_W + HX;
const X_REPO     = X_INTERNET + NW + HX;
const X_PKG      = X_REPO     + NW + HX;
const X_CVE      = X_PKG      + NW + HX;

const STAGE_COLORS: Record<string, { accent: string; border: string; icon: string }> = {
  client:   { accent: "var(--fg-blue-200)", border: "rgba(133, 183, 235,0.4)",   icon: "var(--fg-blue-200)" },
  internet: { accent: "var(--c-action)", border: "rgba(55, 138, 221,0.45)",  icon: "var(--c-action)" },
  registry: { accent: "var(--fg-blue-300)", border: "rgba(92, 159, 228,0.45)", icon: "var(--fg-blue-300)" },
  repo:     { accent: "var(--s-none)", border: "rgba(107, 135, 163,0.45)",  icon: "var(--s-none)" },
  package:  { accent: "var(--s-critical)", border: "rgba(232, 117, 107,0.45)",   icon: "var(--s-critical)" },
  cve:      { accent: "var(--s-critical)", border: "rgba(232, 117, 107,0.45)",   icon: "var(--s-critical)" },
};

/** Convert a severity label to a STAGE_COLORS-style colour object. */
function sevColor(severity: string | undefined) {
  const hex = SEVERITY_COLORS[severity ?? ""] ?? SEVERITY_COLORS.High;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { accent: hex, border: `rgba(${r},${g},${b},0.45)`, icon: hex };
}

/* ── Access method helpers ───────────────────────────────────── */

interface AccessMethod {
  label: string;
  type: "native" | "cloudsmith";
  clientName: string;
  iconType: string;
}

function getAccessMethods(format: string): AccessMethod[] {
  const fmt = (format || "").toLowerCase();

  const n = (label: string, clientName: string, iconType: string): AccessMethod =>
    ({ label, type: "native", clientName, iconType });
  const cs = (label: string, clientName: string, iconType: string): AccessMethod =>
    ({ label, type: "cloudsmith", clientName, iconType });

  let native: AccessMethod[];
  if (fmt.includes("docker") || fmt.includes("container") || fmt.includes("oci")) {
    native = [n("docker pull", "Docker CLI", "docker")];
  } else if (fmt.includes("python") || fmt.includes("pypi")) {
    native = [n("pip install", "pip", "python"), n("poetry add", "Poetry", "python")];
  } else if (fmt.includes("npm") || fmt.includes("node") || fmt.includes("javascript")) {
    native = [n("npm install", "npm", "node"), n("yarn add", "Yarn", "node")];
  } else if (fmt.includes("maven") || fmt.includes("java")) {
    native = [n("mvn", "Maven CLI", "java"), n("gradle", "Gradle", "java")];
  } else if (fmt.includes("nuget") || fmt.includes("dotnet") || fmt.includes(".net")) {
    native = [n("dotnet add", ".NET CLI", "terminal"), n("nuget install", "NuGet", "terminal")];
  } else if (fmt.includes("ruby") || fmt.includes("gem") || fmt.includes("rubygem")) {
    native = [n("gem install", "Ruby gem", "ruby"), n("bundle install", "Bundler", "ruby")];
  } else if (fmt.includes("cargo") || fmt.includes("rust") || fmt.includes("crate")) {
    native = [n("cargo add", "Cargo CLI", "rust")];
  } else if (fmt.includes("golang") || fmt === "go") {
    native = [n("go get", "Go CLI", "go")];
  } else if (fmt.includes("helm")) {
    native = [n("helm pull", "Helm CLI", "terminal"), n("helm install", "Helm CLI", "terminal")];
  } else if (fmt.includes("debian") || fmt.includes("deb")) {
    native = [n("apt install", "apt", "terminal")];
  } else if (fmt.includes("rpm") || fmt.includes("redhat") || fmt.includes("rhel") || fmt.includes("fedora")) {
    native = [n("yum install", "yum", "terminal"), n("dnf install", "dnf", "terminal")];
  } else if (fmt.includes("terraform")) {
    native = [n("terraform", "Terraform CLI", "terminal")];
  } else if (fmt.includes("conan")) {
    native = [n("conan install", "Conan CLI", "terminal")];
  } else if (fmt.includes("composer") || fmt.includes("php")) {
    native = [n("composer require", "Composer", "terminal")];
  } else if (fmt.includes("dart") || fmt.includes("pub")) {
    native = [n("dart pub get", "Dart CLI", "terminal")];
  } else if (fmt.includes("conda")) {
    native = [n("conda install", "Conda CLI", "python")];
  } else if (fmt.includes("swift") || fmt.includes("spm")) {
    native = [n("swift package", "Swift CLI", "terminal")];
  } else {
    native = [n("curl", "curl", "terminal"), n("wget", "wget", "terminal")];
  }

  return [
    ...native,
    cs("cloudsmith download", "Cloudsmith CLI", "cloudsmith"),
    cs("Web UI",         "Browser",        "browser"),
  ];
}

interface Props {
  packageNodeId: string;
  data: GraphResponse;
  owner: string;
  onClose: () => void;
}

export default function AttackGraphPanel({ packageNodeId, data, owner, onClose }: Props) {
  const [cveExpanded, setCveExpanded] = useState(false);

  /* Close on Escape key */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

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

  const maxSev = packageNode.data.max_severity;
  const isQuarantined = packageNode.data.is_quarantined;
  const topCves = packageNode.data.cves.filter(
    (c) => c.severity === "Critical" || c.severity === "High",
  );

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
          <span className="ag-header-title">Attack Path</span>
          <span className="ag-header-pkg">{packageNode.label}</span>
          {isQuarantined && (
            <span className="ag-header-quarantine-badge">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Quarantined
            </span>
          )}
        </div>
        <button className="ag-close-btn" onClick={onClose} title="Close">×</button>
      </div>

      <AttackGraphCanvas
        packageNode={packageNode}
        displayRepos={displayRepos}
        criticalCves={topCves}
        cveExpanded={cveExpanded}
        onToggleCve={() => { if (topCves.length <= 10) setCveExpanded((v) => !v); }}
        owner={owner}
        repoSlug={data.repo}
        maxSev={maxSev}
        isQuarantined={isQuarantined}
      />
    </div>
  );
}

/* ── Interactive SVG canvas ─────────────────────────────────── */

interface CanvasProps {
  packageNode: ReturnType<GraphResponse["nodes"]["find"]> & {};
  displayRepos: NonNullable<ReturnType<Map<string, any>["get"]>>[];
  criticalCves: CVERecord[];  // Critical + High CVEs
  cveExpanded: boolean;
  onToggleCve: () => void;
  owner: string;
  repoSlug: string;
  maxSev: string | null;
  isQuarantined: boolean;
}

function AttackGraphCanvas({
  packageNode, displayRepos, criticalCves, cveExpanded,
  onToggleCve, owner, repoSlug, maxSev, isQuarantined,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [animKey, setAnimKey] = useState(0);

  /* Compute and apply a scale+translate that fits the graph in the container. */
  const fitToContainer = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    if (cw === 0 || ch === 0) return;

    const numCves = cveExpanded ? criticalCves.length : 1;
    const cveH = cveExpanded
      ? numCves * CVE_NH + (numCves - 1) * CVE_VGAP
      : CVE_NH;
    const methods = getAccessMethods(packageNode.data.format);
    const clientContentH = methods.length * CNH + Math.max(0, methods.length - 1) * CGAP;
    const clientBoxH = clientContentH + CPAD_Y * 2 + 18;
    const graphW = X_CVE + NW;
    const graphH = Math.max(clientBoxH, NH, cveH);

    const padX = 48;
    const padY = 32;
    const scaleX = (cw - padX * 2) / graphW;
    const scaleY = (ch - padY * 2) / graphH;
    const s = Math.min(scaleX, scaleY, 1.0);

    setScale(s);
    setTx((cw - graphW * s) / 2);
    setTy(ch / 2);
    setAnimKey((k) => k + 1);
  }, [cveExpanded, criticalCves.length, displayRepos.length, packageNode.data.format]);

  /* Re-fit whenever layout changes. Use ResizeObserver so the first fit fires
     after the panel has actually been painted (getBoundingClientRect returns 0
     on the synchronous first render tick). */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Try immediately — works when the effect re-runs after CVE toggle etc.
    fitToContainer();
    // Fall back to ResizeObserver for the initial mount, where the container
    // may not have dimensions yet in the synchronous render cycle.
    const ro = new ResizeObserver(() => fitToContainer());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer]);

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
            <path d="M0,0 L0,6 L8,3 z" fill="rgba(232, 117, 107,0.7)" />
          </marker>
          {/* Arrowhead for Cloudsmith-specific access edges */}
          <marker id="ag-arrow-cs" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="rgba(92, 159, 228,0.7)" />
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

          {/* ── Client group box + individual tool nodes + edges ── */}
          {(() => {
            const methods = getAccessMethods(packageNode!.data.format);
            const clientContentH = methods.length * CNH + Math.max(0, methods.length - 1) * CGAP;
            const boxLabelH = 18;
            const boxH = clientContentH + CPAD_Y * 2 + boxLabelH;
            const boxY = -(clientContentH / 2) - CPAD_Y - boxLabelH;
            return (
              <>
                {/* Dashed bounding box */}
                <rect
                  x={0} y={boxY} width={CLIENT_BOX_W} height={boxH} rx={14}
                  fill="rgba(14,165,233,0.04)"
                  stroke="rgba(14,165,233,0.25)"
                  strokeWidth="1.5" strokeDasharray="6,4"
                  className="ag-node-enter" style={{ animationDelay: "0s" }}
                />
                {/* "CLIENT" label inside top of box */}
                <text
                  x={CLIENT_BOX_W / 2} y={boxY + 13}
                  textAnchor="middle" fontSize="9" fontWeight="700" letterSpacing="0.07em"
                  fill="rgba(14,165,233,0.5)" fontFamily="Geist, system-ui, sans-serif"
                  style={{ textTransform: "uppercase", pointerEvents: "none" }}
                >CLIENT</text>

                {methods.map((method, i) => {
                  const nodeY = -(clientContentH / 2) + i * (CNH + CGAP);
                  const nodeCenterY = nodeY + CNH / 2;
                  const isNative = method.type === "native";
                  const nodeColor = isNative ? STAGE_COLORS.client : STAGE_COLORS.registry;
                  const edgeColor = isNative ? "rgba(55, 138, 221,0.5)" : "rgba(92, 159, 228,0.5)";
                  const labelBg   = isNative ? "rgba(55, 138, 221,0.88)" : "rgba(92, 159, 228,0.88)";
                  const animDelay = `${0.05 + i * 0.06}s`;

                  // Bezier from client node right edge → Internet left center
                  const ox = CLIENT_BOX_W;
                  const oy = nodeCenterY;
                  const ex = X_INTERNET + NW / 2 - ICON_R;
                  const ey = 0;
                  const cpx = (ox + ex) / 2;
                  const edgePath = `M ${ox} ${oy} C ${cpx} ${oy}, ${cpx} ${ey}, ${ex} ${ey}`;

                  // Label at t=0.5: y = 0.5*oy (symmetric CP)
                  const lx = cpx;
                  const ly = oy / 2;
                  const lw = method.label.length * 5.2 + 12;

                  return (
                    <g key={method.label}>
                      {/* Bezier edge */}
                      <path
                        d={edgePath}
                        stroke={edgeColor} strokeWidth="1.5" fill="none"
                        markerEnd={isNative ? "url(#ag-arrow-flow)" : "url(#ag-arrow-cs)"}
                        strokeDasharray="800" className="ag-edge-draw"
                        style={{ animationDelay: animDelay }}
                      />
                      {/* Edge label pill */}
                      <g className="ag-node-enter" style={{ animationDelay: animDelay, transformOrigin: `${lx}px ${ly}px` }}>
                        <rect x={lx - lw / 2} y={ly - 7} width={lw} height={14} rx={4} fill={labelBg} />
                        <text
                          x={lx} y={ly + 4.5} textAnchor="middle"
                          fontSize="8.5" fontWeight="600" fill="var(--t-primary)"
                          fontFamily='ui-monospace,"SF Mono",Consolas,monospace'
                          style={{ pointerEvents: "none" }}
                        >{method.label}</text>
                      </g>
                      {/* Client tool node */}
                      <SvgClientNode
                        id={`client-${i}`}
                        x={CPAD_X} y={nodeY}
                        label={method.clientName}
                        iconType={method.iconType}
                        color={nodeColor}
                        delay={animDelay}
                      />
                    </g>
                  );
                })}
              </>
            );
          })()}

          {/* ── Flow edge: Internet → Repo ── */}
          <line
            x1={X_INTERNET + NW / 2 + ICON_R} y1={0}
            x2={X_REPO + NW / 2 - ICON_R} y2={repoCount === 1 ? 0 : repoStartY + NH / 2}
            stroke="rgba(100,116,180,0.45)" strokeWidth="1.5"
            markerEnd="url(#ag-arrow-flow)"
            strokeDasharray="800" className="ag-edge-draw"
            style={{ animationDelay: "0.15s" }}
          />

          {/* Repo → Package edge(s) */}
          {displayRepos.map((repo, i) => {
            const ry = repoStartY + i * (NH + 12) + NH / 2;
            return (
              <line key={repo.id}
                x1={X_REPO + NW / 2 + ICON_R} y1={ry} x2={X_PKG + NW / 2 - ICON_R} y2={0}
                stroke={isQuarantined ? "rgba(232, 117, 107,0.5)" : "rgba(100,116,180,0.45)"}
                strokeWidth="1.5"
                markerEnd="url(#ag-arrow-flow)"
                strokeDasharray="800" className="ag-edge-draw"
                style={{ animationDelay: "0.25s" }}
              />
            );
          })}

          {/* Quarantine badge on Repo→Package edge midpoint */}
          {isQuarantined && displayRepos.map((repo, i) => {
            const ry = repoStartY + i * (NH + 12) + NH / 2;
            const mx = (X_REPO + NW + X_PKG) / 2;
            const my = ry / 2;
            return (
              <g key={`qbadge-${i}`} className="ag-node-enter"
                style={{ animationDelay: "0.55s", transformOrigin: `${mx}px ${my}px` }}>
                <rect x={mx - 47} y={my - 10} width={94} height={20} rx={5}
                  fill="white" stroke="rgba(234,88,12,0.6)" strokeWidth="1.5" />
                <foreignObject x={mx - 44} y={my - 7} width={14} height={14}>
                  <div style={{ width: 14, height: 14 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="rgba(234,88,12,0.9)"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </div>
                </foreignObject>
                <text x={mx - 25} y={my + 4.5} fontSize="9" fontWeight="700" letterSpacing="0.05em"
                  fill="rgba(194,65,12,0.9)" fontFamily="Geist, system-ui, sans-serif">
                  QUARANTINED
                </text>
              </g>
            );
          })}

          {/* ── Package → CVE edge(s) (dimmed when quarantined) ── */}
          <g opacity={isQuarantined ? 0.2 : 1}>
          {cveExpanded ? (
            criticalCves.map((cve, i) => {
              const cveY = cveStartY + i * (CVE_NH + CVE_VGAP) + CVE_NH / 2;
              const ox = X_PKG + NW / 2 + ICON_R;
              const oy = 0;
              const ex = X_CVE + NW / 2 - ICON_R;
              const ey = cveY;
              const cpx = (ox + ex) / 2;
              const ec = sevColor(cve.severity);
              return (
                <path key={cve.id}
                  d={`M ${ox} ${oy} C ${cpx} ${oy}, ${cpx} ${ey}, ${ex} ${ey}`}
                  stroke={ec.border} strokeWidth="1.5" fill="none"
                  markerEnd="url(#ag-arrow-cve)"
                  strokeDasharray="800" className="ag-edge-draw-cve"
                  style={{ animationDelay: `${0.05 * i}s` }}
                />
              );
            })
          ) : (
            <line
              x1={X_PKG + NW / 2 + ICON_R} y1={0} x2={X_CVE + NW / 2 - ICON_R} y2={0}
              stroke={sevColor(maxSev ?? undefined).border} strokeWidth="1.5"
              markerEnd="url(#ag-arrow-cve)"
              strokeDasharray="800" className="ag-edge-draw"
              style={{ animationDelay: "0.4s" }}
            />
          )}
          </g>

          {/* ── Internet node ── */}
          <SvgNode
            id="internet"
            x={X_INTERNET} y={-NH / 2}
            w={NW} h={NH} r={NR}
            color={STAGE_COLORS.internet}
            label="Internet"
            sub="Public network"
            delay="0.1s"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke={STAGE_COLORS.internet.icon}
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
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
                sub={owner}
                delay={`${0.15 + i * 0.05}s`}
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
            color={isQuarantined ? { accent: "var(--s-high)", border: "rgba(240, 138, 90,0.5)", icon: STAGE_COLORS.package.icon } : STAGE_COLORS.package}
            label={packageNode!.label}
            sub={packageNode!.data.version || ""}
            pill={isQuarantined
              ? { text: "Quarantined", color: "var(--s-high)" }
              : { text: maxSev ?? "High", color: SEVERITY_COLORS[maxSev ?? "High"] ?? SEVERITY_COLORS.High }}
            delay="0.35s"
            icon={
              isQuarantined
                ? <svg viewBox="0 0 24 24" fill="none" stroke="var(--s-high)"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                : <svg viewBox="0 0 24 24" fill="none" stroke={STAGE_COLORS.package.icon}
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                    <line x1="12" y1="22.08" x2="12" y2="12"/>
                  </svg>
            }
          />

          {/* ── CVE node(s) (dimmed when quarantined) ── */}
          <g opacity={isQuarantined ? 0.2 : 1}>
          {cveExpanded ? (
            criticalCves.map((cve, i) => {
              const cy = cveStartY + i * (CVE_NH + CVE_VGAP);
              return (
                <SvgNode
                  key={cve.id}
                  id={`cve-${i}`}
                  x={X_CVE} y={cy}
                  w={NW} h={CVE_NH} r={NR}
                  color={sevColor(cve.severity)}
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
            /* CVE summary — clickable when ≤ 10 CVEs */
            <g
              data-clickable={criticalCves.length <= 10 ? "1" : undefined}
              onClick={criticalCves.length <= 10 ? onToggleCve : undefined}
              style={{ cursor: criticalCves.length <= 10 ? "pointer" : "default" }}
            >
              <SvgNode
                id="cve-summary"
                x={X_CVE} y={-NH / 2}
                w={NW} h={NH} r={NR}
                color={sevColor(maxSev ?? undefined)}
                label={`${criticalCves.length} CVE${criticalCves.length !== 1 ? "s" : ""}`}
                sub={criticalCves.length > 10 ? "Too many to expand" : "Click to expand ▾"}
                delay="0.45s"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke={sevColor(maxSev ?? undefined).icon}
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
                  color: "rgba(10, 22, 34,0.4)", fontSize: "11px", fontWeight: 600,
                  cursor: "pointer", fontFamily: "Geist, system-ui, sans-serif",
                  letterSpacing: "0.05em",
                }}
              >
                ▸ Collapse
              </button>
            </foreignObject>
          )}
          </g>{/* end CVE dimming group */}

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
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g
      className="ag-node-enter"
      style={{ animationDelay: delay, transformOrigin: `${cx}px ${cy}px` }}
    >
      {/* Circle background */}
      <circle cx={cx} cy={cy} r={ICON_R}
        fill={color.accent} fillOpacity={0.10}
        stroke={color.border} strokeWidth="1.5"
      />

      {/* Icon */}
      {icon && (
        <foreignObject x={cx - 14} y={cy - 14} width={28} height={28}>
          <div style={{ width: 28, height: 28 }}>{icon}</div>
        </foreignObject>
      )}

      {/* Label */}
      <text x={cx} y={cy + ICON_R + 16} textAnchor="middle"
        fontSize="12" fontWeight="600" fill="var(--c-surface-raised)"
        fontFamily={labelMono ? 'ui-monospace,"SF Mono",Consolas,monospace' : "Geist, system-ui, sans-serif"}
      >
        {label.length > 20 ? label.slice(0, 19) + "…" : label}
      </text>

      {/* Sub */}
      {sub && (
        <text x={cx} y={cy + ICON_R + 30} textAnchor="middle"
          fontSize="10" fill="var(--fg-n-600)"
          fontFamily="Geist, system-ui, sans-serif"
        >
          {sub.length > 24 ? sub.slice(0, 23) + "…" : sub}
        </text>
      )}

      {/* Pill badge */}
      {pill && (() => {
        const pw = pill.text.length * 6.5 + 12;
        const pillY = cy + ICON_R + (sub ? 36 : 20);
        return (
          <>
            <rect x={cx - pw / 2} y={pillY} width={pw} height={16} rx={8}
              fill={pill.color} opacity="0.9" />
            <text x={cx} y={pillY + 11.5} textAnchor="middle"
              fontSize="9" fontWeight="700" fill="var(--t-primary)"
              fontFamily="Geist, system-ui, sans-serif" letterSpacing="0.04em">
              {pill.text}
            </text>
          </>
        );
      })()}
    </g>
  );
}

/* ── Client tool node (compact) ─────────────────────────────── */

interface SvgClientNodeProps {
  id: string;
  x: number; y: number;
  label: string;
  iconType: string;
  color: { accent: string; border: string; icon: string };
  delay: string;
}

function SvgClientNode({ id, x, y, label, iconType, color, delay }: SvgClientNodeProps) {
  const w = CNW; const h = CNH;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = 18;
  return (
    <g className="ag-node-enter" style={{ animationDelay: delay, transformOrigin: `${cx}px ${cy}px` }}>
      <circle cx={cx} cy={cy} r={r}
        fill={color.accent} fillOpacity={0.10}
        stroke={color.border} strokeWidth="1.5"
      />
      <foreignObject x={cx - 10} y={cy - 10} width={20} height={20}>
        <div style={{ width: 20, height: 20 }}>{getClientIcon(iconType, color.icon)}</div>
      </foreignObject>
      <text x={cx} y={cy + r + 14} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--c-surface-raised)"
        fontFamily="Geist, system-ui, sans-serif">
        {label.length > 16 ? label.slice(0, 15) + "…" : label}
      </text>
    </g>
  );
}

function getClientIcon(iconType: string, color: string) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (iconType) {
    case "browser":
      return <svg {...props}><rect x="2" y="3" width="20" height="16" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><circle cx="6" cy="6" r="1" fill={color}/><circle cx="10" cy="6" r="1" fill={color}/></svg>;
    case "docker":
      return <svg {...props}><rect x="2" y="11" width="20" height="9" rx="2"/><rect x="4" y="6" width="5" height="5" rx="1"/><rect x="10" y="6" width="5" height="5" rx="1"/><rect x="7" y="2" width="5" height="4" rx="1"/></svg>;
    case "python":
      return <svg {...props}><path d="M12 2C9 2 7 4 7 6v2h5v1H6C4 9 2 11 2 14s2 5 4 5h2v-3H6v-2h6v1c0 2 2 4 5 4s5-2 5-5-2-5-5-5h-1V8h-1V6c0-2-2-4-5-4z" strokeWidth="1.5"/><circle cx="9.5" cy="5.5" r="1" fill={color} stroke="none"/><circle cx="14.5" cy="18.5" r="1" fill={color} stroke="none"/></svg>;
    case "node":
      return <svg {...props}><path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/><path d="M12 2v20M2 7l10 5M22 7l-10 5"/></svg>;
    case "java":
      return <svg {...props}><path d="M9 20c0 0 2 1 4 1s4-1 4-1M8 17c0 0 2 1.5 4 1.5S16 17 16 17"/><path d="M10 3c0 0-2 3-2 5s2 4 2 4-4-1-4-4 1-5 4-5z"/><path d="M14 3c0 0 2 3 2 5s-2 4-2 4 4-1 4-4-1-5-4-5z"/><rect x="8" y="11" width="8" height="5" rx="1"/></svg>;
    case "ruby":
      return <svg {...props}><path d="M12 2l4 4-1 6-3 3-3-3-1-6L12 2z"/><path d="M8 6l-4 8h16l-4-8"/><line x1="12" y1="14" x2="12" y2="20"/></svg>;
    case "rust":
      return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18"/><circle cx="12" cy="12" r="3" fill={color} stroke="none" opacity="0.4"/></svg>;
    case "go":
      return <svg {...props}><path d="M5 12a7 7 0 0 1 14 0"/><path d="M5 12a7 7 0 0 0 14 0"/><line x1="12" y1="5" x2="12" y2="19"/><polyline points="9 16 12 19 15 16"/></svg>;
    case "api":
      return <svg {...props}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="12" y1="4" x2="12" y2="20" strokeWidth="1.2"/></svg>;
    case "cloudsmith":
      return <svg {...props}><rect x="2" y="3" width="20" height="18" rx="2"/><polyline points="6 9 10 13 6 17"/><line x1="12" y1="17" x2="18" y2="17"/></svg>;
    default: // terminal
      return <svg {...props}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
  }
}
