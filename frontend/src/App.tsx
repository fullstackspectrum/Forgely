import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGraphData } from "./hooks/useGraphData";
import GraphCanvas from "./components/GraphCanvas";
import OrgGraphCanvas from "./components/OrgGraphCanvas";
import OrgLeftPanel from "./components/OrgLeftPanel";
import OrgSidePanel from "./components/OrgSidePanel";
import OrgLegend from "./components/OrgLegend";
import SidePanel from "./components/SidePanel";
import AttackGraphPanel from "./components/AttackGraphPanel";
import CiemAttackPathPanel from "./components/CiemAttackPathPanel";
import SearchBar from "./components/SearchBar";
import FilterBar from "./components/FilterBar";
import RepoSelector from "./components/RepoSelector";
import WorkspaceSelector from "./components/WorkspaceSelector";
import WorkspaceOverviewCanvas from "./components/WorkspaceOverviewCanvas";
import WorkspaceRepoPanel from "./components/WorkspaceRepoPanel";
import WorkspaceOverviewPanel from "./components/WorkspaceOverviewPanel";
import Legend from "./components/Legend";
import LoadingIndicator from "./components/LoadingIndicator";
import ConnectModal from "./components/ConnectModal";
import SettingsDialog from "./components/SettingsDialog";
import OrgSearchBar from "./components/OrgSearchBar";
import { apiFetch, getApiKey, clearApiKey } from "./lib/auth";
import { applyTheme, resolveTheme, storedTheme, watchSystemTheme, type Theme } from "./lib/theme";
import { loadSettings, saveSetting, resetSettings, type Settings } from "./lib/settings";
import type { FilterType, LayoutType, EdgeStyle, OrgGraphResponse, WorkspaceOverviewResponse } from "./types";

type TabType = "packages" | "organisation";

