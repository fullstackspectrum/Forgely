import { useMemo, useState } from "react";
import { useGraphData } from "./hooks/useGraphData";
import GraphCanvas from "./components/GraphCanvas";
import SidePanel from "./components/SidePanel";
import SearchBar from "./components/SearchBar";
import FilterBar from "./components/FilterBar";
import Legend from "./components/Legend";
import type { FilterType, LayoutType } from "./types";

export default function App() {
  const { data, loading, error, refresh } = useGraphData();

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [layout, setLayout] = useState<LayoutType>("force");
  const [searchResults, setSearchResults] = useState<string[]>([]);

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

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Fetching Cloudsmith data…</p>
        <p className="loading-sub">
          Scanning packages and vulnerabilities
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-screen">
        <h2>Connection Error</h2>
        <p>{error}</p>
        <button className="btn btn-accent" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="app">
      {/* Left control panel */}
      <FilterBar
        filter={filter}
        layout={layout}
        stats={data.stats}
        onFilterChange={setFilter}
        onLayoutChange={setLayout}
        onRefresh={refresh}
      />

      {/* Top search bar */}
      <div className="top-search">
        <SearchBar onSearch={setSearchResults} cveIndex={cveIndex} />
      </div>

      {/* Graph */}
      <GraphCanvas
        data={data}
        selectedNode={selectedNode}
        hoveredNode={hoveredNode}
        filter={filter}
        layout={layout}
        searchResults={searchResults}
        onNodeSelect={setSelectedNode}
        onNodeHover={setHoveredNode}
      />

      {/* Side panel */}
      {selectedNode && (
        <div className="panel-overlay">
          <button
            className="panel-close"
            onClick={() => setSelectedNode(null)}
          >
            ×
          </button>
          <SidePanel data={data} nodeId={selectedNode} />
        </div>
      )}

      {/* Legend */}
      <Legend />

      {/* Repo info badge */}
      <div className="repo-badge">
        {data.owner}/{data.repo}
      </div>
    </div>
  );
}
