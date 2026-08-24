import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { GROUP_PREFIX, groupPackages, groupKeyOf } from "../lib/groupPackages";


import Sigma from "sigma";
import Graph from "graphology";
import { circular } from "graphology-layout";
import { EdgeCurvedArrowProgram } from "@sigma/edge-curve";
import { nodeFill, recolorGraph, severityRing } from "../programs/nodeWithSeverityRing";
import { hopColor, dimToCanvas, DIM } from "../lib/palette";
import { NodeSquareProgram, NodeTiltedSquareProgram } from "../programs/roundedSquare";
import { NodeHexagonProgram } from "../programs/NodeHexagonProgram";
import { NodeRingProgram } from "../programs/NodeRingProgram";
import EdgeDottedProgram from "../programs/EdgeDottedProgram";
import { drawDarkNodeHover, drawNodeLabel, drawLockBadge } from "../lib/hoverRenderer";
import { placeRadially, refineForceLayout, clusterAround, groupSpacing } from "../lib/layout";
import { focusNodes } from "../lib/focus";
import type { Point } from "../lib/layout";
import type { GraphResponse, FilterType, LayoutType, EdgeStyle, NodeData } from "../types";
import LayoutPopout from "./LayoutPopout";
import { SEVERITY_COLORS } from "../types";
import { token } from "../lib/palette";

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

interface Props {
  /** Resolved theme. Only used to re-read colours; the DOM is themed by CSS. */
  theme?: "light" | "dark";
  data: GraphResponse;
  selectedNode: string | null;
  hoveredNode: string | null;
  filter: FilterType;
  filterFlags?: Set<string>;
  filterFlagsMode?: "and" | "or";
  formatFilter?: string | null;
  layout: LayoutType;
  edgeStyle: EdgeStyle;
  searchResults: string[];
  hideSharedCveEdges?: boolean;
  hideDependencies?: boolean;
  hideUnsupported?: boolean;
  hideCriticalAnimation?: boolean;
  onNodeSelect: (id: string | null) => void;
  onNodeHover: (id: string | null) => void;
  onRefresh?: () => void;
  onLayoutChange?: (l: LayoutType) => void;
  onEdgeStyleChange?: (e: EdgeStyle) => void;
  onOpenAttackGraph?: (nodeId: string) => void;
}

