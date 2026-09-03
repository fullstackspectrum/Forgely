import { useEffect, useRef, useCallback, useState } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { circular } from "graphology-layout";
import { NodeImageWithRingProgram, severityRing, nodeFill } from "../programs/nodeWithSeverityRing";
import { NodeTiltedSquareProgram } from "../programs/roundedSquare";
import { EdgeCurvedArrowProgram } from "@sigma/edge-curve";
import LayoutPopout from "./LayoutPopout";
import { SEVERITY_COLORS } from "../types";
import type { WorkspaceOverviewResponse, LayoutType, EdgeStyle } from "../types";
import { token } from "../lib/palette";
import { drawNodeLabel } from "../lib/hoverRenderer";

interface Props {
  data: WorkspaceOverviewResponse;
  selectedRepo: string | null;
  workspaceSelected: boolean;
  formatFilter: Set<string>;
  onRepoSelect: (slug: string | null) => void;
  onWorkspaceSelect: () => void;
  onLoadFullGraph: (slug: string) => void;
  onRefresh?: () => void;
}

function getSevColor(sev: string | null): string {
  if (!sev) return token("--fg-n-600");
  return SEVERITY_COLORS[sev] ?? token("--fg-n-600");
}

function applyOverviewLayout(graph: Graph, layout: LayoutType, wsId: string) {
  const n = graph.order;

  if (layout === "force") {
    graph.forEachNode((id) => {
      if (id === wsId) { graph.setNodeAttribute(id, "x", 0); graph.setNodeAttribute(id, "y", 0); return; }
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.max(200, n * 8) * (0.5 + Math.random() * 0.8);
      graph.setNodeAttribute(id, "x", Math.cos(angle) * r);
      graph.setNodeAttribute(id, "y", Math.sin(angle) * r);
    });
    forceAtlas2.assign(graph, {
      iterations: Math.min(600, 250 + n * 3),
      settings: {
        gravity: 0.2,
        scalingRatio: 12,
        adjustSizes: true,
        strongGravityMode: true,
        slowDown: 1 + Math.log(n + 1),
        // Gated, not unconditional. Barnes-Hut trades exact repulsion for a
        // quadtree, and building that tree costs more than the O(N²) pass it
        // replaces until the graph is large. Measured on this canvas's own
        // topology and settings (one workspace node, one node per repo),
        // best of three runs:
        //
        //     nodes    brute   barnes-hut
        //         9    0.2ms        1.2ms
        //        51    4.5ms       13.2ms
        //       151   44.1ms       82.1ms
        //       301  170.4ms      204.2ms
        //       401  296.5ms      284.5ms   <- crossover
        //       601  655.3ms      471.3ms
        //       901 1467.7ms      776.6ms
        //
        // A workspace has one node per repository, so it sits at the top of
        // that table almost always. Enabling this unconditionally — as the
        // design doc suggested — would have made the common case 2-3x slower
        // to speed up a size that does not occur.
        //
        // The threshold is sensitive to the initial scatter above, not just to
        // node count: timed against a uniform ring the crossover looks like
        // 300, but the random radial band this canvas actually uses pushes it
        // to 400.
        barnesHutOptimize: n > 400,
      },
    });
    // Re-anchor workspace node to origin
    const ox = graph.getNodeAttribute(wsId, "x") as number;
    const oy = graph.getNodeAttribute(wsId, "y") as number;
    graph.forEachNode((id) => {
      graph.setNodeAttribute(id, "x", (graph.getNodeAttribute(id, "x") as number) - ox);
      graph.setNodeAttribute(id, "y", (graph.getNodeAttribute(id, "y") as number) - oy);
    });
  } else if (layout === "circular") {
    circular.assign(graph);
  } else if (layout === "radial") {
    // Workspace at centre, repos evenly around it
    const repos = graph.nodes().filter((id) => id !== wsId);
    graph.setNodeAttribute(wsId, "x", 0);
    graph.setNodeAttribute(wsId, "y", 0);
    const radius = Math.max(4, repos.length * 0.55);
    repos.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / repos.length - Math.PI / 2;
      graph.setNodeAttribute(id, "x", radius * Math.cos(angle));
      graph.setNodeAttribute(id, "y", radius * Math.sin(angle));
    });
  } else if (layout === "tree" || layout === "horizontal") {
    // Workspace as root, repos spread below / to the right
    const repos = graph.nodes().filter((id) => id !== wsId);
    const horizontal = layout === "horizontal";
    const spread = Math.max(repos.length * 2.5, 10);
    const step = spread / Math.max(repos.length - 1, 1);
    graph.setNodeAttribute(wsId, "x", 0);
    graph.setNodeAttribute(wsId, "y", 0);
    repos.forEach((id, i) => {
      const offset = -spread / 2 + i * step;
      graph.setNodeAttribute(id, "x", horizontal ? 5 : offset);
      graph.setNodeAttribute(id, "y", horizontal ? offset : 5);
    });
  }
}

