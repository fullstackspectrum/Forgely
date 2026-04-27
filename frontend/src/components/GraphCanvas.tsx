import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { circular } from "graphology-layout";
import { EdgeCurvedArrowProgram } from "@sigma/edge-curve";
import { NodeImageProgram } from "@sigma/node-image";
import { NodeSquareProgram } from "@sigma/node-square";
import { NodeHexagonProgram } from "../programs/NodeHexagonProgram";
import { NodeRingProgram } from "../programs/NodeRingProgram";
import EdgeDottedProgram from "../programs/EdgeDottedProgram";
import { drawDarkNodeHover, drawNodeLabel, drawLockBadge } from "../lib/hoverRenderer";
import type { GraphResponse, FilterType, LayoutType, EdgeStyle, NodeData } from "../types";
import { SEVERITY_COLORS } from "../types";

/** Map Cloudsmith package format → Devicon SVG URL (jsDelivr CDN).
 *  Using .svg URLs so @sigma/node-image detects them as SVGs and
 *  uses the dedicated SVG→bitmap loading path for best rendering. */
const DI = "https://raw.githubusercontent.com/devicons/devicon/v2.17.0/icons";
const FORMAT_ICONS: Record<string, string> = {
  docker:    `${DI}/docker/docker-original.svg`,
  npm:       `${DI}/npm/npm-original-wordmark.svg`,
  python:    `${DI}/python/python-original.svg`,
  nuget:     `${DI}/nuget/nuget-original.svg`,
  ruby:      `${DI}/ruby/ruby-original.svg`,
  go:        `${DI}/go/go-original.svg`,
  cargo:     `${DI}/rust/rust-line.svg`,
  helm:      `${DI}/helm/helm-original.svg`,
  deb:       `${DI}/debian/debian-original.svg`,
  debian:    `${DI}/debian/debian-original.svg`,
  rpm:       `${DI}/redhat/redhat-original.svg`,
  composer:  `${DI}/composer/composer-line.svg`,
  swift:     `${DI}/swift/swift-original.svg`,
  dart:      `${DI}/dart/dart-original.svg`,
  terraform: `${DI}/terraform/terraform-original.svg`,
  cran:      `${DI}/r/r-original.svg`,
  conan:     `${DI}/cplusplus/cplusplus-original.svg`,
  hex:       `${DI}/elixir/elixir-original.svg`,
  luarocks:  `${DI}/lua/lua-original.svg`,
};

function getFormatIcon(format: string): string | null {
  return FORMAT_ICONS[format.toLowerCase()] ?? null;
}

/**
 * BFS-based hierarchical layout with adaptive spacing.
 * Places the repo node at root, packages at depth 1, dependencies at depth 2+.
 * Subtrees are sized proportionally so sibling groups don't overlap.
 * @param horizontal – if true, tree grows left-to-right; otherwise top-to-bottom.
 */
