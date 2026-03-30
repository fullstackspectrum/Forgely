import { useCallback, useEffect, useMemo, useState } from "react";
import { useGraphData } from "./hooks/useGraphData";
import GraphCanvas from "./components/GraphCanvas";
import SidePanel from "./components/SidePanel";
import SearchBar from "./components/SearchBar";
import FilterBar from "./components/FilterBar";
import RepoSelector from "./components/RepoSelector";
import Legend from "./components/Legend";
import LoadingIndicator from "./components/LoadingIndicator";
import type { FilterType, LayoutType, EdgeStyle } from "./types";

export default function App() {
  const { data, loading, error, fetchGraph } = useGraphData();

  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [layout, setLayout] = useState<LayoutType>("force");
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>("curved");
  const [searchResults, setSearchResults] = useState<string[]>([]);

  /* Auto-switch edge style when layout changes */
  const handleLayoutChange = useCallback((l: LayoutType) => {
    setLayout(l);
    if (l === "tree" || l === "horizontal") {
      setEdgeStyle("straight");
    } else {
      setEdgeStyle("curved");
    }
  }, []);

  /* Load defaults from backend config on mount */
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.owner) setOwner(cfg.owner);
        if (cfg.repo) setRepo(cfg.repo);
        /* Auto-load graph if defaults are set */
        if (cfg.owner && cfg.repo) {
          fetchGraph(cfg.owner, cfg.repo);
        }
      })
      .catch(() => {});
  }, [fetchGraph]);

  const handleRepoSelect = useCallback(
    (newOwner: string, newRepo: string) => {
      setOwner(newOwner);
      setRepo(newRepo);
      setSelectedNode(null);
      setSearchResults([]);
      fetchGraph(newOwner, newRepo);
    },
    [fetchGraph],
  );

  const handleRefresh = useCallback(() => {
    if (owner && repo) {
      fetchGraph(owner, repo, true);
    }
  }, [owner, repo, fetchGraph]);

  /* Build CVE → package ID reverse index for search */
  const cveIndex = useMemo(() => {
    if (!data) return {};
    const idx: Record<string, string[]> = {};
    for (const node of data.nodes) {
      for (const cve of node.data.cves) {
        if (!cve.id) continue;
        const key = cve.id.toUpperCase();
        if (!idx[key]) idx[key] = [];
        if (!idx[key].includes(node.id)) idx[key].push(node.id);
      }
    }
    return idx;
  }, [data]);

  /* All node IDs currently in the graph */
  const graphNodeIds = useMemo(() => {
    if (!data) return [];
    return data.nodes.map((n) => n.id);
  }, [data]);

  return (
    <div className="app">
      {/* Left control panel */}
      <FilterBar
        filter={filter}
        stats={data?.stats ?? null}
        onFilterChange={setFilter}
      />

      {/* Top bar: repo selector + search */}
      <div className="top-bar">
        <RepoSelector
          currentOwner={owner}
          currentRepo={repo}
          onSelect={handleRepoSelect}
        />
        {owner && repo && (
          <SearchBar
            owner={owner}
            repo={repo}
            graphNodeIds={graphNodeIds}
            onHighlight={setSearchResults}
            onNodeSelect={setSelectedNode}
            cveIndex={cveIndex}
          />
        )}
      </div>

      {/* Graph */}
      {loading ? (
        <LoadingIndicator />
      ) : error && !data ? (
        <div className="graph-loading">
          <h2>Connection Error</h2>
          <p>{error}</p>
          <button className="btn btn-accent" onClick={handleRefresh}>
            Retry
          </button>
        </div>
      ) : data ? (
        <GraphCanvas
          data={data}
          selectedNode={selectedNode}
          hoveredNode={hoveredNode}
          filter={filter}
          layout={layout}
          edgeStyle={edgeStyle}
          searchResults={searchResults}
          onNodeSelect={setSelectedNode}
          onNodeHover={setHoveredNode}
          onRefresh={handleRefresh}
          onLayoutChange={handleLayoutChange}
          onEdgeStyleChange={setEdgeStyle}
        />
      ) : (
        <div className="empty-state">
          <p>Select a workspace and repository to visualize</p>
        </div>
      )}

      {/* Side panel */}
      {selectedNode && data && (
        <div className="panel-overlay">
          <button
            className="panel-close"
            onClick={() => setSelectedNode(null)}
          >
            ×
          </button>
          <SidePanel data={data} nodeId={selectedNode} owner={owner} repo={repo} />
        </div>
      )}

      {/* Legend */}
      <Legend />

      {/* Repo info badge */}
      {data && (
        <div className="repo-badge">
          {data.owner}/{data.repo}
        </div>
      )}
    </div>
  );
}
