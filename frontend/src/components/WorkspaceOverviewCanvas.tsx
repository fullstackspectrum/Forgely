import { useEffect, useRef, useCallback } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import { SEVERITY_COLORS } from "../types";
import type { WorkspaceOverviewResponse } from "../types";

interface Props {
  data: WorkspaceOverviewResponse;
  selectedRepo: string | null;
  onRepoSelect: (slug: string | null) => void;
  onLoadFullGraph: (slug: string) => void;
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

export default function WorkspaceOverviewCanvas({
  data,
  selectedRepo,
  onRepoSelect,
  onLoadFullGraph,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

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

    /* Workspace centre node */
    const wsId = `ws:${data.owner}`;
    graph.addNode(wsId, {
      x: 0,
      y: 0,
      size: 22,
      label: data.owner,
      color: "#4a90d9",
      borderColor: "#6ab4ff",
      nodeType: "workspace",
    });

    /* Repo nodes arranged in a circle */
    const repos = data.repos;
    const radius = Math.max(3, repos.length * 0.45);
    repos.forEach((repo, i) => {
      const angle = (2 * Math.PI * i) / repos.length - Math.PI / 2;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      const sev = repo.max_severity;
      graph.addNode(repo.slug, {
        x,
        y,
        size: 14,
        label: repo.name,
        color: getSevColor(sev),
        borderColor: getSevBorder(sev),
        nodeType: "repo",
        slug: repo.slug,
        max_severity: sev,
      });
      graph.addEdge(wsId, repo.slug, {
        size: 1.5,
        color: "rgba(120,130,180,0.3)",
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
      nodeReducer: (node, attrs) => {
        const isSelected = node === selectedRepo;
        const size = attrs.nodeType === "workspace" ? 22 : 14;
        return {
          ...attrs,
          size: isSelected ? size * 1.35 : size,
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
        onRepoSelect(null);
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

  /* Refresh node reducer when selection changes without rebuilding */
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setSetting("nodeReducer", (node, attrs) => {
      const isSelected = node === selectedRepo;
      const size = attrs.nodeType === "workspace" ? 22 : 14;
      return {
        ...attrs,
        size: isSelected ? size * 1.35 : size,
        zIndex: isSelected ? 2 : 1,
        highlighted: isSelected,
      };
    });
    sigma.refresh();
  }, [selectedRepo]);

  return (
    <div className="workspace-overview-wrapper">
      <div className="workspace-overview-legend">
        {(["Critical", "High", "Medium", "Low", "None"] as const).map((sev) => (
          <span key={sev} className="wo-legend-item">
            <span className="wo-legend-dot" style={{ background: getSevColor(sev) }} />
            {sev === "None" ? "Safe" : sev}
          </span>
        ))}
        <span className="wo-legend-item">
          <span className="wo-legend-dot" style={{ background: "#555577" }} />
          Unscanned
        </span>
      </div>
      <div className="workspace-overview-canvas" ref={containerRef} />
    </div>
  );
}