function assignTreeLayout(graph: Graph, horizontal: boolean) {
  const visited = new Set<string>();
  const children: Record<string, string[]> = {};
  const depthOf: Record<string, number> = {};

  /* Find root (repo node) or fall back to first node */
  let root: string | null = null;
  graph.forEachNode((node, attrs) => {
    if (attrs.nodeType === "repo") root = node;
  });
  if (!root) {
    root = graph.nodes()[0];
    if (!root) return;
  }

  /* BFS to build a tree structure */
  const queue: string[] = [root];
  visited.add(root);
  depthOf[root] = 0;
  children[root] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    graph.forEachOutNeighbor(id, (neighbor) => {
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

  /* Also check in-neighbors for undirected-style traversal */
  const bfsQueue2: string[] = [...visited];
  for (const id of bfsQueue2) {
    graph.forEachNeighbor(id, (neighbor) => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        depthOf[neighbor] = depthOf[id] + 1;
        children[neighbor] = [];
        if (!children[id]) children[id] = [];
        children[id].push(neighbor);
      }
    });
  }

  /* Place any fully disconnected nodes under root */
  graph.forEachNode((node) => {
    if (!visited.has(node)) {
      visited.add(node);
      depthOf[node] = 1;
      children[node] = [];
      children[root!].push(node);
    }
  });

  /* Adaptive spacing based on graph size */
  const totalNodes = graph.order;
  const nodeSpacing = totalNodes > 300 ? 20 : totalNodes > 100 ? 35 : 50;
  const levelSpacing = totalNodes > 300 ? 180 : totalNodes > 100 ? 200 : 250;

  /* Compute the width (in cross-axis units) each subtree needs */
  const subtreeWidth: Record<string, number> = {};
  function computeWidth(id: string): number {
    const ch = children[id] || [];
    if (ch.length === 0) {
      subtreeWidth[id] = nodeSpacing;
      return nodeSpacing;
    }
    let total = 0;
    for (const c of ch) {
      total += computeWidth(c);
    }
    /* Add a small gap between child subtrees */
    total += (ch.length - 1) * (nodeSpacing * 0.3);
    subtreeWidth[id] = Math.max(nodeSpacing, total);
    return subtreeWidth[id];
  }
  computeWidth(root);

  /* Assign positions by walking the tree top-down */
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

    /* Total width needed by children */
    let totalChildWidth = 0;
    for (const c of ch) totalChildWidth += subtreeWidth[c];
    totalChildWidth += (ch.length - 1) * (nodeSpacing * 0.3);

    /* Lay out children centered under the parent */
    let cursor = crossCenter - totalChildWidth / 2;
    for (const c of ch) {
      const w = subtreeWidth[c];
      assignPositions(c, depth + 1, cursor + w / 2);
      cursor += w + nodeSpacing * 0.3;
    }
  }
  assignPositions(root, 0, 0);
}

/** ForceAtlas2 with size-aware repulsion for a well-spaced organic layout. */
function applyForceLayout(graph: Graph) {
  // Spread nodes randomly across a wide area so FA2 starts untangled
  const spread = Math.max(200, graph.order * 15);
  graph.forEachNode((id) => {
    graph.setNodeAttribute(id, "x", (Math.random() - 0.5) * spread);
    graph.setNodeAttribute(id, "y", (Math.random() - 0.5) * spread);
  });

  forceAtlas2.assign(graph, {
    iterations: 400,
    settings: {
      gravity: 0.05,
      scalingRatio: 12,
      adjustSizes: true,
      barnesHutOptimize: graph.order > 100,
      strongGravityMode: false,
      slowDown: 1 + Math.log(graph.order + 1),
    },
  });
}

interface Props {
  data: GraphResponse;
  selectedNode: string | null;
  hoveredNode: string | null;
  filter: FilterType;
  formatFilter?: string | null;
  layout: LayoutType;
  edgeStyle: EdgeStyle;
  searchResults: string[];
  hideSharedCveEdges?: boolean;
  hideDependencies?: boolean;
  hideUnsupported?: boolean;
  onNodeSelect: (id: string | null) => void;
  onNodeHover: (id: string | null) => void;
  onRefresh?: () => void;
  onLayoutChange?: (l: LayoutType) => void;
  onEdgeStyleChange?: (e: EdgeStyle) => void;
}