export default function App() {
  const { data, loading, error, progress, fetchGraph } = useGraphData();

  const [tab, setTab] = useState<TabType>("packages");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [filterFlags, setFilterFlags] = useState<Set<string>>(new Set());
  const [filterFlagsMode, setFilterFlagsMode] = useState<"and" | "or">("and");
  const [formatFilter, setFormatFilter] = useState<string | null>(null);
  /* Seeded from disk, then written back on every change. Read once: a second
     loadSettings() during render would re-read localStorage on every keystroke
     elsewhere in the app. */
  const [settings] = useState(loadSettings);
  const [layout, setLayout] = useState<LayoutType>(settings.layout);
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>(settings.edgeStyle);
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [hideSharedCveEdges, setHideSharedCveEdges] = useState(settings.hideSharedCveEdges);
  const [hideDependencies, setHideDependencies] = useState(settings.hideDependencies);
  const [hideUnsupported, setHideUnsupported] = useState(settings.hideUnsupported);
  const [hideCriticalAnimation, setHideCriticalAnimation] = useState(settings.hideCriticalAnimation);
  const [connectOpen, setConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [legendCollapsed, setLegendCollapsed] = useState(settings.legendCollapsed);
  const [hasKey, setHasKey] = useState(!!getApiKey());
  const [repoRefreshKey, setRepoRefreshKey] = useState(0);

  /* Theme. The boot script in index.html has already set data-theme before
     first paint; this picks up the same stored value so the UI agrees with it. */
  const [theme, setTheme] = useState<Theme>(() => storedTheme());
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(storedTheme()));

  const changeTheme = useCallback((t: Theme) => {
    applyTheme(t);
    setTheme(t);
    setResolvedTheme(resolveTheme(t));
  }, []);

  /* Follow the OS only while set to "system". */
  useEffect(() => {
    if (theme !== "system") return;
    return watchSystemTheme(() => {
      applyTheme("system");
      setResolvedTheme(resolveTheme("system"));
    });
  }, [theme]);

  /* Org graph state */
  const [orgData, setOrgData] = useState<OrgGraphResponse | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgSelectedNode, setOrgSelectedNode] = useState<string | null>(null);
  const [orgPanelExpanded, setOrgPanelExpanded] = useState(false);
  const [orgPanelPos, setOrgPanelPos] = useState<{ x: number; y: number } | null>(null);
  const orgPanelRef = useRef<HTMLDivElement>(null);
  const [orgLayout, setOrgLayout] = useState<LayoutType>("radial");
  const [orgEdgeStyle, setOrgEdgeStyle] = useState<EdgeStyle>("curved");
  /* Empty means every type. Several types at once is a union — a node has
     exactly one type, so there is nothing for an AND to match. */
  const [orgFilters, setOrgFilters] = useState<Set<string>>(new Set());
  const [orgSearchResults, setOrgSearchResults] = useState<string[]>([]);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [attackGraphOpen, setAttackGraphOpen] = useState(false);
  const [ciemAttackPathOpen, setCiemAttackPathOpen] = useState(false);
  const [apiToast, setApiToast] = useState<string | null>(null);
  const [topBarCollapsed, setTopBarCollapsed] = useState(false);

  /* Workspace package overview state */
  const [viewMode, setViewMode] = useState<"graph" | "workspace">("graph");
  const [workspaceOverviewData, setWorkspaceOverviewData] = useState<WorkspaceOverviewResponse | null>(null);
  const [workspaceOverviewLoading, setWorkspaceOverviewLoading] = useState(false);
  const [workspaceOverviewError, setWorkspaceOverviewError] = useState<string | null>(null);
  const [selectedWorkspaceRepo, setSelectedWorkspaceRepo] = useState<string | null>(null);
  const [workspaceRepoInitialQuery, setWorkspaceRepoInitialQuery] = useState<string>("");
  const [workspaceFormatFilter, setWorkspaceFormatFilter] = useState<Set<string>>(new Set());
  const [workspaceNodeSelected, setWorkspaceNodeSelected] = useState(false);
  const woPanelRef = useRef<HTMLDivElement>(null);
  const [woPanelPos, setWoPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [woPanelExpanded, setWoPanelExpanded] = useState(false);

  /* Apply a setting and remember it. Everything routed through here survives
     a reload; anything calling the raw setter does not. */
  const persist = useCallback(
    <K extends keyof Settings>(key: K, set: (v: Settings[K]) => void) =>
      (v: Settings[K]) => { set(v); saveSetting(key, v); },
    [],
  );

  const toggleLegend = useCallback(() => {
    setLegendCollapsed((c) => {
      const next = !c;
      saveSetting("legendCollapsed", next);
      return next;
    });
  }, []);

  const changeEdgeStyle = useMemo(
    () => persist("edgeStyle", setEdgeStyle as (v: EdgeStyle) => void),
    [persist],
  );

  /* Auto-switch edge style when layout changes */
  const handleLayoutChange = useCallback((l: LayoutType) => {
    setLayout(l);
    saveSetting("layout", l);
    /* Tree and horizontal read as hierarchies; curves make the levels hard to
       follow. The derived choice is stored too, or a reload would restore a
       layout with the wrong edges. */
    const style: EdgeStyle = l === "tree" || l === "horizontal" ? "straight" : "curved";
    setEdgeStyle(style);
    saveSetting("edgeStyle", style);
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
      setSelectedWorkspaceRepo(null);
      setViewMode("graph");
      fetchGraph(newOwner, newRepo);
    },
    [fetchGraph],
  );

  const handleRefresh = useCallback(() => {
    if (owner && repo) {
      fetchGraph(owner, repo, true);
    }
  }, [owner, repo, fetchGraph]);

  const handleLoadWorkspaceOverview = useCallback(async (wsOwner: string, refresh = false) => {
    setOwner(wsOwner);
    setSelectedWorkspaceRepo(null);
    setWorkspaceNodeSelected(false);
    setSelectedNode(null);

    // If we already have fresh data for this owner and it's not a forced refresh, just switch view
    if (!refresh && workspaceOverviewData?.owner === wsOwner) {
      setViewMode("workspace");
      return;
    }

    setWorkspaceOverviewLoading(true);
    setWorkspaceOverviewError(null);
    try {
      const url = `/api/workspace-overview?owner=${encodeURIComponent(wsOwner)}${refresh ? "&refresh=true" : ""}`;
      const resp = await apiFetch(url);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(resp.status === 401
          ? `401: ${body.detail || "Authentication required"}`
          : body.detail || `HTTP ${resp.status}`);
      }
      const json: WorkspaceOverviewResponse = await resp.json();
      setWorkspaceOverviewData(json);
      setViewMode("workspace");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load workspace overview";
      setWorkspaceOverviewError(msg);
      setApiToast(msg);
    } finally {
      setWorkspaceOverviewLoading(false);
    }
  }, [workspaceOverviewData]);

  /* Fetch org graph when switching to org tab */
  const fetchOrgGraph = useCallback(async (orgOwner: string, forceRefresh = false) => {
    if (!orgOwner) return;
    setOrgLoading(true);
    setOrgError(null);
    try {
      const url = `/api/org-graph?owner=${encodeURIComponent(orgOwner)}${forceRefresh ? "&refresh=true" : ""}`;
      const resp = await apiFetch(url);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(resp.status === 401
          ? `401: ${body.detail || "Authentication required"}`
          : body.detail || `HTTP ${resp.status}`);
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
    if (tab === "organisation" && owner && !orgData && !orgLoading) {
      fetchOrgGraph(owner);
    }
  }, [tab, owner, orgData, orgLoading, fetchOrgGraph]);

  /* Handle org workspace change */
  const handleOrgOwnerChange = useCallback((newOwner: string) => {
    setOwner(newOwner);
    setOrgData(null);
    setOrgSelectedNode(null);
    fetchOrgGraph(newOwner);
  }, [fetchOrgGraph]);

  const handleOrgRefresh = useCallback(() => {
    if (owner) {
      setOrgSelectedNode(null);
      fetchOrgGraph(owner, true);
    }
  }, [owner, fetchOrgGraph]);

  /* Surface API errors as a toast, regardless of whether data is already loaded */
  useEffect(() => { if (error) setApiToast(error); }, [error]);
  useEffect(() => { if (orgError) setApiToast(orgError); }, [orgError]);

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
          filterFlags={filterFlags}
          filterFlagsMode={filterFlagsMode}
          hasKey={hasKey}
          tab={tab}
          disabled={viewMode === "workspace"}
          onTabChange={(t) => { setTab(t); if (t === "organisation") setSelectedNode(null); }}
          onFilterChange={setFilter}
          onFilterFlagsChange={setFilterFlags}
          onFilterFlagsModeChange={setFilterFlagsMode}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {tab === "organisation" && (
        <OrgLeftPanel
          orgData={orgData}
          hasKey={hasKey}
          filters={orgFilters}
          onFiltersChange={setOrgFilters}
          onTabChange={(t) => { setTab(t); setOrgSelectedNode(null); }}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAttackPaths={() => setCiemAttackPathOpen(true)}
        />
      )}

      {/* Top bar: repo selector + search (packages tab only) */}
      {tab === "packages" && (
        <div className={`top-bar${topBarCollapsed ? " top-bar-collapsed" : ""}`}>
          {!topBarCollapsed && (
            <>
              <RepoSelector
                currentOwner={owner}
                currentRepo={repo}
                refreshKey={repoRefreshKey}
                onSelect={handleRepoSelect}
                onOverview={handleLoadWorkspaceOverview}
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
            </>
          )}
          <button className="collapse-toggle-btn" onClick={() => setTopBarCollapsed(c => !c)} title={topBarCollapsed ? "Show controls" : "Hide controls"}>
            {topBarCollapsed ? "▼" : "▲"}
          </button>
        </div>
      )}

      {/* Top bar: workspace selector (workspace tab) */}
      {tab === "organisation" && (
        <div className={`top-bar${topBarCollapsed ? " top-bar-collapsed" : ""}`}>
          {!topBarCollapsed && (
            <>
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
            </>
          )}
          <button className="collapse-toggle-btn" onClick={() => setTopBarCollapsed(c => !c)} title={topBarCollapsed ? "Show controls" : "Hide controls"}>
            {topBarCollapsed ? "▼" : "▲"}
          </button>
        </div>
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={changeTheme}
        hideSharedCveEdges={hideSharedCveEdges}
        hideDependencies={hideDependencies}
        hideUnsupported={hideUnsupported}
        hideCriticalAnimation={hideCriticalAnimation}
        onHideSharedCveEdgesChange={persist("hideSharedCveEdges", setHideSharedCveEdges)}
        onHideDependenciesChange={persist("hideDependencies", setHideDependencies)}
        onHideUnsupportedChange={persist("hideUnsupported", setHideUnsupported)}
        onHideCriticalAnimationChange={persist("hideCriticalAnimation", setHideCriticalAnimation)}
        edgeStyle={edgeStyle}
        onEdgeStyleChange={changeEdgeStyle}
        hasKey={hasKey}
        onConnectClick={() => setConnectOpen(true)}
        onDisconnect={() => { clearApiKey(); setHasKey(false); }}
        onReset={() => {
          const d = resetSettings();
          setHideSharedCveEdges(d.hideSharedCveEdges);
          setHideDependencies(d.hideDependencies);
          setHideUnsupported(d.hideUnsupported);
          setHideCriticalAnimation(d.hideCriticalAnimation);
          setEdgeStyle(d.edgeStyle);
          setLayout(d.layout);
          setLegendCollapsed(d.legendCollapsed);
        }}
      />

      <ConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={() => { setHasKey(!!getApiKey()); setRepoRefreshKey((k) => k + 1); setConnectOpen(false); }}
      />

      {/* Packages tab content */}
      {tab === "packages" && (
        <>
          {(loading || workspaceOverviewLoading) ? (
            <LoadingIndicator
              variant={workspaceOverviewLoading ? "workspace-overview" : "packages"}
              progress={progress}
            />
          ) : error && !data && !workspaceOverviewData ? (
            <div className="graph-loading">
              <h2>Couldn't load this repository</h2>
              <p>{error || workspaceOverviewError}</p>
              <button className="btn btn-accent" onClick={handleRefresh}>Retry</button>
            </div>
          ) : viewMode === "workspace" && workspaceOverviewData ? (
            <WorkspaceOverviewCanvas
              data={workspaceOverviewData}
              selectedRepo={selectedWorkspaceRepo}
              workspaceSelected={workspaceNodeSelected}
              formatFilter={workspaceFormatFilter}
              onRepoSelect={(slug) => { setSelectedWorkspaceRepo(slug); setWorkspaceNodeSelected(false); }}
              onWorkspaceSelect={() => { setWorkspaceNodeSelected(true); setSelectedWorkspaceRepo(null); }}
              onLoadFullGraph={(slug) => handleRepoSelect(owner, slug)}
              onRefresh={() => handleLoadWorkspaceOverview(owner, true)}
            />
          ) : data ? (
            <GraphCanvas
              theme={resolvedTheme}
              data={data}
              selectedNode={selectedNode}
              hoveredNode={hoveredNode}
              filter={filter}
              filterFlags={filterFlags}
              filterFlagsMode={filterFlagsMode}
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

              onRefresh={handleRefresh}
              onLayoutChange={handleLayoutChange}
              onEdgeStyleChange={changeEdgeStyle}
              onOpenAttackGraph={(nodeId) => { setSelectedNode(nodeId); setAttackGraphOpen(true); }}
            />
          ) : (
            <div className="empty-state">
              {/* The mark is the displacement illustration §7 asks for — a grid
                  with one cell knocked out of line. No invented artwork needed. */}
              <img src="/forgely-icon.svg" alt="" className="empty-state-mark" />
              <h2>Start with a repository</h2>
              <p>Forgely maps every package in it, and everything its vulnerabilities reach.</p>
              <p className="empty-state-hint">Pick a workspace and repository above.</p>
            </div>
          )}

          {selectedNode && data && !attackGraphOpen && (() => {
            const defaultTop = 84;
            const defaultLeft = panelCollapsed ? 48 : 280;
            const panelStyle = panelExpanded
              ? undefined
              : panelPos
                ? { top: panelPos.y, left: panelPos.x, right: "auto" as const }
                : { top: defaultTop, left: defaultLeft, right: "auto" as const };

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
                  <button className="panel-close" onClick={() => { setSelectedNode(null); setPanelExpanded(false); setPanelPos(null); }}>×</button>
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

          {/* Workspace node panel (whole-workspace summary) */}
          {viewMode === "workspace" && workspaceOverviewData && workspaceNodeSelected && (() => {
            const defaultTop = 84;
            const defaultLeft = panelCollapsed ? 48 : 280;
            const panelStyle = woPanelExpanded
              ? undefined
              : woPanelPos
                ? { top: woPanelPos.y, left: woPanelPos.x, right: "auto" as const }
                : { top: defaultTop, left: defaultLeft, right: "auto" as const };

            const onToolbarMouseDown = (e: React.MouseEvent) => {
              if (woPanelExpanded || (e.target as HTMLElement).closest("button")) return;
              const panel = woPanelRef.current;
              if (!panel) return;
              const rect = panel.getBoundingClientRect();
              const startX = e.clientX, startY = e.clientY;
              const startLeft = rect.left, startTop = rect.top;
              let dx = 0, dy = 0;
              const onMove = (me: MouseEvent) => { dx = me.clientX - startX; dy = me.clientY - startY; panel.style.transform = `translate(${dx}px,${dy}px)`; };
              const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                panel.style.transform = "";
                setWoPanelPos({ x: Math.max(0, Math.min(startLeft + dx, window.innerWidth - rect.width)), y: Math.max(0, Math.min(startTop + dy, window.innerHeight - 60)) });
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
              e.preventDefault();
            };

            return (
              <div ref={woPanelRef} className={`panel-overlay${woPanelExpanded ? " panel-overlay-expanded" : ""}`} style={panelStyle}>
                <div className="panel-toolbar" onMouseDown={onToolbarMouseDown}>
                  <button className="panel-expand-btn" onClick={() => setWoPanelExpanded(e => !e)} title={woPanelExpanded ? "Collapse panel" : "Expand panel"}>{woPanelExpanded ? "⇥" : "⇤"}</button>
                  <button className="panel-close" onClick={() => { setWorkspaceNodeSelected(false); setWoPanelExpanded(false); setWoPanelPos(null); }}>×</button>
                </div>
                <WorkspaceOverviewPanel
                  data={workspaceOverviewData}
                  onRepoSelect={(slug, q) => { setWorkspaceNodeSelected(false); setSelectedWorkspaceRepo(slug); setWorkspaceRepoInitialQuery(q ?? ""); }}
                  formatFilter={workspaceFormatFilter}
                  onFormatFilter={setWorkspaceFormatFilter}
                />
              </div>
            );
          })()}

          {/* Workspace overview repo panel */}
          {viewMode === "workspace" && workspaceOverviewData && selectedWorkspaceRepo && (() => {
            const repoData = workspaceOverviewData.repos.find((r) => r.slug === selectedWorkspaceRepo);
            if (!repoData) return null;
            const defaultTop = 84;
            const defaultLeft = panelCollapsed ? 48 : 280;
            const panelStyle = woPanelExpanded
              ? undefined
              : woPanelPos
                ? { top: woPanelPos.y, left: woPanelPos.x, right: "auto" as const }
                : { top: defaultTop, left: defaultLeft, right: "auto" as const };

            const onToolbarMouseDown = (e: React.MouseEvent) => {
              if (woPanelExpanded || (e.target as HTMLElement).closest("button")) return;
              const panel = woPanelRef.current;
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
                setWoPanelPos({ x: finalX, y: finalY });
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
              e.preventDefault();
            };

            return (
              <div ref={woPanelRef} className={`panel-overlay${woPanelExpanded ? " panel-overlay-expanded" : ""}`} style={panelStyle}>
                <div className="panel-toolbar" onMouseDown={onToolbarMouseDown}>
                  <button className="panel-expand-btn" onClick={() => setWoPanelExpanded(e => !e)} title={woPanelExpanded ? "Collapse panel" : "Expand panel"}>
                    {woPanelExpanded ? "⇥" : "⇤"}
                  </button>
                  <button className="panel-close" onClick={() => { setSelectedWorkspaceRepo(null); setWorkspaceRepoInitialQuery(""); setWoPanelExpanded(false); setWoPanelPos(null); }}>×</button>
                </div>
                <WorkspaceRepoPanel
                  data={repoData}
                  owner={owner}
                  expanded={woPanelExpanded}
                  initialQuery={workspaceRepoInitialQuery}
                  onLoadFullGraph={() => handleRepoSelect(owner, selectedWorkspaceRepo)}
                  onClose={() => { setSelectedWorkspaceRepo(null); setWorkspaceRepoInitialQuery(""); }}
                />
              </div>
            );
          })()}

          {viewMode !== "workspace" && <Legend collapsed={legendCollapsed} onToggle={toggleLegend} />}

        </>
      )}

      {/* Organisation tab content */}
      {tab === "organisation" && (
        <>
          {orgLoading ? (
            <LoadingIndicator variant="workspace" />
          ) : orgError && !orgData ? (
            <div className="graph-loading">
              <h2>Couldn't load this repository</h2>
              <p>{orgError}</p>
              <button className="btn btn-accent" onClick={() => owner && fetchOrgGraph(owner)}>Retry</button>
            </div>
          ) : orgData ? (
            <OrgGraphCanvas
              data={orgData}
              selectedNode={orgSelectedNode}
              layout={orgLayout}
              edgeStyle={orgEdgeStyle}
              filters={orgFilters}
              searchResults={orgSearchResults}
              onNodeSelect={setOrgSelectedNode}
              onLayoutChange={handleOrgLayoutChange}
              onEdgeStyleChange={setOrgEdgeStyle}
              onRefresh={handleOrgRefresh}
            />
          ) : (
            <div className="empty-state">
              <img src="/forgely-icon.svg" alt="" className="empty-state-mark" />
              <h2>Start with a workspace</h2>
              <p>Forgely maps who can reach what — members, teams, services and the repositories they touch.</p>
              <p className="empty-state-hint">Pick a workspace above.</p>
            </div>
          )}

          {orgSelectedNode && orgData && (() => {
            const defaultTop = 84;
            const defaultLeft = panelCollapsed ? 48 : 280;
            const panelStyle = orgPanelExpanded
              ? undefined
              : orgPanelPos
                ? { top: orgPanelPos.y, left: orgPanelPos.x, right: "auto" as const }
                : { top: defaultTop, left: defaultLeft, right: "auto" as const };

            const onToolbarMouseDown = (e: React.MouseEvent) => {
              if (orgPanelExpanded || (e.target as HTMLElement).closest("button")) return;
              const panel = orgPanelRef.current;
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
                setOrgPanelPos({ x: finalX, y: finalY });
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
              e.preventDefault();
            };

            return (
              <div ref={orgPanelRef} className={`panel-overlay${orgPanelExpanded ? " panel-overlay-expanded" : ""}`} style={panelStyle}>
                <div className="panel-toolbar" onMouseDown={onToolbarMouseDown}>
                  <button className="panel-expand-btn" onClick={() => setOrgPanelExpanded(e => !e)} title={orgPanelExpanded ? "Collapse panel" : "Expand panel"}>
                    {orgPanelExpanded ? "⇥" : "⇤"}
                  </button>
                  <button className="panel-close" onClick={() => { setOrgSelectedNode(null); setOrgPanelExpanded(false); setOrgPanelPos(null); }}>×</button>
                </div>
                <OrgSidePanel data={orgData} nodeId={orgSelectedNode} onNodeSelect={setOrgSelectedNode} expanded={orgPanelExpanded}
                  onOpenAttackPaths={() => setCiemAttackPathOpen(true)} />
              </div>
            );
          })()}

          <OrgLegend collapsed={legendCollapsed} onToggle={toggleLegend} />

          {ciemAttackPathOpen && orgData && (
            <CiemAttackPathPanel
              data={orgData}
              onClose={() => setCiemAttackPathOpen(false)}
            />
          )}

        </>
      )}

      {apiToast && (
        <ApiErrorToast
          message={apiToast}
          onDismiss={() => setApiToast(null)}
          onReconnect={() => { setApiToast(null); setConnectOpen(true); }}
        />
      )}
    </div>
  );
}

interface ApiErrorToastProps {
  message: string;
  onDismiss: () => void;
  onReconnect: () => void;
}

function ApiErrorToast({ message, onDismiss, onReconnect }: ApiErrorToastProps) {
  const isAuth = message.startsWith("401:");
  const body = isAuth ? message.slice(5).trim() : message;

  useEffect(() => {
    if (isAuth) return;
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [isAuth, onDismiss]);

  return (
    <div className={`api-error-toast${isAuth ? " api-error-toast-auth" : ""}`} role="alert">
      <div className="api-error-toast-icon" aria-hidden="true">
        {isAuth ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        )}
      </div>
      <div className="api-error-toast-body">
        <div className="api-error-toast-title">{isAuth ? "Not connected to Cloudsmith" : "Couldn't complete that request"}</div>
        <div className="api-error-toast-msg">
          {isAuth ? "Your API key is missing or has been revoked. Reconnect to continue." : body}
        </div>
        {isAuth && body && body !== "Authentication required" && (
          <div className="api-error-toast-detail">{body}</div>
        )}
      </div>
      <div className="api-error-toast-actions">
        {isAuth && (
          <button className="api-error-toast-btn api-error-toast-reconnect" onClick={onReconnect}>
            Reconnect
          </button>
        )}
        <button className="api-error-toast-btn api-error-toast-close" onClick={onDismiss} title="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
