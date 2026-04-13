import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { circular } from "graphology-layout";
import { EdgeCurvedArrowProgram } from "@sigma/edge-curve";
import { NodeImageProgram } from "@sigma/node-image";
import { NodeSquareProgram } from "@sigma/node-square";
import { NodeTriangleProgram } from "../programs/NodeTriangleProgram";
import type { OrgGraphResponse, LayoutType, EdgeStyle, OrgNodeFilter } from "../types";
import { ORG_NODE_COLORS } from "../types";

const NODE_SIZE: Record<string, number> = {
  org: 28,
  repo: 14,
  user: 12,
  service: 12,
  team: 10,
  entitlement: 8,
  upstream: 10,
};

const EDGE_COLORS: Record<string, string> = {
  org_repo: "rgba(40,167,69,0.5)",
  member_org: "rgba(255,140,26,0.5)",
  service_org: "rgba(167,109,255,0.5)",
  access: "rgba(74,144,217,0.6)",
  entitlement_repo: "rgba(255,209,26,0.4)",
  repo_upstream: "rgba(0,188,212,0.5)",
  shared_upstream: "rgba(255,87,34,0.7)",
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
  filter: OrgNodeFilter;
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
  filter,
  onNodeSelect,
  onLayoutChange,
  onEdgeStyleChange,
  onRefresh,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const stateRef = useRef({ selectedNode, neighbors: new Set<string>(), filter, filterConnected: new Set<string>() });

  useEffect(() => {
    const graph = graphRef.current;
    const neighbors = new Set<string>();
    if (selectedNode && graph) {
      graph.forEachNeighbor(selectedNode, (n) => neighbors.add(n));
    }
    /* Build set of nodes connected to any node matching the current filter */
    const filterConnected = new Set<string>();
    if (filter !== "all" && graph) {
      graph.forEachNode((node, attrs) => {
        if (attrs.nodeType === filter) {
          graph.forEachNeighbor(node, (n) => filterConnected.add(n));
        }
      });
    }
    stateRef.current = { selectedNode, neighbors, filter, filterConnected };
    sigmaRef.current?.refresh();
  }, [selectedNode, filter]);

  /* Apply layout algorithm */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;

    if (layout === "force") {
      forceAtlas2.assign(graph, {
        iterations: 300,
        settings: { gravity: 2, scalingRatio: 15, barnesHutOptimize: true, strongGravityMode: true },
      });
    } else if (layout === "circular") {
      circular.assign(graph);
    } else if (layout === "radial") {
      circular.assign(graph);
      graph.forEachNode((node, attrs) => {
        if (attrs.nodeType === "org") {
          graph.setNodeAttribute(node, "x", 0);
          graph.setNodeAttribute(node, "y", 0);
        }
      });
    } else if (layout === "tree" || layout === "horizontal") {
      assignOrgTreeLayout(graph, layout === "horizontal");
    }

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
            color: isOrg ? "#000000" : (ORG_NODE_COLORS[node.type] ?? "#666"),
            x: Math.random() * 100,
            y: Math.random() * 100,
            nodeType: node.type,
            zIndex: isOrg ? 10 : node.type === "repo" ? 5 : 1,
          };
          if (isOrg) {
            nodeAttrs.type = "image";
            nodeAttrs.image = "/cloudsmith.png";
          } else if (node.type === "repo") {
            nodeAttrs.type = "square";
          } else if (node.type === "upstream") {
            nodeAttrs.type = "triangle";
          }
          graph.addNode(node.id, nodeAttrs);
        }

        let idx = 0;
        for (const edge of data.edges) {
          if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
          const isShared = edge.type === "shared_upstream";
          graph.addEdgeWithKey(`e-${idx++}`, edge.source, edge.target, {
            size: isShared ? 3 : edge.type === "access" ? 2 : 1.5,
            color: EDGE_COLORS[edge.type] ?? "rgba(100,100,100,0.4)",
            type: "curvedArrow",
            curvature: isShared ? 0.3 : 0.15,
            edgeKind: edge.type,
            label: edge.label,
          });
        }

        forceAtlas2.assign(graph, {
          iterations: 300,
          settings: { gravity: 2, scalingRatio: 15, barnesHutOptimize: true, strongGravityMode: true },
        });

        const sigma = new Sigma(graph, container, {
          allowInvalidContainer: true,
          renderEdgeLabels: true,
          enableEdgeEvents: true,
          defaultEdgeType: "curvedArrow",
          edgeProgramClasses: { curvedArrow: EdgeCurvedArrowProgram },
          nodeProgramClasses: { image: NodeImageProgram, square: NodeSquareProgram, triangle: NodeTriangleProgram },
          labelDensity: 0.15,
          labelGridCellSize: 80,
          labelRenderedSizeThreshold: 5,
          labelFont: "Inter, system-ui, sans-serif",
          labelColor: { color: "#ddd" },
          labelSize: 12,
          stagePadding: 40,
          zIndex: true,

          nodeReducer: (node, attrs) => {
            const st = stateRef.current;
            const res = { ...attrs };
            const nType = attrs.nodeType as string;

            /* Type filter: show org, matching type, and connected neighbors */
            if (st.filter !== "all" && nType !== "org" && nType !== st.filter) {
              if (st.filterConnected.has(node)) {
                /* Connected to a filtered node — show but dimmed */
                res.color = res.color ?? "#666";
                res.zIndex = 0;
              } else {
                res.hidden = true;
                return res;
              }
            }

            if (st.selectedNode) {
              if (node === st.selectedNode) {
                res.highlighted = true;
                res.zIndex = 10;
              } else if (st.neighbors.has(node)) {
                /* keep visible */
              } else {
                res.color = "#1a1a2e";
                res.label = "";
              }
            }
            return res;
          },

          edgeReducer: (edge, attrs) => {
            const st = stateRef.current;
            const res = { ...attrs };
            const src = graph.source(edge);
            const tgt = graph.target(edge);

            /* Show edges where at least one endpoint matches the filter */
            if (st.filter !== "all") {
              const srcType = graph.getNodeAttribute(src, "nodeType") as string;
              const tgtType = graph.getNodeAttribute(tgt, "nodeType") as string;
              const srcMatch = srcType === "org" || srcType === st.filter;
              const tgtMatch = tgtType === "org" || tgtType === st.filter;
              if (!srcMatch && !tgtMatch) {
                res.hidden = true;
                return res;
              }
            }

            if (st.selectedNode) {
              if (src !== st.selectedNode && tgt !== st.selectedNode) {
                res.hidden = true;
              } else {
                res.size = (attrs.size ?? 1) * 1.5;
              }
            }
            return res;
          },
        });

        sigma.on("clickNode", ({ node }) => onNodeSelect(node));
        sigma.on("clickStage", () => onNodeSelect(null));
        sigma.on("enterNode", () => { container.style.cursor = "pointer"; });
        sigma.on("leaveNode", () => { container.style.cursor = "default"; });

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
        <button
          className="graph-recenter-btn"
          onClick={() => {
            const sigma = sigmaRef.current;
            if (sigma) sigma.getCamera().animatedReset({ duration: 400 });
          }}
          title="Recenter"
        >
          ⊙
        </button>
        {onRefresh && (
          <button className="graph-refresh-btn" onClick={onRefresh} title="Refresh Data">
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