export default function GraphCanvas({
  data,
  selectedNode,
  hoveredNode,
  filter,
  formatFilter = null,
  layout,
  edgeStyle,
  searchResults,
  hideSharedCveEdges = false,
  hideDependencies = false,
  hideUnsupported = false,
  onNodeSelect,
  onNodeHover,
  onRefresh,
  onLayoutChange,
  onEdgeStyleChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);

  /* Mutable ref for state that reducers read */
  const stateRef = useRef({
    selectedNode,
    hoveredNode,
    filter,
    formatFilter,
    searchResults,
    hideSharedCveEdges,
    hideUnsupported,
    neighbors: new Set<string>(),
    hoverNeighbors: new Set<string>(),
    searchConnected: new Set<string>(),
    sharedCveNodes: new Set<string>(),
    hasDepNodes: new Set<string>(),
    quarantinedDeps: new Set<string>(),
    nodeData: {} as Record<string, NodeData>,
    pulsePhase: 0,
  });

  /* Keep the ref in sync and tell sigma to re-render */
  useEffect(() => {
    const neighbors = new Set<string>();
    if (selectedNode && graphRef.current) {
      graphRef.current.forEachNeighbor(selectedNode, (n) => neighbors.add(n));
    }

    const hoverNeighbors = new Set<string>();
    if (hoveredNode && graphRef.current) {
      graphRef.current.forEachNeighbor(hoveredNode, (n) => hoverNeighbors.add(n));
    }

    /* Nodes connected to search results via shared_cve or dependency edges */
    const searchConnected = new Set<string>();
    if (searchResults.length > 0 && graphRef.current) {
      const g = graphRef.current;
      for (const nodeId of searchResults) {
        if (!g.hasNode(nodeId)) continue;
        g.forEachEdge(nodeId, (_edge, attrs, source, target) => {
          const kind = attrs.edgeKind;
          if (kind === "shared_cve" || kind === "dependency") {
            const other = source === nodeId ? target : source;
            if (!searchResults.includes(other)) {
              searchConnected.add(other);
            }
          }
        });
      }
    }

    /* Nodes connected by shared_cve edges */
    const sharedCveNodes = new Set<string>();
    /* Nodes that are sources of dependency edges */
    const hasDepNodes = new Set<string>();
    /* Dependency neighbours of quarantined packages */
    const quarantinedDeps = new Set<string>();
    if (graphRef.current) {
      const g = graphRef.current;
      g.forEachEdge((_edge, attrs, source, target) => {
        if (attrs.edgeKind === "shared_cve") {
          sharedCveNodes.add(source);
          sharedCveNodes.add(target);
        }
        if (attrs.edgeKind === "dependency") {
          hasDepNodes.add(source);
        }
      });
      g.forEachNode((nodeId, attrs) => {
        if (!attrs.is_quarantined) return;
        g.forEachNeighbor(nodeId, (neighborId) => quarantinedDeps.add(neighborId));
      });
    }

    stateRef.current = {
      ...stateRef.current,
      selectedNode,
      hoveredNode,
      filter,
      formatFilter,
      searchResults,
      hideSharedCveEdges,
      hideDependencies,
      hideUnsupported,
      neighbors,
      hoverNeighbors,
      searchConnected,
      sharedCveNodes,
      hasDepNodes,
      quarantinedDeps,
    };
    sigmaRef.current?.refresh();
  }, [selectedNode, hoveredNode, filter, formatFilter, searchResults, hideSharedCveEdges, hideDependencies, hideUnsupported]);

  /* Apply layout algorithm */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;

    if (layout === "force") {
      applyForceLayout(graph);
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
      edgeStyle === "curved" ? "curvedArrow" : "arrow";
    graph.forEachEdge((edge) => {
      const kind = graph.getEdgeAttribute(edge, "edgeKind");
      if (kind === "dependency" || kind === "shared_cve") return;
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

    /* Wait for container to have dimensions before initializing sigma */
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      const raf = requestAnimationFrame(() => {
        if (!cancelled) buildSigma(container);
      });
      return () => { cancelled = true; cancelAnimationFrame(raf); };
    }

    buildSigma(container);

    function buildSigma(el: HTMLDivElement) {
      if (cancelled) return;

    try {

    const graph = new Graph({ multi: true, type: "directed" });
    const nodeData: Record<string, NodeData> = {};

    /* --- Add nodes --- */
    for (const node of data.nodes) {
      if (graph.hasNode(node.id)) continue;  // skip duplicates
      const sev = node.data.max_severity ?? "Unknown";
      const sevColor =
        SEVERITY_COLORS[sev] || (node.data.vuln_count === 0 && node.type === "package" ? "#28a745" : "#ffffff");

      const size =
        node.type === "repo"
          ? 48
          : node.type === "dependency"
            ? 6
            : Math.max(16, Math.min(40, 16 + (node.data.downloads || 0) / 200));

      /* Resolve icon for this node */
      let nodeImage: string | null = null;
      if (node.type === "repo") {
        nodeImage = "/cloudsmith.png";
      } else {
        nodeImage = getFormatIcon(node.data.format);
      }

      graph.addNode(node.id, {
        label: node.type === "repo" ? "" : node.label,
        size,
        color:
          node.type === "repo"
            ? "#000000"
            : node.type === "dependency"
              ? "#9b59b6"
              : sevColor,
        x: 0,
        y: 0,
        nodeType: node.type,
        severity: sev,
        vulnCount: node.data.vuln_count,
        format: (node.data.format || "").toLowerCase(),
        is_quarantined: node.data.is_quarantined ?? false,
        ...(node.type === "dependency"
          ? { type: "hexagon" }
          : nodeImage
            ? { type: "image", image: nodeImage }
            : {}),
      });
      nodeData[node.id] = node.data;
    }

    /* --- Add edges --- */
    const useCurved = edgeStyle === "curved";
    let edgeIdx = 0;
    for (const edge of data.edges) {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      const isSharedCve = edge.type === "shared_cve";
      const isDep = edge.type === "dependency";
      graph.addEdgeWithKey(`e-${edgeIdx++}`, edge.source, edge.target, {
        size: isSharedCve ? 2.5 : isDep ? 0.4 : 2,
        color: isSharedCve ? "rgba(255,77,77,0.6)" : isDep ? "rgba(120,70,160,0.6)" : "rgba(70,130,210,0.6)",
        type: isSharedCve ? "dotted" : isDep ? "dotted" : (useCurved ? "curvedArrow" : "arrow"),
        curvature: isSharedCve ? 0.35 : isDep ? 0.2 : 0.15,
        edgeKind: edge.type,
        label: edge.label,
      });
    }

    /* --- Layout --- */
    applyForceLayout(graph);

    /* --- Add echo ring nodes for Critical packages (2 staggered rings each) --- */
    const RING_COUNT = 2;
    const criticalNodes: Array<{ id: string; size: number }> = [];
    graph.forEachNode((nid, attrs) => {
      if (attrs.nodeType === "package" && attrs.severity === "Critical") {
        criticalNodes.push({ id: nid, size: attrs.size });
      }
    });
    for (const cn of criticalNodes) {
      const x = graph.getNodeAttribute(cn.id, "x");
      const y = graph.getNodeAttribute(cn.id, "y");
      for (let i = 0; i < RING_COUNT; i++) {
        graph.addNode(`echo:${cn.id}:${i}`, {
          x, y,
          size: cn.size,
          baseSize: cn.size,
          phaseOffset: i / RING_COUNT,
          color: "rgba(255,77,77,0)",
          nodeType: "echo",
          type: "ring",
          parentId: cn.id,
          label: "",
          zIndex: -1,
        });
      }
    }

    stateRef.current.nodeData = nodeData;

    /* --- Sigma --- */
    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      enableEdgeEvents: true,
      defaultEdgeType: useCurved ? "curvedArrow" : "arrow",
      edgeProgramClasses: { curvedArrow: EdgeCurvedArrowProgram, dotted: EdgeDottedProgram },
      nodeProgramClasses: { image: NodeImageProgram, square: NodeSquareProgram, hexagon: NodeHexagonProgram, ring: NodeRingProgram },
      labelDensity: 0.12,
      labelGridCellSize: 80,
      labelRenderedSizeThreshold: 5,
      labelFont: "Geist, system-ui, sans-serif",
      labelColor: { color: "#ddd" },
      labelSize: 13,
      stagePadding: 40,
      zIndex: true,
      defaultDrawNodeHover: drawDarkNodeHover,
      defaultDrawNodeLabel: drawNodeLabel,

      nodeReducer: (node, attrs) => {
        const st = stateRef.current;
        const res = { ...attrs };

        /* --- Echo ring around Critical nodes --- */
        if (attrs.nodeType === "echo") {
          const parentId = (attrs as any).parentId as string;
          if (!graph.hasNode(parentId)) {
            res.hidden = true;
            return res;
          }
          // Hide ring when filtering excludes Critical nodes
          if (st.filter !== "all" && st.filter !== "vulnerable" && st.filter !== "Critical" && st.filter !== "shared_cve" && st.filter !== "has_deps" && st.filter !== "quarantined") {
            res.hidden = true;
            return res;
          }
          if (st.filter === "shared_cve" && !st.sharedCveNodes.has(parentId)) {
            res.hidden = true;
            return res;
          }
          if (st.filter === "has_deps" && !st.hasDepNodes.has(parentId)) {
            res.hidden = true;
            return res;
          }
          // Hide ring when quarantined filter excludes parent
          if (st.filter === "quarantined" && !graph.getNodeAttribute(parentId, "is_quarantined") && !st.quarantinedDeps.has(parentId)) {
            res.hidden = true;
            return res;
          }
          // Hide ring when format filter excludes parent
          if (st.formatFilter && graph.getNodeAttribute(parentId, "format") !== st.formatFilter) {
            res.hidden = true;
            return res;
          }
          // Hide ring during search if parent isn't visible
          if (st.searchResults.length > 0 && !st.searchResults.includes(parentId) && !st.searchConnected.has(parentId)) {
            res.hidden = true;
            return res;
          }
          // Hide ring when a node is selected and the parent is not relevant
          if (st.selectedNode && parentId !== st.selectedNode && !st.neighbors.has(parentId)) {
            res.hidden = true;
            return res;
          }
          // Hide ring when hovering dims the parent
          if (st.hoveredNode && !st.selectedNode && parentId !== st.hoveredNode && !st.hoverNeighbors.has(parentId)) {
            res.hidden = true;
            return res;
          }
          const phase = (st.pulsePhase / (2 * Math.PI) + (attrs as any).phaseOffset) % 1;
          const baseSize = (attrs as any).baseSize as number;
          // Each ring expands continuously from 1x → 4x its parent radius.
          res.size = baseSize * (1 + phase * 3);
          // Fade in quickly, then a long gentle fade out across the rest of the cycle.
          const fadeIn = Math.min(1, phase / 0.08);
          const fadeOut = Math.pow(1 - Math.min(1, Math.max(0, (phase - 0.08) / 0.92)), 1.6);
          const alpha = Math.max(0, 0.85 * fadeIn * fadeOut);
          // Shift colour from a deep red at the centre to a lighter, washed-out
          // red as the ring expands outward.
          const t = Math.min(1, Math.max(0, phase));
          const r = Math.round(180 + (255 - 180) * t);   // 180 → 255
          const g = Math.round(20 + (160 - 20) * t);     //  20 → 160
          const b = Math.round(20 + (160 - 20) * t);     //  20 → 160
          res.color = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
          res.type = "ring";
          res.label = "";
          return res;
        }

        /* --- Pulse Critical-severity package nodes --- */
        if (attrs.nodeType === "package" && (attrs as any).severity === "Critical") {
          const pulse = 1 + 0.18 * Math.sin(st.pulsePhase);
          res.size = (attrs.size ?? 1) * pulse;
        }

        /* --- Hide dependency nodes --- */
        if (st.hideDependencies && attrs.nodeType === "dependency") {
          res.hidden = true;
          return res;
        }

        /* --- Hide packages with unsupported scans --- */
        if (st.hideUnsupported && attrs.nodeType === "package" && (attrs as any).severity === "Unknown") {
          res.hidden = true;
          return res;
        }

        /* --- Filtering --- */
        if (st.filter !== "all" && attrs.nodeType !== "repo") {
          const vc = (attrs as any).vulnCount ?? 0;
          const sev = (attrs as any).severity ?? "None";
          let show = true;
          if (st.filter === "vulnerable") show = vc > 0;
          else if (st.filter === "safe") show = vc === 0;
          else if (st.filter === "quarantined") show = !!(attrs as any).is_quarantined || st.quarantinedDeps.has(node);
          else if (st.filter === "shared_cve") show = st.sharedCveNodes.has(node);
          else if (st.filter === "has_deps") show = st.hasDepNodes.has(node) || attrs.nodeType === "dependency";
          else show = sev === st.filter;
          if (!show) {
            res.hidden = true;
            return res;
          }
        }

        /* --- Format filter --- */
        if (st.formatFilter && attrs.nodeType !== "repo") {
          if ((attrs as any).format !== st.formatFilter) {
            res.hidden = true;
            return res;
          }
        }

        /* --- Search filtering --- */
        if (st.searchResults.length > 0) {
          if (st.searchResults.includes(node) || st.searchConnected.has(node) || attrs.nodeType === "repo") {
            /* keep visible */
          } else {
            res.hidden = true;
          }
          return res;
        }

        /* --- Severity-based z-layering so important nodes render in front --- */
        if (attrs.nodeType === "repo") {
          res.zIndex = 4;
        } else if (attrs.nodeType === "package") {
          const sev = (attrs as any).severity;
          if (sev === "Critical")     res.zIndex = 3;
          else if (sev === "High")    res.zIndex = 2;
          else if (sev === "Medium")  res.zIndex = 1;
        }

        /* --- Selection / hover: fade everything that isn't directly relevant --- */
        if (st.hoveredNode === node) {
          /* Always bring hovered node to the front regardless of selection */
          res.highlighted = true;
          res.size = (attrs.size ?? 1) * 1.25;
          res.zIndex = 9;
        } else if (st.selectedNode) {
          if (node === st.selectedNode) {
            res.highlighted = true;
            res.zIndex = 10;
          } else if (st.neighbors.has(node)) {
            /* Direct neighbours stay visible, just slightly behind selected */
            res.zIndex = 5;
          } else {
            /* Everything else: ghost — tiny, near-background, pushed to back */
            res.color = "#111220";
            res.size = Math.max(2, (attrs.size ?? 1) * 0.28);
            res.label = "";
            res.zIndex = -2;
          }
        } else if (st.hoveredNode) {
          /* Hover-only (no selection): fade non-connected nodes more subtly */
          if (!st.hoverNeighbors.has(node) && attrs.nodeType !== "repo") {
            res.color = "#0e0f1c";
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

        /* Hide shared CVE edges if toggled */
        if (st.hideSharedCveEdges && graph.getEdgeAttribute(edge, "edgeKind") === "shared_cve") {
          res.hidden = true;
          return res;
        }

        /* Hide dependency edges if toggled */
        if (st.hideDependencies && graph.getEdgeAttribute(edge, "edgeKind") === "dependency") {
          res.hidden = true;
          return res;
        }

        /* Hide edges connected to unsupported-scan nodes if toggled */
        if (st.hideUnsupported) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          const srcUnsupported = graph.getNodeAttribute(src, "nodeType") === "package" && graph.getNodeAttribute(src, "severity") === "Unknown";
          const tgtUnsupported = graph.getNodeAttribute(tgt, "nodeType") === "package" && graph.getNodeAttribute(tgt, "severity") === "Unknown";
          if (srcUnsupported || tgtUnsupported) {
            res.hidden = true;
            return res;
          }
        }

        /* Hide edges not connected to search-visible nodes */
        if (st.searchResults.length > 0) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          const srcVisible = st.searchResults.includes(src) || st.searchConnected.has(src) || graph.getNodeAttribute(src, "nodeType") === "repo";
          const tgtVisible = st.searchResults.includes(tgt) || st.searchConnected.has(tgt) || graph.getNodeAttribute(tgt, "nodeType") === "repo";
          if (!srcVisible || !tgtVisible) {
            res.hidden = true;
          }
          return res;
        }

        if (st.selectedNode) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src !== st.selectedNode && tgt !== st.selectedNode) {
            res.hidden = true;
          } else {
            res.size = (attrs.size ?? 1) * 2;
            const kind = graph.getEdgeAttribute(edge, "edgeKind");
            if (kind === "shared_cve")    res.color = "rgba(255,90,90,0.90)";
            else if (kind === "dependency") res.color = "rgba(155,80,210,0.90)";
            else                            res.color = "rgba(74,144,217,0.90)";
          }
        }

        if (st.hoveredNode && !st.selectedNode) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src !== st.hoveredNode && tgt !== st.hoveredNode) {
            res.color = "rgba(30, 32, 50, 0.08)";
          }
        }

        return res;
      },
    });

    /* Always render quarantine badges on top of all nodes */
    sigma.on("afterRender", () => {
      const labelsCanvas = (sigma.getCanvases() as Record<string, HTMLCanvasElement>).labels;
      if (!labelsCanvas) return;
      const ctx = labelsCanvas.getContext("2d");
      if (!ctx) return;
      const st = stateRef.current;
      graph.forEachNode((nodeId, attrs) => {
        if (!attrs.is_quarantined) return;
        const d = sigma.getNodeDisplayData(nodeId);
        if (!d || d.hidden) return;
        const { x, y } = (sigma as any).framedGraphToViewport(d);
        const size = (sigma as any).scaleSize(d.size);

        let alpha = 1;
        if (st.selectedNode) {
          if (nodeId !== st.selectedNode && !st.neighbors.has(nodeId)) alpha = 0.08;
        } else if (st.hoveredNode) {
          if (!st.hoverNeighbors.has(nodeId) && nodeId !== st.hoveredNode && attrs.nodeType !== "repo") alpha = 0.2;
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        drawLockBadge(ctx, x + size * 0.72, y - size * 0.72, Math.max(5, size * 0.58));
        ctx.restore();
      });
    });

    /* Events */
    sigma.on("clickNode", ({ node }) => {
      if (graph.getNodeAttribute(node, "nodeType") === "echo") return;
      onNodeSelect(node);
    });
    sigma.on("enterNode", ({ node }) => {
      if (graph.getNodeAttribute(node, "nodeType") === "echo") return;
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

    /* --- Pulse animation for Critical nodes --- */
    let rafId = 0;
    const startTime = performance.now();
    const tick = () => {
      // Stop looping if this sigma instance has been torn down
      if (cancelled) return;
      stateRef.current.pulsePhase = ((performance.now() - startTime) / 1000) * 2 * Math.PI * 0.35;
      // Sync echo node positions to their parent (in case layout moved parents)
      graph.forEachNode((nid, attrs) => {
        if (attrs.nodeType === "echo") {
          const pid = (attrs as any).parentId;
          if (graph.hasNode(pid)) {
            graph.setNodeAttribute(nid, "x", graph.getNodeAttribute(pid, "x"));
            graph.setNodeAttribute(nid, "y", graph.getNodeAttribute(pid, "y"));
          }
        }
      });
      sigma.refresh({ skipIndexation: true });
      rafId = requestAnimationFrame(tick);
      // Keep the stored id current so cleanup always cancels the latest frame
      (sigma as any)._pulseRaf = rafId;
    };
    rafId = requestAnimationFrame(tick);
    (sigma as any)._pulseRaf = rafId;

    } catch (err) {
      console.error("Graph build failed:", err);
      if (containerRef.current) {
        containerRef.current.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#8888aa;gap:8px;">
            <span style="font-size:32px;">⚠</span>
            <span style="font-size:14px;font-weight:600;">Failed to render graph</span>
            <span style="font-size:12px;color:#555570;">${err instanceof Error ? err.message : "Unknown error"}</span>
          </div>`;
      }
    }

    } /* end buildSigma */

    return () => {
      cancelled = true;
      if (sigmaRef.current) {
        const raf = (sigmaRef.current as any)._pulseRaf;
        if (raf) cancelAnimationFrame(raf);
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
        {onLayoutChange && onEdgeStyleChange && (
          <LayoutPopout
            layout={layout}
            edgeStyle={edgeStyle}
            onLayoutChange={onLayoutChange}
            onEdgeStyleChange={onEdgeStyleChange}
          />
        )}
        <button
          className="graph-recenter-btn"
          onClick={() => {
            const sigma = sigmaRef.current;
            const graph = graphRef.current;
            if (!sigma || !graph) return;
            let repoNode: string | null = null;
            graph.forEachNode((node, attrs) => {
              if (attrs.nodeType === "repo") repoNode = node;
            });
            if (!repoNode) return;
            const pos = sigma.getNodeDisplayData(repoNode);
            if (pos) {
              sigma.getCamera().animate(
                { x: pos.x, y: pos.y, ratio: 0.4 },
                { duration: 400 }
              );
            }
          }}
          title="Recenter on Repo"
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

function LayoutPopout({
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
