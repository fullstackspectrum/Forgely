import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { EdgeCurvedArrowProgram } from "@sigma/edge-curve";
import { NodeSquareProgram, NodeTiltedSquareProgram } from "../programs/roundedSquare";
import { NodeHexagonProgram } from "../programs/NodeHexagonProgram";
import { NodeTriangleProgram } from "../programs/NodeTriangleProgram";
import EdgeDottedProgram from "../programs/EdgeDottedProgram";
import EdgeCurvedDottedProgram from "../programs/EdgeCurvedDottedProgram";
import { drawDarkNodeHover, drawNodeLabel } from "../lib/hoverRenderer";
import type { OrgGraphResponse, LayoutType, EdgeStyle } from "../types";
import { ORG_NODE_COLORS, ORG_NODE_SHAPE } from "../types";
import { token, dimToCanvas, DIM } from "../lib/palette";
import { fitAround } from "../lib/focus";
import { assignCircle, assignRings, resolveOverlaps } from "../lib/layout";

/* Size carries weight, and separates the two kinds that share a shape: a team
 * is a larger circle than the users in it, an entitlement a much smaller square
 * than the repository it grants access to. */
const NODE_SIZE: Record<string, number> = {
  org: 40,
  repo: 20,
  team: 16,
  upstream: 14,
  user: 11,
  service: 12,
  entitlement: 8,
};

const EDGE_COLORS: Record<string, string> = {
  org_repo:         "rgba(107, 135, 163,0.5)",
  member_org:       "rgba(240, 138, 90,0.5)",
  service_org:      "rgba(92, 159, 228,0.5)",
  team_org:         "rgba(232, 117, 107,0.5)",
  team_member:      "rgba(232, 117, 107,0.6)",
  access:           "rgba(55, 138, 221,0.25)",
  entitlement_repo: "rgba(217, 182, 92,0.4)",
  repo_upstream:    "rgba(133, 183, 235,0.5)",
  shared_upstream:  "rgba(240, 138, 90,0.7)",
  /* Connected repositories are an upstream that happens to be internal, so
     they take the upstream blue — brighter and heavier, because unlike a
     shared upstream this is a path packages actually travel. */
  repo_connected:   "rgba(133, 183, 235,0.75)",
};

const EDGE_COLORS_BRIGHT: Record<string, string> = {
  org_repo:         "rgba(107, 135, 163,0.90)",
  member_org:       "rgba(240, 138, 90,0.90)",
  service_org:      "rgba(92, 159, 228,0.90)",
  team_org:         "rgba(232, 117, 107,0.90)",
  team_member:      "rgba(232, 117, 107,0.90)",
  access:           "rgba(55, 138, 221,0.85)",
  entitlement_repo: "rgba(217, 182, 92,0.90)",
  repo_upstream:    "rgba(133, 183, 235,0.90)",
  shared_upstream:  "rgba(240, 138, 90,0.90)",
  repo_connected:   "rgba(133, 183, 235,0.95)",
};

function assignOrgTreeLayout(graph: Graph, horizontal: boolean) {
  const visited = new Set<string>();
  const children: Record<string, string[]> = {};
  const depthOf: Record<string, number> = {};

  let root: string | null = null;
  graph.forEachNode((node, attrs) => {
    if (attrs.nodeType === "org") root = node;
  });
  if (!root) {
    root = graph.nodes()[0];
    if (!root) return;
  }

  const queue: string[] = [root];
  visited.add(root);
  depthOf[root] = 0;
  children[root] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    graph.forEachNeighbor(id, (neighbor) => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        depthOf[neighbor] = depthOf[id] + 1;
        children[neighbor] = [];
        if (!children[id]) children[id] = [];
        children[id].push(neighbor);
        queue.push(neighbor);
      }
    });
  }

  graph.forEachNode((node) => {
    if (!visited.has(node)) {
      visited.add(node);
      depthOf[node] = 1;
      children[node] = [];
      children[root!].push(node);
    }
  });

  const totalNodes = graph.order;
  const nodeSpacing = totalNodes > 300 ? 20 : totalNodes > 100 ? 35 : 50;
  const levelSpacing = totalNodes > 300 ? 180 : totalNodes > 100 ? 200 : 250;

  const subtreeWidth: Record<string, number> = {};
  function computeWidth(id: string): number {
    const ch = children[id] || [];
    if (ch.length === 0) { subtreeWidth[id] = nodeSpacing; return nodeSpacing; }
    let total = 0;
    for (const c of ch) total += computeWidth(c);
    total += (ch.length - 1) * (nodeSpacing * 0.3);
    subtreeWidth[id] = Math.max(nodeSpacing, total);
    return subtreeWidth[id];
  }
  computeWidth(root);

  function assignPositions(id: string, depth: number, crossCenter: number) {
    const main = depth * levelSpacing;
    if (horizontal) {
      graph.setNodeAttribute(id, "x", main);
      graph.setNodeAttribute(id, "y", crossCenter);
    } else {
      graph.setNodeAttribute(id, "x", crossCenter);
      graph.setNodeAttribute(id, "y", main);
    }
    const ch = children[id] || [];
    if (ch.length === 0) return;
    let totalChildWidth = 0;
    for (const c of ch) totalChildWidth += subtreeWidth[c];
    totalChildWidth += (ch.length - 1) * (nodeSpacing * 0.3);
    let cursor = crossCenter - totalChildWidth / 2;
    for (const c of ch) {
      const w = subtreeWidth[c];
      assignPositions(c, depth + 1, cursor + w / 2);
      cursor += w + nodeSpacing * 0.3;
    }
  }
  assignPositions(root, 0, 0);
}

