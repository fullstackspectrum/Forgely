import { useEffect, useRef } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { circular } from "graphology-layout";
import type { GraphResponse, FilterType, LayoutType, EdgeStyle, NodeData } from "../types";
import { SEVERITY_COLORS } from "../types";

/* Load curved-edge program; resolved before first render via the promise. */
let CurvedEdgeProgram: any = null;
let NodeImageProgram: any = null;
const depsReady = Promise.all([
  import("@sigma/edge-curve")
    .then((m) => {
      CurvedEdgeProgram = m.EdgeCurvedArrowProgram;
    })
    .catch(() => {}),
  import("@sigma/node-image")
    .then((m) => {
      NodeImageProgram = m.NodeImageProgram;
    })
    .catch(() => {}),
]);

/**
 * BFS-based hierarchical layout.
 * Places the repo node at root, packages at depth 1, dependencies at depth 2+.
 * @param horizontal – if true, tree grows left-to-right; otherwise top-to-bottom.
 */
function assignTreeLayout(graph: Graph, horizontal: boolean) {
  const visited = new Set<string>();
  const levels: string[][] = [];

  /* Find root (repo node) or fall back to first node */
  let root: string | null = null;
  graph.forEachNode((node, attrs) => {
    if (attrs.nodeType === "repo") root = node;
  });
  if (!root) {
    root = graph.nodes()[0];
    if (!root) return;
  }

  /* BFS to assign depths */
  const queue: { id: string; depth: number }[] = [{ id: root, depth: 0 }];
  visited.add(root);
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (!levels[depth]) levels[depth] = [];
    levels[depth].push(id);
    graph.forEachOutNeighbor(id, (neighbor) => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    });
  }

  /* Place any disconnected nodes at the deepest level */
  graph.forEachNode((node) => {
    if (!visited.has(node)) {
      const d = levels.length;
      if (!levels[d]) levels[d] = [];
      levels[d].push(node);
    }
  });

  /* Assign coordinates */
  const levelSpacing = 120;
  for (let d = 0; d < levels.length; d++) {
    const nodes = levels[d];
    const span = nodes.length * 60;
    for (let i = 0; i < nodes.length; i++) {
      const cross = -span / 2 + i * 60;
      const main = d * levelSpacing;
      if (horizontal) {
        graph.setNodeAttribute(nodes[i], "x", main);
        graph.setNodeAttribute(nodes[i], "y", cross);
      } else {
        graph.setNodeAttribute(nodes[i], "x", cross);
        graph.setNodeAttribute(nodes[i], "y", main);
      }
    }
  }
}

interface Props {
  data: GraphResponse;
  selectedNode: string | null;
  hoveredNode: string | null;
  filter: FilterType;
  layout: LayoutType;
  edgeStyle: EdgeStyle;
  searchResults: string[];
  onNodeSelect: (id: string | null) => void;
  onNodeHover: (id: string | null) => void;
}

