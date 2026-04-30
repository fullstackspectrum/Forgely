import { useEffect, useRef, useCallback, useState } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { circular } from "graphology-layout";
import { NodeImageProgram } from "@sigma/node-image";
import { EdgeCurvedArrowProgram } from "@sigma/edge-curve";
import LayoutPopout from "./LayoutPopout";
import { SEVERITY_COLORS } from "../types";
import type { WorkspaceOverviewResponse, LayoutType, EdgeStyle } from "../types";

interface Props {
  data: WorkspaceOverviewResponse;
  selectedRepo: string | null;
  workspaceSelected: boolean;
  onRepoSelect: (slug: string | null) => void;
  onWorkspaceSelect: () => void;
  onLoadFullGraph: (slug: string) => void;
  onRefresh?: () => void;
}

const SEV_BORDER: Record<string, string> = {
  Critical: "#ff4d4d",
  High:     "#ff8c1a",
  Medium:   "#ffd11a",
  Low:      "#79b8ff",
  None:     "#28a745",
};

function getSevColor(sev: string | null): string {
  if (!sev) return "#555577";
  return SEVERITY_COLORS[sev] ?? "#555577";
}

function getSevBorder(sev: string | null): string {
  if (!sev) return "#888899";
  return SEV_BORDER[sev] ?? "#888899";
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
      settings: { gravity: 0.2, scalingRatio: 12, adjustSizes: true, strongGravityMode: true, slowDown: 1 + Math.log(n + 1) },
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

    /* Workspace centre node — styled like the repo node in GraphCanvas */
    const wsId = `ws:${data.owner}`;
    graph.addNode(wsId, {
      x: 0,
      y: 0,
      size: 48,
      label: "",
      color: "#0f0f1a",
      nodeType: "workspace",
      type: "image",
      image: "/forgely-icon.png",
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
        color: getSevColor(sev),
        borderColor: getSevBorder(sev),
        nodeType: "repo",
        slug: repo.slug,
        max_severity: sev,
      });
      graph.addEdge(wsId, repo.slug, {
        size: 2,
        color: "rgba(70,130,210,0.5)",
        type: "curvedArrow",
        curvature: 0.15,
      });
    });

    const sigma = new Sigma(graph, container, {
      defaultNodeColor: "#4a90d9",
      defaultEdgeColor: "rgba(120,130,180,0.25)",
      labelFont: "Inter, system-ui, sans-serif",
      labelSize: 12,
      labelWeight: "500",
      labelColor: { color: "#c8cadf" },
      renderEdgeLabels: false,
      minCameraRatio: 0.05,
      maxCameraRatio: 8,
      defaultEdgeType: "curvedArrow",
      nodeProgramClasses: { image: NodeImageProgram },
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

    /* Click handlers */
    sigma.on("clickNode", ({ node }) => {
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

  /* Refresh node/edge reducers when selection changes without rebuilding */
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;
    sigma.setSetting("nodeReducer", (node, attrs) => {
      const isSelected = node === selectedRepo || (attrs.nodeType === "workspace" && workspaceSelected);
      const baseSize = attrs.nodeType === "workspace" ? 48 : (attrs.size as number ?? 14);
      const hidden = !!selectedRepo && attrs.nodeType === "repo" && node !== selectedRepo;
      return {
        ...attrs,
        size: isSelected ? baseSize * 1.2 : baseSize,
        zIndex: isSelected ? 2 : 1,
        highlighted: isSelected,
        hidden,
      };
    });
    sigma.setSetting("edgeReducer", (edge, attrs) => {
      if (!selectedRepo) return attrs;
      const src = graph.source(edge);
      const tgt = graph.target(edge);
      return { ...attrs, hidden: src !== selectedRepo && tgt !== selectedRepo };
    });
    sigma.refresh();
  }, [selectedRepo, workspaceSelected]);

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
          <button className="graph-nav-btn" title="Pan Up"    onClick={() => { const c = cam(); if (c) c.animate({ y: c.y + 0.1 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <div className="graph-nav-row">
            <button className="graph-nav-btn" title="Pan Left"  onClick={() => { const c = cam(); if (c) c.animate({ x: c.x - 0.1 }, { duration: 200 }); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button className="graph-nav-btn" title="Pan Right" onClick={() => { const c = cam(); if (c) c.animate({ x: c.x + 0.1 }, { duration: 200 }); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <button className="graph-nav-btn" title="Pan Down"  onClick={() => { const c = cam(); if (c) c.animate({ y: c.y - 0.1 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>

        {/* Zoom cluster */}
        <div className="graph-zoom-cluster">
          <button className="graph-nav-btn" title="Zoom In"  onClick={() => { const c = cam(); if (c) c.animate({ ratio: c.ratio / 1.3 }, { duration: 200 }); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button className="graph-nav-btn" title="Zoom Out" onClick={() => { const c = cam(); if (c) c.animate({ ratio: c.ratio * 1.3 }, { duration: 200 }); }}>
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
          <button className="graph-refresh-btn" onClick={onRefresh} title="Refresh Data">↻</button>
        )}
      </div>
    </div>
  );
}