export default function GraphCanvas({
  theme,
  data,
  selectedNode,
  hoveredNode,
  filter,
  filterFlags = new Set<string>(),
  filterFlagsMode = "and",
  formatFilter = null,
  layout,
  edgeStyle,
  searchResults,
  hideSharedCveEdges = false,
  hideDependencies = false,
  hideUnsupported = false,
  hideCriticalAnimation = false,
  onNodeSelect,
  onNodeHover,
  onRefresh,
  onLayoutChange,
  onEdgeStyleChange,
  onOpenAttackGraph,
}: Props) {
  /* Packages sharing a name collapse to one node until the user opens them.
     Held here rather than fetched: the graph is already in memory, so this is
     a local transform and expanding is instant. */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const grouped = useMemo(() => groupPackages(data, expandedGroups), [data, expandedGroups]);

  /* Every package id that shares each name, so an opened group can find the
     versions it is about to be replaced by. */
  const versionsByName = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of data?.nodes ?? []) {
      if (n.type !== "package") continue;
      const k = groupKeyOf(n);
      const list = m.get(k);
      if (list) list.push(n.id);
      else m.set(k, [n.id]);
    }
    return m;
  }, [data]);

  /* Every version an open group put on screen. Opening a group is a question
     about one package name, so everything else recedes while it is open —
     otherwise the versions that just appeared have to be picked out of the
     whole graph by eye, which is the problem grouping was meant to solve. */
  const expandedMembers = useMemo(() => {
    const out = new Set<string>();
    for (const name of expandedGroups) {
      const ids = versionsByName.get(name);
      if (!ids || ids.length <= 1) continue; // never had a group node
      out.add(GROUP_PREFIX + name); // the hub the versions hang off
      for (const id of ids) out.add(id);
    }
    return out;
  }, [expandedGroups, versionsByName]);

  /* Opening or closing a group rebuilds the graph, and a rebuild would
     normally re-scatter and re-settle every node. Capturing where everything
     currently sits — and where the camera is — lets the rebuild put it all
     back, so the only thing that moves is the group being opened. */
  const regroupRef = useRef<{
    seed: Map<string, Point>;
    camera: unknown;
    /* Nodes to frame once the rebuild has drawn them. Set only when the user
       opened a group by clicking it — a group opened on their behalf, to
       reveal a search hit, must not also move the camera. */
    focus?: string[];
  } | null>(null);

  const changeGroups = useCallback((
    next: (prev: Set<string>) => Set<string>,
    focus?: string[],
  ) => {
    const g = graphRef.current;
    if (g) {
      const seed = new Map<string, Point>();
      g.forEachNode((id, a) => {
        if (a.nodeType === "echo") return; // re-derived from their parents
        seed.set(id, { x: a.x as number, y: a.y as number });
      });
      regroupRef.current = { seed, camera: sigmaRef.current?.getCamera().getState(), focus };
    }
    /* Whatever was under the pointer is about to be replaced, and a hover on a
       node that no longer exists would dim the graph against nothing. */
    onNodeHover(null);
    setExpandedGroups(next);
  }, [onNodeHover]);

  /* Frame a node and whatever it connects to, so a click lands on something
     with its context rather than on a node alone in the middle of the view.
     Edges the user has hidden are not context, so they do not widen the box. */
  const focusAround = useCallback((sigma: Sigma, graph: Graph, node: string) => {
    const st = stateRef.current;
    const ids = [node];
    graph.forEachEdge(node, (_e, attrs, src, tgt) => {
      if (attrs.edgeKind === "shared_cve" && st.hideSharedCveEdges) return;
      if (attrs.edgeKind === "dependency" && st.hideDependencies) return;
      ids.push(src === node ? tgt : src);
    });
    focusNodes(sigma, ids);
  }, []);

  /* Anything pointed at from outside the canvas — a search hit, a selection
     made in a panel — names a specific version. While that version is
     collapsed its id is not in the graph, so the highlight would land on
     nothing and search would appear broken. Open the groups that contain
     them. */
  useEffect(() => {
    const wanted = [...searchResults, ...(selectedNode ? [selectedNode] : [])];
    if (wanted.length === 0) return;
    const nameOf = new Map<string, string>();
    for (const [gid, ids] of Object.entries(grouped.groupMembers)) {
      const name = gid.slice(GROUP_PREFIX.length);
      for (const id of ids) nameOf.set(id, name);
    }
    const toOpen = wanted.map((id) => nameOf.get(id)).filter(Boolean) as string[];
    if (toOpen.length === 0) return;
    changeGroups((prev) => {
      const next = new Set(prev);
      for (const n of toOpen) next.add(n);
      return next.size === prev.size ? prev : next;
    });
  }, [searchResults, selectedNode, grouped.groupMembers, changeGroups]);

  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const contextMenuHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  /* Cancels the in-flight sliced layout. Shared by the build and layout-switch
     effects so only one can ever be settling the graph. */
  const layoutRef = useRef<(() => void) | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  /* Mutable ref for state that reducers read */
  const stateRef = useRef({
    selectedNode,
    hoveredNode,
    filter,
    filterFlags,
    filterFlagsMode,
    formatFilter,
    searchResults,
    hideSharedCveEdges,
    hideDependencies,
    hideUnsupported,
    hideCriticalAnimation,
    neighbors: new Set<string>(),
    hops: new Map<string, number>(),
    hoverNeighbors: new Set<string>(),
    searchConnected: new Set<string>(),
    sharedCveNodes: new Set<string>(),
    hasDepNodes: new Set<string>(),
    quarantinedDeps: new Set<string>(),
    expandedMembers: new Set<string>(),
    nodeData: {} as Record<string, NodeData>,
    pulsePhase: 0,
  });

  /* Keep the ref in sync and tell sigma to re-render */
  useEffect(() => {
    /* An edge the user has hidden is not a relationship they are looking at,
       so it must not keep a node bright either. forEachNeighbor ignores edge
       kind entirely, which meant every vulnerable package counted as a
       neighbour of every other through shared-CVE edges — even with those
       edges hidden. Selecting a vulnerable package therefore dimmed the safe
       nodes and left every vulnerable one at full strength, with its edges
       invisible: a highlight with nothing visible to justify it. */
    const traversable = (attrs: { edgeKind?: string }) => {
      if (attrs.edgeKind === "shared_cve" && hideSharedCveEdges) return false;
      if (attrs.edgeKind === "dependency" && hideDependencies) return false;
      return true;
    };

    /* hasNode guards, not decoration: graphology throws NotFoundGraphError
       from forEachEdge on an id it does not hold, and that exception escapes
       this effect before stateRef is assigned — leaving every reducer reading
       the previous render's state. Opening a group deletes the very node the
       pointer is sitting on, so this fired on every single expand and was why
       the graph kept its old appearance. */
    const neighbors = new Set<string>();
    if (selectedNode && graphRef.current?.hasNode(selectedNode)) {
      graphRef.current.forEachEdge(selectedNode, (_e, attrs, src, tgt) => {
        if (!traversable(attrs)) return;
        neighbors.add(src === selectedNode ? tgt : src);
      });
    }

    /* Hop distance from the origin (§2.5). Fill encodes reach; the ring
       already encodes severity, and §6 forbids one colour carrying both.
       Without a selection the repo node is the implicit root, which makes
       packages hop 1 and their dependencies hop 2 — structurally what the
       graph already is.
       Breadth-first, so the first time a node is reached is its distance.
       ~7.5k nodes and 7.7k edges runs in single-digit milliseconds. */
    const hops = new Map<string, number>();
    if (selectedNode && graphRef.current?.hasNode(selectedNode)) {
      const g = graphRef.current;
      hops.set(selectedNode, 0);
      let frontier = [selectedNode];
      /* §2.5: "Beyond four hops, stop encoding distance — the ramp runs out of
         legible steps." Past that everything collapses to --g-hop-far, so
         walking further buys nothing. */
      for (let d = 1; d <= 4 && frontier.length; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          g.forEachEdge(id, (_e, attrs, src, tgt) => {
            /* repo_package edges are containment, not reach. Traversing them
               routes every package to every other through the repo hub, which
               made 7,489 of 7,544 nodes read as two hops away — an artifact of
               the container, not something the selected package touches.
               Excluding them turns the fill into an actual blast radius:
               measured on the container repository, a vulnerable package gives
               {0:1, 1:39, 2:2, far:161} instead of {0:1, 1:40, 2:162}. */
            if (attrs.edgeKind === "repo_package") return;
            if (!traversable(attrs)) return;
            const n = src === id ? tgt : src;
            if (hops.has(n)) return;
            hops.set(n, d);
            next.push(n);
          });
        }
        frontier = next;
      }
    }

    const hoverNeighbors = new Set<string>();
    if (hoveredNode && graphRef.current?.hasNode(hoveredNode)) {
      graphRef.current.forEachEdge(hoveredNode, (_e, attrs, src, tgt) => {
        if (!traversable(attrs)) return;
        hoverNeighbors.add(src === hoveredNode ? tgt : src);
      });
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
      filterFlags,
      filterFlagsMode,
      formatFilter,
      searchResults,
      hideSharedCveEdges,
      hideDependencies,
      hideUnsupported,
      hideCriticalAnimation,
      neighbors,
      hops,
      hoverNeighbors,
      searchConnected,
      sharedCveNodes,
      hasDepNodes,
      quarantinedDeps,
      expandedMembers,
    };
    sigmaRef.current?.refresh();
  }, [selectedNode, hoveredNode, filter, filterFlags, filterFlagsMode, formatFilter, searchResults, hideSharedCveEdges, hideDependencies, hideUnsupported, hideCriticalAnimation, expandedMembers]);

  /* Apply layout algorithm */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;

    if (layout === "force") {
      /* Scatter now so the switch is instant, then settle across frames.
         The camera refit waits for the layout to stop — refitting mid-run
         chases nodes that are still moving. */
      const repoNode = placeRadially(graph);
      sigma.refresh();
      sigma.getCamera().animatedReset({ duration: 400 });
      layoutRef.current?.();
      layoutRef.current = refineForceLayout(graph, repoNode, () => {
        sigma.refresh();
        sigma.getCamera().animatedReset({ duration: 400 });
      });
      return () => { layoutRef.current?.(); layoutRef.current = null; };
    }

    if (layout === "circular") {
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

  /* Re-resolve colours after a theme change.
     Node colours are graph attributes resolved at build time, and sigma's
     label settings are resolved at construction — neither follows CSS. The
     palette cache is cleared by applyTheme before this runs. */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    recolorGraph(graph);
    sigma.setSetting("labelColor", { color: token("--t-secondary") });
    sigma.refresh();
  }, [theme]);

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
    for (const node of grouped.nodes) {
      if (graph.hasNode(node.id)) continue;  // skip duplicates
      const sev = node.data.max_severity ?? "Unknown";

      const groupSize = grouped.groupMembers[node.id]?.length ?? 0;
      const size =
        node.type === "repo"
          ? 48
          : node.type === "dependency"
            ? 6
            : groupSize
              /* Sized by how many versions it stands for, so a fifty-version
                 group reads as a cluster rather than as one package. */
              ? Math.max(18, Math.min(44, 16 + Math.sqrt(groupSize) * 4))
              : Math.max(16, Math.min(40, 16 + (node.data.downloads || 0) / 200));

      /* Resolve icon for this node */
      /* Fill encodes what the node *is*; the ring encodes severity (§6). When
         hop-distance fills land, only this expression changes. */
      const fill = nodeFill(node.type);

      const ring = node.type === "package"
        ? severityRing(node.data.max_severity)
        : { borderColor: token("--g-node-stroke"), borderSize: 0 };
      /* Resting fill. The reducer overrides this with hop distance from the
         origin once the BFS has run — this is what shows before any of that. */

      graph.addNode(node.id, {
        label:
          node.type === "repo" ? ""
            : groupSize ? `${node.label} (${groupSize})`
              : node.label,
        size,
        color: fill,
        borderColor: ring.borderColor,
        borderSize: ring.borderSize,
        x: 0,
        y: 0,
        nodeType: node.type,
        /* Set only on collapsed groups; the reducer and click handler both
           key off it. */
        groupCount: groupSize || undefined,
        severity: sev,
        vulnCount: node.data.vuln_count,
        format: (node.data.format || "").toLowerCase(),
        is_quarantined: node.data.is_quarantined ?? false,
        /* Squares from the mark. The repository is its centre cell, which is
           the displaced one — so it carries the tilt permanently rather than
           only while selected. Dependencies keep the hexagon: they are a
           different kind of thing from a package, and shape is the only
           channel saying so now that fill carries hop distance. */
        ...(node.type === "dependency"
          ? { type: "hexagon" }
          : node.type === "repo"
            ? { type: "tilted" }
            : { type: "square" }),
      });
      nodeData[node.id] = node.data;
    }

    /* --- Add edges --- */
    const useCurved = edgeStyle === "curved";
    let edgeIdx = 0;
    for (const edge of grouped.edges) {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      const isSharedCve = edge.type === "shared_cve";
      const isDep = edge.type === "dependency";
      /* Hub to version. Straight and unarrowed: it is not a relationship the
         API reported, it is the group holding its own versions, and drawing it
         like a dependency would claim something false about the data. */
      const isGroup = edge.type === "group_member";
      graph.addEdgeWithKey(`e-${edgeIdx++}`, edge.source, edge.target, {
        size: isGroup ? 1.2 : isSharedCve ? 2.5 : isDep ? 0.4 : 2,
        color: isGroup ? "rgba(133, 183, 235,0.45)" : isSharedCve ? "rgba(232, 117, 107,0.6)" : isDep ? "rgba(133, 183, 235,0.6)" : "rgba(55, 138, 221,0.6)",
        type: isGroup ? "line" : isSharedCve ? "dotted" : isDep ? "dotted" : (useCurved ? "curvedArrow" : "arrow"),
        curvature: isSharedCve ? 0.35 : isDep ? 0.2 : 0.15,
        edgeKind: edge.type,
        label: edge.label,
      });
    }

    /* --- Layout ---
       Only the cheap scatter runs here. Settling it is deferred until sigma
       exists, so the first paint is not held behind it — on 7,544 nodes that
       was a 3.3s freeze between the loading screen disappearing and anything
       being drawn.

       A regroup is different: it keeps the picture still. Every node that
       already existed returns to where it was, the versions a group just
       opened fan out from that group's own position, and a group that just
       closed takes the centre of the versions it swallowed. */
    const regroup = regroupRef.current;
    regroupRef.current = null;
    let seed: Map<string, Point> | undefined;
    if (regroup) {
      seed = new Map(regroup.seed);
      const spacing = groupSpacing(regroup.seed.values());
      /* A group present now but not before has just closed: it lands on the
         centre of the versions it stands for. */
      for (const [gid, ids] of Object.entries(grouped.groupMembers)) {
        if (seed.has(gid)) continue;
        const known = ids.map((id) => regroup.seed.get(id)).filter(Boolean) as Point[];
        if (known.length === 0) continue;
        seed.set(gid, {
          x: known.reduce((t, q) => t + q.x, 0) / known.length,
          y: known.reduce((t, q) => t + q.y, 0) / known.length,
        });
      }
      /* Versions of a group that has just opened fan out around where the
         group node was standing, so they visibly come out of the node that
         was clicked. */
      for (const name of expandedGroups) {
        const anchor = regroup.seed.get(GROUP_PREFIX + name);
        if (!anchor) continue;
        const members = (versionsByName.get(name) ?? []).filter((id) => !seed!.has(id));
        if (members.length === 0) continue;
        const spots = clusterAround(anchor, members.length, spacing);
        members.forEach((id, i) => seed!.set(id, spots[i]));
      }
    }
    const repoNode = placeRadially(graph, seed);

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
          color: "rgba(232, 117, 107,0)",
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
      // Skip edge draws while the camera is moving. sigma computes
      // `moving` from camera animation, drag and wheel, and when this is set
      // it skips every edge program's render() for that frame — so panning a
      // 7,650-edge graph stops re-rasterising all of them per frame.
      //
      // It is worth more here than the default case because enableEdgeEvents
      // is on above: that gives the edges context a picking buffer, so each
      // frame was drawing the edges twice. Both passes are skipped.
      //
      // Edges reappear the moment the camera settles, including after the
      // animatedReset that follows a layout run.
      hideEdgesOnMove: true,
      defaultEdgeType: useCurved ? "curvedArrow" : "arrow",
      edgeProgramClasses: { curvedArrow: EdgeCurvedArrowProgram, dotted: EdgeDottedProgram },
      /* Every node gets an explicit type; this is the fallback if one ever
         does not, and it should be a square like the rest. */
      defaultNodeType: "square",
      nodeProgramClasses: { tilted: NodeTiltedSquareProgram, square: NodeSquareProgram, hexagon: NodeHexagonProgram, ring: NodeRingProgram },
      labelDensity: 0.12,
      labelGridCellSize: 80,
      labelRenderedSizeThreshold: 5,
      // Resolved, not var(): sigma passes this straight to canvas ctx.font.
      labelFont: token("--fg-font-body"),
      labelColor: { color: token("--t-secondary") },
      labelSize: 13,
      stagePadding: 40,
      zIndex: true,
      defaultDrawNodeHover: drawDarkNodeHover,
      defaultDrawNodeLabel: drawNodeLabel,

      nodeReducer: (node, attrs) => {
        const st = stateRef.current;
        const res = { ...attrs };

        /* Fill = distance from the origin (§6: "fill = hop distance, ring =
           severity, since the graph's job is showing reach"). Dependencies
           keep the hexagon shape, so their fill still reads as transitive. */
        if (st.selectedNode && attrs.nodeType !== "repo" && attrs.nodeType !== "echo") {
          const d = st.hops.get(node);
          res.color = d === undefined ? token("--g-hop-far") : hopColor(d);
        }

        /* --- Echo ring around Critical nodes --- */
        if (attrs.nodeType === "echo") {
          if (st.hideCriticalAnimation) {
            res.hidden = true;
            return res;
          }
          const parentId = (attrs as any).parentId as string;
          if (!graph.hasNode(parentId)) {
            res.hidden = true;
            return res;
          }
          // Hide ring when severity filter excludes Critical nodes
          if (st.filter !== "all" && st.filter !== "Critical") {
            res.hidden = true;
            return res;
          }
          // Hide ring when status flags exclude parent
          if (st.filterFlags.size > 0) {
            const pa = graph.getNodeAttributes(parentId);
            const pvc = (pa.vulnCount as number) ?? 0;
            const flagResults = Array.from(st.filterFlags).map((flag) => {
              if (flag === "vulnerable") return pvc > 0;
              if (flag === "safe") return pvc === 0;
              if (flag === "quarantined") return !!pa.is_quarantined || st.quarantinedDeps.has(parentId);
              if (flag === "shared_cve") return st.sharedCveNodes.has(parentId);
              if (flag === "has_deps") return st.hasDepNodes.has(parentId);
              return false;
            });
            const flagsPass = st.filterFlagsMode === "and"
              ? flagResults.every(Boolean)
              : flagResults.some(Boolean);
            if (!flagsPass) {
              res.hidden = true;
              return res;
            }
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
          // Hide ring when an open group dims the parent. A pulsing ring is
          // the loudest thing on the canvas; leaving it on a faded node would
          // pull the eye straight back off the group that was opened.
          if (!st.selectedNode && !st.hoveredNode && st.expandedMembers.size > 0 && !st.expandedMembers.has(parentId)) {
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
        if (!st.hideCriticalAnimation && attrs.nodeType === "package" && (attrs as any).severity === "Critical") {
          const pulse = 1 + 0.18 * Math.sin(st.pulsePhase);
          res.size = (attrs.size ?? 1) * pulse;
        }

        /* --- Hide dependency nodes --- */
        if (st.hideDependencies && attrs.nodeType === "dependency") {
          res.hidden = true;
          return res;
        }

        /* --- Hide dependency nodes whose parent packages are all filtered out --- */
        if (attrs.nodeType === "dependency" && (st.filter !== "all" || st.filterFlags.size > 0)) {
          let anyParentVisible = false;
          graph.forEachNeighbor(node, (nid) => {
            if (anyParentVisible) return;
            const na = graph.getNodeAttributes(nid);
            if (na.nodeType !== "package") return;
            const sev = (na.severity as string) ?? "None";
            const vc = (na.vulnCount as number) ?? 0;
            if (st.filter !== "all" && sev !== st.filter) return;
            if (st.filterFlags.size === 0) { anyParentVisible = true; return; }
            const results = Array.from(st.filterFlags).map((flag) => {
              if (flag === "vulnerable") return vc > 0;
              if (flag === "safe") return vc === 0;
              if (flag === "quarantined") return !!na.is_quarantined || st.quarantinedDeps.has(nid);
              if (flag === "shared_cve") return st.sharedCveNodes.has(nid);
              if (flag === "has_deps") return st.hasDepNodes.has(nid);
              return false;
            });
            if (st.filterFlagsMode === "and" ? results.every(Boolean) : results.some(Boolean)) {
              anyParentVisible = true;
            }
          });
          if (!anyParentVisible) {
            res.hidden = true;
            return res;
          }
        }

        /* --- Hide packages with unsupported scans --- */
        if (st.hideUnsupported && attrs.nodeType === "package" && (attrs as any).severity === "Unknown") {
          res.hidden = true;
          return res;
        }

        /* --- Filtering (severity AND status flags — packages only) --- */
        if (attrs.nodeType === "package") {
          const vc = (attrs as any).vulnCount ?? 0;
          const sev = (attrs as any).severity ?? "None";

          // Severity filter (single-select: Critical/High/Medium/Low or "all")
          const severityPass = st.filter === "all" || sev === st.filter;

          // Status flags (AND or OR logic depending on filterFlagsMode)
          let flagsPass = st.filterFlags.size === 0;
          if (!flagsPass) {
            const flagResults = Array.from(st.filterFlags).map((flag) => {
              if (flag === "vulnerable") return vc > 0;
              if (flag === "safe") return vc === 0;
              if (flag === "quarantined") return !!(attrs as any).is_quarantined || st.quarantinedDeps.has(node);
              if (flag === "shared_cve") return st.sharedCveNodes.has(node);
              if (flag === "has_deps") return st.hasDepNodes.has(node) || attrs.nodeType === "dependency";
              return false;
            });
            flagsPass = st.filterFlagsMode === "and"
              ? flagResults.every(Boolean)
              : flagResults.some(Boolean);
          }

          if (!severityPass || !flagsPass) {
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
          /* Tilt on hover, as selection does: the mark's centre cell is the
             displaced one, so displacement is how this design says "this one".
             Only squares — a tilted hexagon is just a hexagon, and dependencies
             are hexagons precisely to read as a different kind of thing. The
             repository already carries the tilt permanently. */
          if (attrs.type === "square") res.type = "tilted";
        } else if (st.selectedNode) {
          if (node === st.selectedNode) {
            /* The origin: the one thing under investigation (§1). Ember fill,
               tilted rounded square, 22px, label always shown. Exactly one of
               these exists at a time, which is what makes amber mean
               something — "if your UI has three amber things in it, the
               metaphor is dead and so is the colour's meaning".

               The severity ring stays: you still need to know whether the
               thing you are investigating is Critical. */
            /* Selection is the tilt, not the colour. Ember now belongs to the
               repository — the mark's centre cell — and §1 allows exactly one
               of it on screen, so the selected package stays blue and is
               distinguished by being displaced, enlarged and labelled. */
            res.type = "tilted";
            res.size = 22;
            res.forceLabel = true;
            res.highlighted = true;
            res.zIndex = 10;
          } else if (st.neighbors.has(node)) {
            /* Direct neighbours stay visible, just slightly behind selected */
            res.zIndex = 5;
          } else if (attrs.nodeType === "repo") {
            /* The repository anchors the graph — everything is arranged around
               it. Fading it to a ghost removes the centre of the picture, so it
               keeps its ember and its tilt and simply sits behind. */
            res.zIndex = 0;
          } else {
            /* Dimmed, not recoloured. §6: "non-path nodes drop to 25% opacity
               rather than changing colour. Colour changes break the distance
               encoding; opacity doesn't."

               This used to force the node onto a circle program: the image
               program computes its output alpha as max(texel.a, v_color.a), so
               an opaque format icon pinned it to full opacity and the dimming
               did nothing. Nodes are drawn squares now, which honour alpha, so
               the shape survives. */
            res.color = dimToCanvas(res.color as string, DIM.selection);
            res.borderSize = 0;
            res.size = Math.max(3, (attrs.size ?? 1) * 0.6);
            res.label = "";
            res.zIndex = -2;
          }
        } else if (st.hoveredNode) {
          /* Hover-only (no selection): fade non-connected nodes more subtly.
             Mixed toward the canvas rather than given an alpha — alpha is not
             premultiplied here, so the shaders drew it as a washed, shifted
             colour instead of a fainter one. Kept the lightest of the three
             dims: hover is a glance, selection is a decision. */
          if (!st.hoverNeighbors.has(node) && attrs.nodeType !== "repo") {
            res.color = dimToCanvas(res.color as string, DIM.hover);
            res.borderSize = 0;
            res.size = Math.max(3, (attrs.size ?? 1) * 0.7);
            res.label = "";
            res.zIndex = -1;
          }
        } else if (st.expandedMembers.has(node) && node.startsWith(GROUP_PREFIX)) {
          /* The open hub. It is no longer the answer to anything — it is the
             thing the versions came out of, and it still carries the whole
             group's worst severity, so at full strength it competes with the
             versions it was opened to reveal. Held halfway between them and
             the receded graph.

             Fill only: the ring is what says how bad this name is overall,
             which is the one thing the hub is still for. */
          res.color = dimToCanvas(res.color as string, DIM.openHub);
        } else if (st.expandedMembers.size > 0 && !st.expandedMembers.has(node)) {
          /* A group is open and this is not one of its versions.
             Held at 0.35 rather than selection's 0.25: nothing has been
             selected yet, so the rest of the graph is still context to be read
             against, not a path that has been ruled out. The repository stays
             put — it is the centre everything is arranged around. */
          if (attrs.nodeType !== "repo" && attrs.nodeType !== "echo") {
            res.color = dimToCanvas(res.color as string, DIM.group);
            res.borderSize = 0;
            res.size = Math.max(3, (attrs.size ?? 1) * 0.6);
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
            if (kind === "shared_cve")    res.color = "rgba(232, 117, 107,0.90)";
            else if (kind === "dependency") res.color = "rgba(92, 159, 228,0.90)";
            else                            res.color = "rgba(55, 138, 221,0.90)";
          }
        }

        if (st.hoveredNode && !st.selectedNode) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src !== st.hoveredNode && tgt !== st.hoveredNode) {
            /* Was a hardcoded near-black, which is a dark-theme assumption:
               on the light canvas it painted the faded edges darker than the
               ones being highlighted. */
            res.color = dimToCanvas(res.color as string, DIM.edge);
          }
        } else if (!st.selectedNode && st.expandedMembers.size > 0) {
          /* Faded rather than hidden: an edge that vanishes changes the shape
             of the graph, and the point of opening a group is to see it in
             place. */
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (!st.expandedMembers.has(src) && !st.expandedMembers.has(tgt)) {
            res.color = dimToCanvas(res.color as string, DIM.edge);
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
        } else if (st.expandedMembers.size > 0) {
          if (!st.expandedMembers.has(nodeId) && attrs.nodeType !== "repo") alpha = 0.2;
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        drawLockBadge(ctx, x + size * 0.72, y - size * 0.72, Math.max(5, size * 0.58));
        ctx.restore();
      });
    });

    /* Events */
    sigma.on("clickNode", ({ node }) => {
      /* A collapsed group opens rather than selects: there is no single
         package behind it to show. */
      if (node.startsWith(GROUP_PREFIX)) {
        const name = node.slice(GROUP_PREFIX.length);
        /* Safe to read directly: the build effect is keyed on `grouped`, so
           this handler is rebuilt whenever expandedGroups changes. */
        const opening = !expandedGroups.has(name);
        changeGroups(
          (prev) => {
            const next = new Set(prev);
            /* The hub stays on screen once open, so the same click closes it —
               otherwise the only way back is double-clicking the background. */
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
          },
          /* Opening: frame the versions and the hub they came out of. Closing
             leaves the camera alone — the user is stepping back out, and
             yanking the view would undo the position they closed it from. */
          opening ? [node, ...(versionsByName.get(name) ?? [])] : undefined,
        );
        return;
      }
      if (graph.getNodeAttribute(node, "nodeType") === "echo") return;
      onNodeSelect(node);
      focusAround(sigma, graph, node);
      setContextMenu(null);
    });
    const mouseCanvas = (sigma.getCanvases() as Record<string, HTMLCanvasElement>).mouse;
    const setCursor = (c: string) => { if (mouseCanvas) mouseCanvas.style.cursor = c; };

    sigma.on("enterNode", ({ node }) => {
      if (graph.getNodeAttribute(node, "nodeType") === "echo") return;
      onNodeHover(node);
      setCursor("grab");
    });
    sigma.on("leaveNode", () => {
      onNodeHover(null);
      setCursor("default");
    });
    sigma.on("downNode", () => { setCursor("grabbing"); });
    sigma.on("clickNode", ({ node }) => { if (graph.getNodeAttribute(node, "nodeType") !== "echo") setCursor("grab"); });
    sigma.on("clickStage", () => { onNodeSelect(null); setContextMenu(null); });
    /* Double-clicking the background collapses every group again — without a
       way back, opening a fifty-version group is a one-way trip. */
    sigma.on("doubleClickStage", (e) => {
      e.preventSigmaDefault();
      changeGroups(() => new Set());
    });

    /* Right-click context menu for package nodes */
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const hovered = stateRef.current.hoveredNode;
      if (
        hovered &&
        graph.getNodeAttribute(hovered, "nodeType") === "package" &&
        ["Critical", "High"].includes(graph.getNodeAttribute(hovered, "severity"))
      ) {
        setContextMenu({ x: e.clientX, y: e.clientY, nodeId: hovered });
      } else {
        setContextMenu(null);
      }
    };
    contextMenuHandlerRef.current = handleContextMenu;
    containerRef.current!.addEventListener("contextmenu", handleContextMenu);

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

    /* --- Settle the layout ---
       The pulse loop above already repaints every frame and re-syncs echo
       nodes to their parents, so slices only have to move nodes. The full
       refresh at the end is for the spatial index: the pulse loop skips
       indexation, which leaves hit-testing stale once positions have moved. */
    if (layoutRef.current) layoutRef.current();
    if (regroup) {
      /* Every position is already decided, and both settling the layout and
         refitting the camera would move the graph out from under a user who
         only clicked one node. */
      if (regroup.camera) sigma.getCamera().setState(regroup.camera as never);
      sigma.refresh();
      /* After the refresh: display data for nodes added by this rebuild does
         not exist until sigma has processed them. */
      if (regroup.focus) focusNodes(sigma, regroup.focus, { duration: 500 });
    } else {
      layoutRef.current = refineForceLayout(graph, repoNode, () => {
        if (cancelled) return;
        sigma.refresh();
        sigma.getCamera().animatedReset({ duration: 400 });
      });
    }

    } catch (err) {
      console.error("Graph build failed:", err);
      if (containerRef.current) {
        containerRef.current.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--t-muted);gap:8px;">
            <span style="font-size:32px;">⚠</span>
            <span style="font-size:14px;font-weight:600;">Failed to render graph</span>
            <span style="font-size:12px;color:var(--fg-n-600);">${err instanceof Error ? err.message : "Unknown error"}</span>
          </div>`;
      }
    }

    } /* end buildSigma */

    return () => {
      cancelled = true;
      /* Before killing sigma — a slice landing afterwards would refresh a
         dead renderer. */
      layoutRef.current?.();
      layoutRef.current = null;
      if (contextMenuHandlerRef.current) {
        containerRef.current?.removeEventListener("contextmenu", contextMenuHandlerRef.current);
        contextMenuHandlerRef.current = null;
      }
      if (sigmaRef.current) {
        const raf = (sigmaRef.current as any)._pulseRaf;
        if (raf) cancelAnimationFrame(raf);
        sigmaRef.current.kill();
        sigmaRef.current = null;
        graphRef.current = null;
      }
    };
  }, [grouped]);

  /* Close context menu on outside click */
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [contextMenu]);

  return (
    <div className="graph-wrapper">
      <div ref={containerRef} className="graph-container" />

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              if (onOpenAttackGraph) {
                onNodeSelect(contextMenu.nodeId);
                onOpenAttackGraph(contextMenu.nodeId);
              }
              setContextMenu(null);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            View Attack Path
          </button>
        </div>
      )}

      <div className="graph-controls">
        {onLayoutChange && onEdgeStyleChange && (
          <LayoutPopout
            layout={layout}
            edgeStyle={edgeStyle}
            onLayoutChange={onLayoutChange}
            onEdgeStyleChange={onEdgeStyleChange}
          />
        )}
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
          <button className="graph-refresh-btn" onClick={onRefresh} title="Refresh data">
            ↻
          </button>
        )}
      </div>
    </div>
  );
}