export default function GraphCanvas({
  data,
  selectedNode,
  hoveredNode,
  filter,
  layout,
  edgeStyle,
  searchResults,
  onNodeSelect,
  onNodeHover,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);

  /* Mutable ref for state that reducers read */
  const stateRef = useRef({
    selectedNode,
    hoveredNode,
    filter,
    searchResults,
    neighbors: new Set<string>(),
    nodeData: {} as Record<string, NodeData>,
  });

  /* Keep the ref in sync and tell sigma to re-render */
  useEffect(() => {
    const neighbors = new Set<string>();
    if (selectedNode && graphRef.current) {
      graphRef.current.forEachNeighbor(selectedNode, (n) => neighbors.add(n));
    }
    stateRef.current = {
      ...stateRef.current,
      selectedNode,
      hoveredNode,
      filter,
      searchResults,
      neighbors,
    };
    sigmaRef.current?.refresh();
  }, [selectedNode, hoveredNode, filter, searchResults]);

  /* Apply layout algorithm */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;

    if (layout === "force") {
      forceAtlas2.assign(graph, {
        iterations: 200,
        settings: {
          gravity: 1,
          scalingRatio: 10,
          barnesHutOptimize: true,
          strongGravityMode: true,
        },
      });
    } else if (layout === "circular") {
      circular.assign(graph);
    } else if (layout === "radial") {
      /* Place repo node at center, packages in ring, deps in outer ring */
      circular.assign(graph);
      graph.forEachNode((node, attrs) => {
        if (attrs.nodeType === "repo") {
          graph.setNodeAttribute(node, "x", 0);
          graph.setNodeAttribute(node, "y", 0);
        }
      });
    } else if (layout === "tree" || layout === "horizontal") {
      assignTreeLayout(graph, layout === "horizontal");
    }

    sigma.refresh();
    sigma.getCamera().animatedReset({ duration: 400 });
  }, [layout, data]);

  /* Switch edge style (curved ↔ straight) */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;

    const newType =
      edgeStyle === "curved" && CurvedEdgeProgram ? "curvedArrow" : "arrow";
    graph.forEachEdge((edge) => {
      graph.setEdgeAttribute(edge, "type", newType);
    });
    sigma.setSetting(
      "defaultEdgeType",
      newType,
    );
    sigma.refresh();
  }, [edgeStyle]);

  /* Build graph + sigma on data change */
  useEffect(() => {
    if (!containerRef.current || !data) return;

    let cancelled = false;
    const container = containerRef.current;

    depsReady.then(() => {
      if (cancelled || !container) return;
      buildSigma(container);
    });

    function buildSigma(el: HTMLDivElement) {

    const graph = new Graph({ multi: true, type: "directed" });
    const nodeData: Record<string, NodeData> = {};

    /* --- Add nodes --- */
    for (const node of data.nodes) {
      const sev = node.data.max_severity || "None";
      const sevColor =
        SEVERITY_COLORS[sev] || (node.type === "repo" ? "#4a90d9" : "#666666");

      const size =
        node.type === "repo"
          ? 24
          : node.type === "dependency"
            ? 6
            : Math.max(10, Math.min(30, 10 + (node.data.downloads || 0) / 200));

      graph.addNode(node.id, {
        label: node.label,
        size,
        color:
          node.type === "repo"
            ? "#4a90d9"
            : node.type === "dependency"
              ? "#555"
              : sevColor,
        x: Math.random() * 100,
        y: Math.random() * 100,
        nodeType: node.type,
        severity: sev,
        vulnCount: node.data.vuln_count,
        ...(node.type === "repo" && NodeImageProgram
          ? { type: "image", image: "/cloudsmith.png" }
          : {}),
      });
      nodeData[node.id] = node.data;
    }

    /* --- Add edges --- */
    const useCurved = edgeStyle === "curved" && !!CurvedEdgeProgram;
    let edgeIdx = 0;
    for (const edge of data.edges) {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      const isSharedCve = edge.type === "shared_cve";
      const isDep = edge.type === "dependency";
      graph.addEdgeWithKey(`e-${edgeIdx++}`, edge.source, edge.target, {
        size: isSharedCve ? 2.5 : isDep ? 0.8 : 1.2,
        color: isSharedCve ? "rgba(255,77,77,0.6)" : isDep ? "#333" : "#555",
        type: useCurved ? "curvedArrow" : "arrow",
        curvature: isSharedCve ? 0.35 : isDep ? 0.2 : 0.15,
        edgeKind: edge.type,
        label: edge.label,
      });
    }

    /* --- Layout --- */
    forceAtlas2.assign(graph, {
      iterations: 200,
      settings: {
        gravity: 1,
        scalingRatio: 10,
        barnesHutOptimize: true,
        strongGravityMode: true,
      },
    });

    stateRef.current.nodeData = nodeData;

    /* --- Sigma --- */
    const edgeProgClasses: Record<string, any> = {};
    if (CurvedEdgeProgram) {
      edgeProgClasses.curvedArrow = CurvedEdgeProgram;
    }
    const nodeProgClasses: Record<string, any> = {};
    if (NodeImageProgram) {
      nodeProgClasses.image = NodeImageProgram;
    }

    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      enableEdgeEvents: true,
      defaultEdgeType: useCurved ? "curvedArrow" : "arrow",
      edgeProgramClasses: edgeProgClasses,
      nodeProgramClasses: nodeProgClasses,
      labelDensity: 0.12,
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

        /* --- Filtering --- */
        if (st.filter !== "all" && attrs.nodeType !== "repo") {
          const vc = (attrs as any).vulnCount ?? 0;
          const sev = (attrs as any).severity ?? "None";
          let show = true;
          if (st.filter === "vulnerable") show = vc > 0;
          else if (st.filter === "safe") show = vc === 0;
          else show = sev === st.filter;
          if (!show) {
            res.hidden = true;
            return res;
          }
        }

        /* --- Search highlighting --- */
        if (st.searchResults.length > 0) {
          if (st.searchResults.includes(node)) {
            res.highlighted = true;
            res.zIndex = 1;
          } else {
            res.color = "#1a1a2e";
            res.label = "";
          }
          return res;
        }

        /* --- Selection / hover --- */
        if (st.selectedNode) {
          if (node === st.selectedNode) {
            res.highlighted = true;
            res.zIndex = 1;
          } else if (st.neighbors.has(node)) {
            /* keep visible */
          } else {
            res.color = "#1a1a2e";
            res.label = "";
          }
        }
        if (st.hoveredNode === node) {
          res.highlighted = true;
          res.size = attrs.size * 1.25;
          res.zIndex = 2;
        }
        return res;
      },

      edgeReducer: (edge, attrs) => {
        const st = stateRef.current;
        const res = { ...attrs };

        if (st.selectedNode) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src !== st.selectedNode && tgt !== st.selectedNode) {
            res.hidden = true;
          } else {
            res.size = (attrs.size ?? 1) * 1.5;
          }
        }

        if (st.hoveredNode) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src !== st.hoveredNode && tgt !== st.hoveredNode) {
            if (!st.selectedNode) {
              res.color = "rgba(50,50,50,0.15)";
            }
          }
        }

        return res;
      },
    });

    /* Events */
    sigma.on("clickNode", ({ node }) => onNodeSelect(node));
    sigma.on("enterNode", ({ node }) => {
      onNodeHover(node);
      containerRef.current!.style.cursor = "pointer";
    });
    sigma.on("leaveNode", () => {
      onNodeHover(null);
      containerRef.current!.style.cursor = "default";
    });
    sigma.on("clickStage", () => onNodeSelect(null));

    sigmaRef.current = sigma;
    graphRef.current = graph;

    } /* end buildSigma */

    return () => {
      cancelled = true;
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
        graphRef.current = null;
      }
    };
  }, [data]);

  return <div ref={containerRef} className="graph-container" />;
}
