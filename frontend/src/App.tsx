import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGraphData } from "./hooks/useGraphData";
import GraphCanvas from "./components/GraphCanvas";
import OrgGraphCanvas from "./components/OrgGraphCanvas";
import OrgLeftPanel from "./components/OrgLeftPanel";
import OrgSidePanel from "./components/OrgSidePanel";
import OrgLegend from "./components/OrgLegend";
import SidePanel from "./components/SidePanel";
import AttackGraphPanel from "./components/AttackGraphPanel";
import SearchBar from "./components/SearchBar";
import FilterBar from "./components/FilterBar";
import RepoSelector from "./components/RepoSelector";
import WorkspaceSelector from "./components/WorkspaceSelector";
import Legend from "./components/Legend";
import LoadingIndicator from "./components/LoadingIndicator";
import ConnectModal from "./components/ConnectModal";
import OrgSearchBar from "./components/OrgSearchBar";
import { apiFetch, getApiKey, clearApiKey } from "./lib/auth";
import type { FilterType, LayoutType, EdgeStyle, OrgGraphResponse, OrgNodeFilter } from "./types";

type TabType = "packages" | "organisation";

export default function App() {
  const { data, loading, error, fetchGraph } = useGraphData();

  const [tab, setTab] = useState<TabType>("packages");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedNodeY, setSelectedNodeY] = useState<number>(200);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [formatFilter, setFormatFilter] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutType>("force");
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>("curved");
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [hideSharedCveEdges, setHideSharedCveEdges] = useState(false);
  const [hideDependencies, setHideDependencies] = useState(false);
  const [hideUnsupported, setHideUnsupported] = useState(false);
  const [hideCriticalAnimation, setHideCriticalAnimation] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [hasKey, setHasKey] = useState(!!getApiKey());
  const [repoRefreshKey, setRepoRefreshKey] = useState(0);

  /* Org graph state */
  const [orgData, setOrgData] = useState<OrgGraphResponse | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgSelectedNode, setOrgSelectedNode] = useState<string | null>(null);
  const [orgPanelExpanded, setOrgPanelExpanded] = useState(false);
  const [orgLayout, setOrgLayout] = useState<LayoutType>("radial");
  const [orgEdgeStyle, setOrgEdgeStyle] = useState<EdgeStyle>("curved");
  const [orgFilter, setOrgFilter] = useState<OrgNodeFilter>("all");
  const [orgSearchResults, setOrgSearchResults] = useState<string[]>([]);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [attackGraphOpen, setAttackGraphOpen] = useState(false);

  /* Auto-switch edge style when layout changes */
  const handleLayoutChange = useCallback((l: LayoutType) => {
    setLayout(l);
    if (l === "tree" || l === "horizontal") {
      setEdgeStyle("straight");
    } else {
      setEdgeStyle("curved");
    }
  }, []);

  const handleOrgLayoutChange = useCallback((l: LayoutType) => {
    setOrgLayout(l);
    if (l === "tree" || l === "horizontal") {
      setOrgEdgeStyle("straight");
    } else {
      setOrgEdgeStyle("curved");
    }
  }, []);

  /* Load defaults from backend config on mount */
  useEffect(() => {
    apiFetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.has_key || getApiKey()) setHasKey(true);
        if (cfg.owner) setOwner(cfg.owner);
        if (cfg.repo) setRepo(cfg.repo);
        if (cfg.owner && cfg.repo && (cfg.has_key || getApiKey())) {
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

  /* Fetch org graph when switching to org tab */
  const fetchOrgGraph = useCallback(async (orgOwner: string) => {
    if (!orgOwner) return;
    setOrgLoading(true);
    setOrgError(null);
    try {
      const resp = await apiFetch(`/api/org-graph?owner=${encodeURIComponent(orgOwner)}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${resp.status}`);
      }
      const json: OrgGraphResponse = await resp.json();
      setOrgData(json);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to fetch org graph");
    } finally {
      setOrgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "organisation" && owner && !orgData) {
      fetchOrgGraph(owner);
    }
  }, [tab, owner, orgData, fetchOrgGraph]);

  /* Handle org workspace change */
  const handleOrgOwnerChange = useCallback((newOwner: string) => {
    setOwner(newOwner);
    setOrgData(null);
    setOrgSelectedNode(null);
    fetchOrgGraph(newOwner);
  }, [fetchOrgGraph]);

  const handleOrgRefresh = useCallback(() => {
    if (owner) {
      setOrgData(null);
      setOrgSelectedNode(null);
      fetchOrgGraph(owner);
    }
  }, [owner, fetchOrgGraph]);

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
    <div className={`app${panelCollapsed ? " panel-collapsed" : ""}`}>
      {/* Panel collapse toggle */}
      <button
        className={`panel-toggle${panelCollapsed ? " collapsed" : ""}`}
        onClick={() => setPanelCollapsed((v) => !v)}
        title={panelCollapsed ? "Show panel" : "Hide panel"}
      >
        {panelCollapsed ? "›" : "‹"}
      </button>

      {/* Left control panel */}
      {tab === "packages" && (
        <FilterBar
          filter={filter}
          stats={data?.stats ?? null}
          hideSharedCveEdges={hideSharedCveEdges}
          hideDependencies={hideDependencies}
          hideUnsupported={hideUnsupported}
          hideCriticalAnimation={hideCriticalAnimation}
          hasKey={hasKey}
          tab={tab}
          onTabChange={(t) => { setTab(t); if (t === "organisation") setSelectedNode(null); }}
          onFilterChange={setFilter}
          onHideSharedCveEdgesChange={setHideSharedCveEdges}
          onHideDependenciesChange={setHideDependencies}
          onHideUnsupportedChange={setHideUnsupported}
          onHideCriticalAnimationChange={setHideCriticalAnimation}
          onConnectClick={() => setConnectOpen(true)}
          onDisconnect={() => { clearApiKey(); setHasKey(false); }}
        />
      )}
      {tab === "organisation" && (
        <OrgLeftPanel
          orgData={orgData}
          hasKey={hasKey}
          filter={orgFilter}
          onFilterChange={setOrgFilter}
          onTabChange={(t) => { setTab(t); setOrgSelectedNode(null); }}
          onConnectClick={() => setConnectOpen(true)}
          onDisconnect={() => { clearApiKey(); setHasKey(false); }}
        />
      )}

      {/* Top bar: repo selector + search (packages tab only) */}
      {tab === "packages" && (
        <div className="top-bar">
          <RepoSelector
            currentOwner={owner}
            currentRepo={repo}
            refreshKey={repoRefreshKey}
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
      )}

      {/* Top bar: workspace selector (workspace tab) */}
      {tab === "organisation" && (
        <div className="top-bar">
          <WorkspaceSelector
            currentOwner={owner}
            refreshKey={repoRefreshKey}
            onSelect={handleOrgOwnerChange}
          />
          {orgData && (
            <OrgSearchBar
              orgData={orgData}
              onHighlight={setOrgSearchResults}
              onNodeSelect={setOrgSelectedNode}
            />
          )}
        </div>
      )}

      <ConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={() => { setHasKey(!!getApiKey()); setRepoRefreshKey((k) => k + 1); setConnectOpen(false); }}
      />

      {/* Packages tab content */}
      {tab === "packages" && (
        <>
          {loading ? (
            <LoadingIndicator />
          ) : error && !data ? (
            <div className="graph-loading">
              <h2>Connection Error</h2>
              <p>{error}</p>
              <button className="btn btn-accent" onClick={handleRefresh}>Retry</button>
            </div>
          ) : data ? (
            <GraphCanvas
              data={data}
              selectedNode={selectedNode}
              hoveredNode={hoveredNode}
              filter={filter}
              formatFilter={formatFilter}
              layout={layout}
              edgeStyle={edgeStyle}
              searchResults={searchResults}
              hideSharedCveEdges={hideSharedCveEdges}
              hideDependencies={hideDependencies}
              hideUnsupported={hideUnsupported}
              hideCriticalAnimation={hideCriticalAnimation}
              onNodeSelect={setSelectedNode}
              onNodeHover={setHoveredNode}
              onNodeScreenY={(y) => { setSelectedNodeY(y); setPanelPos(null); }}
              onRefresh={handleRefresh}
              onLayoutChange={handleLayoutChange}
              onEdgeStyleChange={setEdgeStyle}
              onOpenAttackGraph={(nodeId) => { setSelectedNode(nodeId); setAttackGraphOpen(true); }}
            />
          ) : (
            <div className="empty-state">
              <p>Select a workspace and repository to visualize</p>
            </div>
          )}

          {selectedNode && data && !attackGraphOpen && (() => {
            const autoTop = Math.max(20, Math.min(selectedNodeY - 60, window.innerHeight - 480));
            const panelStyle = panelExpanded
              ? undefined
              : panelPos
                ? { top: panelPos.y, left: panelPos.x, right: "auto" as const }
                : { top: autoTop };

            const onToolbarMouseDown = (e: React.MouseEvent) => {
              if (panelExpanded || (e.target as HTMLElement).closest("button")) return;
              const panel = panelRef.current;
              if (!panel) return;
              const rect = panel.getBoundingClientRect();
              const startX = e.clientX, startY = e.clientY;
              const startLeft = rect.left, startTop = rect.top;
              let dx = 0, dy = 0;
              const onMove = (me: MouseEvent) => {
                dx = me.clientX - startX;
                dy = me.clientY - startY;
                panel.style.transform = `translate(${dx}px,${dy}px)`;
              };
              const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                panel.style.transform = "";
                const finalX = Math.max(0, Math.min(startLeft + dx, window.innerWidth - rect.width));
                const finalY = Math.max(0, Math.min(startTop + dy, window.innerHeight - 60));
                setPanelPos({ x: finalX, y: finalY });
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
              e.preventDefault();
            };

            return (
              <div ref={panelRef} className={`panel-overlay${panelExpanded ? " panel-overlay-expanded" : ""}`} style={panelStyle}>
                <div className="panel-toolbar" onMouseDown={onToolbarMouseDown}>
                  <button className="panel-expand-btn" onClick={() => setPanelExpanded(e => !e)} title={panelExpanded ? "Collapse panel" : "Expand panel"}>
                    {panelExpanded ? "⇥" : "⇤"}
                  </button>
                  <button className="panel-close" onClick={() => { setSelectedNode(null); setPanelExpanded(false); }}>×</button>
                </div>
                <SidePanel data={data} nodeId={selectedNode} owner={owner} repo={repo} expanded={panelExpanded} filter={filter} formatFilter={formatFilter} onFilterChange={setFilter} onFormatFilterChange={setFormatFilter} onNodeSelect={setSelectedNode} onOpenAttackGraph={() => setAttackGraphOpen(true)} />
              </div>
            );
          })()}

          {attackGraphOpen && selectedNode && data && (
            <div className="attack-graph-backdrop" onClick={() => setAttackGraphOpen(false)}>
              <div onClick={(e) => e.stopPropagation()}>
                <AttackGraphPanel
                  packageNodeId={selectedNode}
                  data={data}
                  owner={owner}
                  onClose={() => setAttackGraphOpen(false)}
                />
              </div>
            </div>
          )}

          <Legend />

        </>
      )}

      {/* Organisation tab content */}
      {tab === "organisation" && (
        <>
          {orgLoading ? (
            <LoadingIndicator variant="workspace" />
          ) : orgError && !orgData ? (
            <div className="graph-loading">
              <h2>Connection Error</h2>
              <p>{orgError}</p>
              <button className="btn btn-accent" onClick={() => owner && fetchOrgGraph(owner)}>Retry</button>
            </div>
          ) : orgData ? (
            <OrgGraphCanvas
              data={orgData}
              selectedNode={orgSelectedNode}
              layout={orgLayout}
              edgeStyle={orgEdgeStyle}
              filter={orgFilter}
              searchResults={orgSearchResults}
              onNodeSelect={setOrgSelectedNode}
              onLayoutChange={handleOrgLayoutChange}
              onEdgeStyleChange={setOrgEdgeStyle}
              onRefresh={handleOrgRefresh}
            />
          ) : (
            <div className="empty-state">
              <p>Select a workspace to view workspace graph</p>
            </div>
          )}

          {orgSelectedNode && orgData && (
            <div className={`panel-overlay${orgPanelExpanded ? " panel-overlay-expanded" : ""}`}>
              <div className="panel-toolbar">
                <button className="panel-expand-btn" onClick={() => setOrgPanelExpanded(e => !e)} title={orgPanelExpanded ? "Collapse panel" : "Expand panel"}>
                  {orgPanelExpanded ? "⇥" : "⇤"}
                </button>
                <button className="panel-close" onClick={() => { setOrgSelectedNode(null); setOrgPanelExpanded(false); }}>×</button>
              </div>
              <OrgSidePanel data={orgData} nodeId={orgSelectedNode} onNodeSelect={setOrgSelectedNode} expanded={orgPanelExpanded} />
            </div>
          )}

          <OrgLegend />

        </>
      )}
    </div>
  );
}