interface Props {
  data: OrgGraphResponse;
  selectedNode: string | null;
  layout: LayoutType;
  edgeStyle: EdgeStyle;
  /** Node types to show. Empty means every type. */
  filters: Set<string>;
  searchResults: string[];
  onNodeSelect: (id: string | null) => void;
  onLayoutChange: (l: LayoutType) => void;
  onEdgeStyleChange: (e: EdgeStyle) => void;
  onRefresh?: () => void;
}

export default function OrgGraphCanvas({
  data,
  selectedNode,
  layout,
  edgeStyle,
  filters,
  searchResults,
  onNodeSelect,
  onLayoutChange,
  onEdgeStyleChange,
  onRefresh,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const stateRef = useRef({
    selectedNode,
    hoveredNode: null as string | null,
    neighbors: new Set<string>(),
    hoverNeighbors: new Set<string>(),
    filters,
    searchResults: new Set<string>(),
    searchConnected: new Set<string>(),
  });

  useEffect(() => {
    const graph = graphRef.current;
    const neighbors = new Set<string>();
    if (selectedNode && graph) {
      graph.forEachNeighbor(selectedNode, (n) => neighbors.add(n));
    }

    /* Whatever a search hit is attached to.
       
       The edge reducer keeps every edge that touches a match, so without this
       those edges ran out to nodes painted in the canvas colour — lines to
       nowhere. Searching a repository is a question about what it is connected
       to, so the answers have to be on screen. */
    const searchConnected = new Set<string>();
    if (graph && searchResults.length > 0) {
      for (const id of searchResults) {
        if (!graph.hasNode(id)) continue;
        graph.forEachNeighbor(id, (n) => searchConnected.add(n));
      }
    }

    stateRef.current = {
      ...stateRef.current,
      selectedNode,
      neighbors,
      filters,
      searchResults: new Set(searchResults),
      searchConnected,
    };
    sigmaRef.current?.refresh();
  }, [selectedNode, filters, searchResults]);

  /* Apply layout algorithm */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;

    let orgNode: string | null = null;
    graph.forEachNode((node, attrs) => { if (attrs.nodeType === "org") orgNode = node; });

    if (layout === "force") {
      forceAtlas2.assign(graph, {
        iterations: 300,
        settings: { gravity: 2, scalingRatio: 15, adjustSizes: true, barnesHutOptimize: true, strongGravityMode: true },
      });
    } else if (layout === "circular") {
      assignCircle(graph);
    } else if (layout === "radial") {
      assignRings(graph, orgNode);
    } else if (layout === "tree" || layout === "horizontal") {
      assignOrgTreeLayout(graph, layout === "horizontal");
    }

    /* Every layout ends here, including the ring ones. They are sized to fit
       their own members, but nothing stops a node on one ring from meeting a
       node on the next, and the tree layout spaces by depth rather than by how
       large its nodes are. Without depth cues on this canvas — no shadows, no
       layering — two shapes that touch read as one. */
    resolveOverlaps(graph);

    sigma.refresh();
    sigma.getCamera().animatedReset({ duration: 400 });
  }, [layout, data]);

  /* Switch edge style */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;

    const newType = edgeStyle === "curved" ? "curvedArrow" : "arrow";
    graph.forEachEdge((edge) => {
      graph.setEdgeAttribute(edge, "type", newType);
    });
    sigma.setSetting("defaultEdgeType", newType);
    sigma.refresh();
  }, [edgeStyle]);

  /* Build graph + sigma on data change */
  useEffect(() => {
    if (!containerRef.current || !data) return;
    let cancelled = false;
    const el = containerRef.current;

    if (el.offsetWidth === 0 || el.offsetHeight === 0) {
      const raf = requestAnimationFrame(() => { if (!cancelled) build(el); });
      return () => { cancelled = true; cancelAnimationFrame(raf); };
    }
    build(el);

    function build(container: HTMLDivElement) {
      if (cancelled) return;
      try {
        const graph = new Graph({ multi: true, type: "directed" });

        for (const node of data.nodes) {
          if (graph.hasNode(node.id)) continue;
          const isOrg = node.type === "org";
          const nodeAttrs: Record<string, unknown> = {
            label: isOrg ? "" : node.label,
            size: NODE_SIZE[node.type] ?? 10,
            /* Every kind takes its own colour, the workspace included. It used
               to be painted the canvas colour so the logo bitmap could sit on
               top of it; with the bitmap gone that left a near-black square. */
            color: ORG_NODE_COLORS[node.type] ?? token("--fg-n-600"),
            x: Math.random() * 100,
            y: Math.random() * 100,
            nodeType: node.type,
            zIndex: isOrg ? 10 : node.type === "repo" ? 5 : 1,
          };
          /* The workspace was the whole logo clipped to a disc, which cut the
             mark off at its own boundary. It is the mark's ember centre cell
             instead — the one displaced square everything else sits around,
             exactly as the repository is drawn in the package graph. */
          nodeAttrs.type = ORG_NODE_SHAPE[node.type] ?? "circle";
          graph.addNode(node.id, nodeAttrs);
        }

        let idx = 0;
        for (const edge of data.edges) {
          if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
          const isShared = edge.type === "shared_upstream";
          const isAccess = edge.type === "access";
          /* Drawn with an arrow and a wider curve: a connection is directional
             — this repo reaches into that one — and it runs between two repo
             nodes that already have an org_repo edge each, so it needs to bow
             clear of them to be seen at all. */
          const isConnected = edge.type === "repo_connected";
          graph.addEdgeWithKey(`e-${idx++}`, edge.source, edge.target, {
            size: isShared ? 3 : isConnected ? 2.5 : 1.5,
            color: EDGE_COLORS[edge.type] ?? "rgba(139, 156, 175,0.4)",
            type: isAccess ? "curvedDotted" : "curvedArrow",
            curvature: isShared ? 0.3 : isConnected ? 0.35 : 0.15,
            edgeKind: edge.type,
            label: edge.label,
          });
        }

        /* Initial placement, before the layout effect runs. Rings from the
           workspace outward, so the first paint is already readable rather
           than a circle that jumps a moment later. */
        let initialOrg: string | null = null;
        graph.forEachNode((node, attrs) => { if (attrs.nodeType === "org") initialOrg = node; });
        assignRings(graph, initialOrg);
        resolveOverlaps(graph);

        const sigma = new Sigma(graph, container, {
          allowInvalidContainer: true,
          renderEdgeLabels: true,
          enableEdgeEvents: true,
          defaultEdgeType: "curvedArrow",
          edgeProgramClasses: { curvedArrow: EdgeCurvedArrowProgram, dotted: EdgeDottedProgram, curvedDotted: EdgeCurvedDottedProgram },
          nodeProgramClasses: {
            tilted: NodeTiltedSquareProgram,
            square: NodeSquareProgram,
            hexagon: NodeHexagonProgram,
            triangle: NodeTriangleProgram,
          },
          labelDensity: 0.15,
          labelGridCellSize: 80,
          labelRenderedSizeThreshold: 5,
          // Resolved, not var(): sigma passes this straight to canvas ctx.font.
          labelFont: token("--fg-font-body"),
          labelColor: { color: token("--t-secondary") },
          defaultDrawNodeLabel: drawNodeLabel,
          labelSize: 13,
          stagePadding: 40,
          zIndex: true,
          defaultDrawNodeHover: drawDarkNodeHover,

          nodeReducer: (node, attrs) => {
            const st = stateRef.current;
            const res = { ...attrs };
            const nType = attrs.nodeType as string;
            const isOrg = nType === "org";

            /* Type filter: the org hub and the selected types, nothing else.
               This used to also show every neighbour of a match, which meant
               picking one type still drew 83 of 109 nodes — and made choosing
               two types identical to choosing one, since the first already
               dragged the second in. "Filter by type" now means what it
               says. */
            if (st.filters.size > 0 && !isOrg && !st.filters.has(nType)) {
              res.hidden = true;
              return res;
            }

            /* Search highlight */
            if (st.searchResults.size > 0) {
              if (st.searchResults.has(node)) {
                res.highlighted = true;
                res.zIndex = 10;
              } else if (st.searchConnected.has(node)) {
                /* What the match is attached to: dimmed so the match still
                   leads, but drawn in its own colour and keeping its label —
                   the point of the search was to find out what these are. */
                res.color = dimToCanvas(res.color as string, DIM.searchConnected);
                res.zIndex = 1;
              } else if (!isOrg) {
                res.color = token("--c-bg");
                res.size = Math.max(2, (attrs.size ?? 1) * 0.28);
                res.label = "";
                res.zIndex = -2;
              }
              return res;
            }

            /* --- Selection / hover: ghost everything that isn't relevant --- */
            if (st.hoveredNode === node) {
              res.highlighted = true;
              res.size = (attrs.size ?? 1) * 1.25;
              res.zIndex = 9;
            } else if (st.selectedNode) {
              if (node === st.selectedNode) {
                res.highlighted = true;
                res.zIndex = 10;
              } else if (st.neighbors.has(node)) {
                res.zIndex = 5;
              } else if (!isOrg) {
                res.color = token("--c-bg");
                res.size = Math.max(2, (attrs.size ?? 1) * 0.28);
                res.label = "";
                res.zIndex = -2;
              }
            } else if (st.hoveredNode) {
              if (!st.hoverNeighbors.has(node) && !isOrg) {
                res.color = token("--c-bg");
                res.size = Math.max(3, (attrs.size ?? 1) * 0.45);
                res.label = "";
                res.zIndex = -1;
              }
            }

            return res;
          },

          edgeReducer: (edge, attrs) => {
            const st = stateRef.current;
            const res = { ...attrs };
            const src = graph.source(edge);
            const tgt = graph.target(edge);
            const kind = graph.getEdgeAttribute(edge, "edgeKind") as string;

            /* Type filter */
            if (st.filters.size > 0) {
              const srcType = graph.getNodeAttribute(src, "nodeType") as string;
              const tgtType = graph.getNodeAttribute(tgt, "nodeType") as string;
              /* Both ends, not either: an edge to a node that is hidden has
                 nothing at the far end of it. */
              const srcMatch = srcType === "org" || st.filters.has(srcType);
              const tgtMatch = tgtType === "org" || st.filters.has(tgtType);
              if (!srcMatch || !tgtMatch) {
                res.hidden = true;
                return res;
              }
            }

            /* Search — hide edges not touching a match */
            if (st.searchResults.size > 0) {
              if (!st.searchResults.has(src) && !st.searchResults.has(tgt)) {
                res.hidden = true;
              }
              return res;
            }

            if (st.selectedNode) {
              if (src !== st.selectedNode && tgt !== st.selectedNode) {
                res.hidden = true;
              } else {
                res.size = (attrs.size ?? 1) * 2;
                res.color = EDGE_COLORS_BRIGHT[kind] ?? "rgba(182, 196, 211,0.90)";
              }
            } else if (st.hoveredNode) {
              if (src !== st.hoveredNode && tgt !== st.hoveredNode) {
                res.color = "rgba(18, 32, 46, 0.08)";
              }
            }

            return res;
          },
        });

        sigma.on("clickNode", ({ node }) => onNodeSelect(node));
        sigma.on("clickStage", () => onNodeSelect(null));
        sigma.on("enterNode", ({ node }) => {
          container.style.cursor = "pointer";
          const hoverNeighbors = new Set<string>();
          graph.forEachNeighbor(node, (n) => hoverNeighbors.add(n));
          stateRef.current = { ...stateRef.current, hoveredNode: node, hoverNeighbors };
          sigma.refresh();
        });
        sigma.on("leaveNode", () => {
          container.style.cursor = "default";
          stateRef.current = { ...stateRef.current, hoveredNode: null, hoverNeighbors: new Set() };
          sigma.refresh();
        });

        sigmaRef.current = sigma;
        graphRef.current = graph;
      } catch (err) {
        console.error("Org graph build failed:", err);
      }
    }

    return () => {
      cancelled = true;
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
        graphRef.current = null;
      }
    };
  }, [data]);

  return (
    <div className="graph-wrapper">
      <div ref={containerRef} className="graph-container" />
      <div className="graph-controls">
        <OrgLayoutPopout
          layout={layout}
          edgeStyle={edgeStyle}
          onLayoutChange={onLayoutChange}
          onEdgeStyleChange={onEdgeStyleChange}
        />
        <div className="graph-nav-cluster">
          <button className="graph-nav-btn" title="Pan up" onClick={() => { const c = sigmaRef.current?.getCamera(); if (c) c.animate({ y: c.y + 0.1 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <div className="graph-nav-row">
            <button className="graph-nav-btn" title="Pan left" onClick={() => { const c = sigmaRef.current?.getCamera(); if (c) c.animate({ x: c.x - 0.1 }, { duration: 200 }); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button className="graph-nav-btn" title="Pan right" onClick={() => { const c = sigmaRef.current?.getCamera(); if (c) c.animate({ x: c.x + 0.1 }, { duration: 200 }); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <button className="graph-nav-btn" title="Pan down" onClick={() => { const c = sigmaRef.current?.getCamera(); if (c) c.animate({ y: c.y - 0.1 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
        <div className="graph-zoom-cluster">
          <button className="graph-nav-btn" title="Zoom in" onClick={() => { const c = sigmaRef.current?.getCamera(); if (c) c.animate({ ratio: c.ratio / 1.3 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button className="graph-nav-btn" title="Zoom out" onClick={() => { const c = sigmaRef.current?.getCamera(); if (c) c.animate({ ratio: c.ratio * 1.3 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        <button
          className="graph-recenter-btn"
          onClick={() => {
            const sigma = sigmaRef.current;
            const graph = graphRef.current;
            if (!sigma || !graph) return;
            let orgNode: string | null = null;
            graph.forEachNode((node, attrs) => {
              if (attrs.nodeType === "org") orgNode = node;
            });
            /* animatedReset fits the graph's own bounding box, which leaves the
               workspace wherever the layout put it. Fit around it instead, so
               the thing every edge points at is also in the middle. */
            if (orgNode) fitAround(sigma, orgNode);
            else sigma.getCamera().animatedReset({ duration: 400 });
          }}
          title="Fit graph — centre on the workspace and show every node"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
        {onRefresh && (
          <button className="graph-refresh-btn" onClick={onRefresh} title="Refresh data">
            ↻
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Layout / Edge Style Floating Control
   ================================================================ */

const LAYOUTS: { key: LayoutType; icon: string; label: string }[] = [
  { key: "force", icon: "⚛", label: "Force" },
  { key: "circular", icon: "◎", label: "Circular" },
  { key: "radial", icon: "◉", label: "Radial" },
  { key: "tree", icon: "⏛", label: "Tree" },
  { key: "horizontal", icon: "⇥", label: "Horizontal" },
];

function OrgLayoutPopout({
  layout,
  edgeStyle,
  onLayoutChange,
  onEdgeStyleChange,
}: {
  layout: LayoutType;
  edgeStyle: EdgeStyle;
  onLayoutChange: (l: LayoutType) => void;
  onEdgeStyleChange: (e: EdgeStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = LAYOUTS.find((l) => l.key === layout);

  return (
    <div className="layout-popout">
      <button
        className="layout-popout-trigger"
        onClick={() => setOpen(!open)}
        title="Layout & Edge Style"
      >
        <span className="layout-popout-icon">{current?.icon ?? "⚛"}</span>
        <span className="layout-popout-label">{current?.label ?? "Layout"}</span>
        <span className={`layout-popout-chevron${open ? " open" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="layout-popout-menu">
          <div className="layout-popout-section">
            <span className="layout-popout-section-title">Layout</span>
            {LAYOUTS.map((l) => (
              <button
                key={l.key}
                className={`layout-popout-item${layout === l.key ? " active" : ""}`}
                onClick={() => { onLayoutChange(l.key); setOpen(false); }}
              >
                <span className="layout-popout-item-icon">{l.icon}</span>
                {l.label}
              </button>
            ))}
          </div>
          <div className="layout-popout-divider" />
          <div className="layout-popout-section">
            <span className="layout-popout-section-title">Edges</span>
            <button
              className={`layout-popout-item${edgeStyle === "curved" ? " active" : ""}`}
              onClick={() => { onEdgeStyleChange("curved"); setOpen(false); }}
            >
              <span className="layout-popout-item-icon">∿</span>
              Curved
            </button>
            <button
              className={`layout-popout-item${edgeStyle === "straight" ? " active" : ""}`}
              onClick={() => { onEdgeStyleChange("straight"); setOpen(false); }}
            >
              <span className="layout-popout-item-icon">—</span>
              Straight
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