export default function WorkspaceOverviewCanvas({
  data,
  selectedRepo,
  workspaceSelected,
  formatFilter,
  onRepoSelect,
  onWorkspaceSelect,
  onLoadFullGraph,
  onRefresh,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<LayoutType>("radial");
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>("curved");

  /* Remove any existing context menu */
  const removeContextMenu = useCallback(() => {
    if (contextMenuRef.current) {
      contextMenuRef.current.remove();
      contextMenuRef.current = null;
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const graph = new Graph({ multi: false });
    graphRef.current = graph;

    /* Workspace centre node — the same mark GraphCanvas gives the repository
       it centres on: the ember square, tilted. It was the product icon, which
       made the centre of this graph read as branding rather than as the thing
       every edge points at. §1 allows one ember per view and this is it. */
    const wsId = `ws:${data.owner}`;
    graph.addNode(wsId, {
      x: 0,
      y: 0,
      size: 48,
      label: "",
      color: nodeFill("repo"),
      nodeType: "workspace",
      type: "tilted",
    });

    /* Repo nodes arranged in a circle */
    const repos = data.repos;
    const radius = Math.max(5, repos.length * 0.55);

    const MIN_NODE_SIZE = 8;
    const MAX_NODE_SIZE = 56;
    const counts = repos.map((r) => r.package_count);
    const maxCount = Math.max(...counts, 1);
    const logMax = Math.log1p(maxCount);

    const repoNodeSize = (count: number) =>
      MIN_NODE_SIZE + (Math.log1p(count) / logMax) * (MAX_NODE_SIZE - MIN_NODE_SIZE);

    repos.forEach((repo, i) => {
      const angle = (2 * Math.PI * i) / repos.length - Math.PI / 2;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      const sev = repo.max_severity;
      graph.addNode(repo.slug, {
        x,
        y,
        size: repoNodeSize(repo.package_count),
        label: repo.name,
        /* Fill is what the node is, ring is severity (§6). borderColor was
           already being set here and silently discarded — NodeImageProgram has
           no border support — so it now goes through the compound program. */
        color: token("--fg-blue-400"),
        ...severityRing(sev),
        /* Named explicitly. With no type and no defaultNodeType these fell
           through to sigma's plain circle program, which has no border — so
           the ring above was still being discarded, which is exactly what the
           comment above says was fixed. The compound program draws it. */
        type: "image",
        nodeType: "repo",
        slug: repo.slug,
        max_severity: sev,
      });
      graph.addEdge(wsId, repo.slug, {
        size: 2,
        color: "rgba(55, 138, 221,0.5)",
        type: "curvedArrow",
        curvature: 0.15,
      });
    });

    /* Connected repositories: this repo resolves packages from that one. Drawn
       between the repo nodes themselves rather than through the workspace,
       because that is the shape of the relationship — the workspace is not on
       the path. Bowed further than the spokes so it reads as a chord across
       the ring rather than another radius. */
    for (const c of data.connections ?? []) {
      /* A throw here would blank the whole canvas, and the graph is not multi:
         a self-connection or a pair already joined would do it. */
      if (!graph.hasNode(c.source) || !graph.hasNode(c.target)) continue;
      if (c.source === c.target || graph.hasEdge(c.source, c.target)) continue;
      graph.addEdgeWithKey(`conn:${c.source}->${c.target}`, c.source, c.target, {
        /* Deliberately unlike the spokes, which are thin, mid-blue and barely
           bowed. This is heavier, paler, opaque and bowed far enough to read
           as a chord across the ring rather than another radius — four
           channels apart, because one was not enough to tell them apart at a
           glance. The arrow is kept: a connection is directional, and which
           repo reaches into which is the whole point. */
        size: 4,
        /* Mist rather than Signal — the token the palette already uses for a
           transitive path, which is exactly what this is. Dimmed when
           inactive: configured but nothing travelling it is worth seeing and
           worth distinguishing. */
        color: c.is_active ? token("--g-edge-transitive") : "rgba(133, 183, 235,0.22)",
        type: "curvedArrow",
        curvature: 0.55,
        edgeKind: "repo_connected",
        label: c.formats.length ? c.formats.join(", ") : "connected",
      });
    }

    const sigma = new Sigma(graph, container, {
      defaultNodeColor: token("--c-action"),
      defaultEdgeColor: "rgba(139, 156, 175,0.25)",
      labelFont: token("--fg-font-body"),
      labelSize: 12,
      labelWeight: "500",
      labelColor: { color: token("--t-secondary") },
      defaultDrawNodeLabel: drawNodeLabel,
      renderEdgeLabels: false,
      minCameraRatio: 0.05,
      maxCameraRatio: 8,
      defaultEdgeType: "curvedArrow",
      nodeProgramClasses: { image: NodeImageWithRingProgram, tilted: NodeTiltedSquareProgram },
      edgeProgramClasses: { curvedArrow: EdgeCurvedArrowProgram },
      nodeReducer: (node, attrs) => {
        const isSelected = node === selectedRepo || (attrs.nodeType === "workspace" && workspaceSelected);
        const baseSize = attrs.nodeType === "workspace" ? 48 : (attrs.size as number ?? 14);
        return {
          ...attrs,
          size: isSelected ? baseSize * 1.2 : baseSize,
          zIndex: isSelected ? 2 : 1,
          highlighted: isSelected,
        };
      },
      edgeReducer: (_edge, attrs) => attrs,
    });
    sigmaRef.current = sigma;

    /* Fit to view */
    sigma.getCamera().setState({ ratio: 1.6, x: 0.5, y: 0.5 });

    /* Cursor feedback, matching the repo graph: over a node it is grabbable,
       pressed it is grabbing, over the stage it is the default arrow. Set on
       the mouse canvas, which is the layer sigma puts on top. */
    const mouseCanvas = (sigma.getCanvases() as Record<string, HTMLCanvasElement>).mouse;
    const setCursor = (c: string) => { if (mouseCanvas) mouseCanvas.style.cursor = c; };

    sigma.on("enterNode", () => setCursor("grab"));
    sigma.on("leaveNode", () => setCursor("default"));
    sigma.on("downNode", () => setCursor("grabbing"));

    /* Click handlers */
    sigma.on("clickNode", ({ node }) => {
      /* Back to grab on release, or the pointer stays pressed-looking while
         it is still over the node that was clicked. */
      setCursor("grab");
      removeContextMenu();
      if (node === wsId) {
        onWorkspaceSelect();
        return;
      }
      onRepoSelect(node);
    });

    sigma.on("clickStage", () => {
      removeContextMenu();
      onRepoSelect(null);
    });

    /* Right-click context menu */
    sigma.on("rightClickNode", ({ node, event }) => {
      removeContextMenu();
      if (node === wsId) return;

      const nativeEvent = event.original as MouseEvent;
      nativeEvent.preventDefault();
      const menu = document.createElement("div");
      menu.className = "context-menu";
      menu.style.top = `${nativeEvent.clientY}px`;
      menu.style.left = `${nativeEvent.clientX}px`;

      const item = document.createElement("button");
      item.className = "context-menu-item";
      item.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        Load Full Graph`;
      item.addEventListener("click", () => {
        removeContextMenu();
        onLoadFullGraph(node);
      });
      menu.appendChild(item);

      document.body.appendChild(menu);
      contextMenuRef.current = menu;

      const handleClose = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node)) {
          removeContextMenu();
          document.removeEventListener("mousedown", handleClose);
        }
      };
      document.addEventListener("mousedown", handleClose);
    });

    return () => {
      removeContextMenu();
      sigma.kill();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /* Re-apply layout when user switches */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    applyOverviewLayout(graph, layout, `ws:${data.owner}`);
    sigma.refresh();
    sigma.getCamera().animatedReset({ duration: 400 });
  }, [layout, data.owner]);

  /* Switch edge type when style changes */
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    const newType = edgeStyle === "curved" ? "curvedArrow" : "arrow";
    graph.forEachEdge((edge) => graph.setEdgeAttribute(edge, "type", newType));
    sigma.setSetting("defaultEdgeType", newType);
    sigma.refresh();
  }, [edgeStyle]);

  /* Refresh node/edge reducers when selection or format filter changes */
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    const repoFormats = new Map<string, Set<string>>();
    for (const repo of data.repos) {
      repoFormats.set(repo.slug, new Set(Object.keys(repo.formats ?? {}).map((f) => f.toLowerCase())));
    }

    sigma.setSetting("nodeReducer", (node, attrs) => {
      const isRepo = attrs.nodeType === "repo";
      const isSelected = node === selectedRepo || (attrs.nodeType === "workspace" && workspaceSelected);
      const baseSize = attrs.nodeType === "workspace" ? 48 : (attrs.size as number ?? 14);

      const hiddenByRepo = !!selectedRepo && isRepo && node !== selectedRepo;

      const fmts = repoFormats.get(node);
      const matchesFormat = !formatFilter.size || (fmts ? [...formatFilter].some((f) => fmts.has(f)) : false);
      const dimmed = isRepo && formatFilter.size > 0 && !matchesFormat;

      return {
        ...attrs,
        size: isSelected ? baseSize * 1.2 : baseSize,
        zIndex: isSelected ? 2 : 1,
        highlighted: isSelected,
        hidden: hiddenByRepo,
        color: dimmed ? token("--c-surface") : attrs.color,
        borderSize: dimmed ? 0 : attrs.borderSize,
      };
    });
    sigma.setSetting("edgeReducer", (edge, attrs) => {
      const src = graph.source(edge);
      const tgt = graph.target(edge);
      if (selectedRepo) {
        return { ...attrs, hidden: src !== selectedRepo && tgt !== selectedRepo };
      }
      if (formatFilter.size) {
        const repoNode = src === `ws:${data.owner}` ? tgt : src;
        const fmts = repoFormats.get(repoNode);
        const matches = fmts ? [...formatFilter].some((f) => fmts.has(f)) : false;
        return { ...attrs, color: matches ? "rgba(55, 138, 221,0.5)" : "rgba(55, 138, 221,0.1)" };
      }
      return attrs;
    });
    sigma.refresh();
  }, [selectedRepo, workspaceSelected, formatFilter, data.repos, data.owner]);

  const cam = () => sigmaRef.current?.getCamera();
  const wsId = `ws:${data.owner}`;

  return (
    <div className="graph-wrapper">
      <div ref={containerRef} className="graph-container" />

      <div className="graph-controls">
        <LayoutPopout
          layout={layout}
          edgeStyle={edgeStyle}
          onLayoutChange={(l) => {
            setLayout(l);
            if (l === "tree" || l === "horizontal") setEdgeStyle("straight");
            else setEdgeStyle("curved");
          }}
          onEdgeStyleChange={setEdgeStyle}
        />
        {/* Pan cluster */}
        <div className="graph-nav-cluster">
          <button className="graph-nav-btn" title="Pan up"    onClick={() => { const c = cam(); if (c) c.animate({ y: c.y + 0.1 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <div className="graph-nav-row">
            <button className="graph-nav-btn" title="Pan left"  onClick={() => { const c = cam(); if (c) c.animate({ x: c.x - 0.1 }, { duration: 200 }); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button className="graph-nav-btn" title="Pan right" onClick={() => { const c = cam(); if (c) c.animate({ x: c.x + 0.1 }, { duration: 200 }); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <button className="graph-nav-btn" title="Pan down"  onClick={() => { const c = cam(); if (c) c.animate({ y: c.y - 0.1 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>

        {/* Zoom cluster */}
        <div className="graph-zoom-cluster">
          <button className="graph-nav-btn" title="Zoom in"  onClick={() => { const c = cam(); if (c) c.animate({ ratio: c.ratio / 1.3 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button className="graph-nav-btn" title="Zoom out" onClick={() => { const c = cam(); if (c) c.animate({ ratio: c.ratio * 1.3 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>

        {/* Recenter on workspace node */}
        <button
          className="graph-recenter-btn"
          title="Recenter"
          onClick={() => {
            const sigma = sigmaRef.current;
            if (!sigma) return;
            const pos = sigma.getNodeDisplayData(wsId);
            if (pos) sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.8 }, { duration: 400 });
          }}
        >
          ⊙
        </button>

        {onRefresh && (
          <button className="graph-refresh-btn" onClick={onRefresh} title="Refresh data">↻</button>
        )}
      </div>
    </div>
  );
}
