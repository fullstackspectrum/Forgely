import type { GraphResponse } from "../types";
import { SEVERITY_COLORS } from "../types";

const SEVERITY_ORDER = ["Critical", "High", "Medium", "Low"];

interface Props {
  packageNodeId: string;
  data: GraphResponse;
  owner: string;
  onClose: () => void;
}

export default function AttackGraphPanel({ packageNodeId, data, owner, onClose }: Props) {
  const packageNode = data.nodes.find((n) => n.id === packageNodeId);
  if (!packageNode) return null;

  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));

  /* Repo nodes that contain this package (repo_package edges) */
  const repoNodes = data.edges
    .filter((e) => e.type === "repo_package")
    .flatMap((e) => {
      if (e.target === packageNodeId) return [nodeMap.get(e.source)];
      if (e.source === packageNodeId) return [nodeMap.get(e.target)];
      return [];
    })
    .filter((n): n is NonNullable<typeof n> => !!n && n.type === "repo");

  /* Deduplicate */
  const seenRepos = new Set<string>();
  const uniqueRepos = repoNodes.filter((n) => {
    if (seenRepos.has(n.id)) return false;
    seenRepos.add(n.id);
    return true;
  });

  const fallbackRepo = data.nodes.find((n) => n.type === "repo");
  const displayRepos = uniqueRepos.length > 0 ? uniqueRepos : fallbackRepo ? [fallbackRepo] : [];

  const cves = packageNode.data.cves;
  const sevCounts: Record<string, number> = {};
  for (const cve of cves) {
    sevCounts[cve.severity] = (sevCounts[cve.severity] || 0) + 1;
  }

  const maxSev = packageNode.data.max_severity;
  const accentColor = maxSev ? (SEVERITY_COLORS[maxSev] ?? "rgba(255,255,255,0.15)") : "rgba(255,255,255,0.15)";

  return (
    <div className="attack-graph-panel">
      <div className="ag-header">
        <div className="ag-header-left">
          <svg className="ag-header-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <span className="ag-header-title">Attack Graph</span>
          <span className="ag-header-pkg">{packageNode.label}</span>
        </div>
        <button className="ag-close-btn" onClick={onClose} title="Close attack graph">×</button>
      </div>

      <div className="ag-body">
        {/* Internet */}
        <div className="ag-stage">
          <span className="ag-stage-label">Origin</span>
          <div className="ag-node ag-node-internet">
            <div className="ag-node-icon ag-node-icon-internet">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </div>
            <div className="ag-node-content">
              <span className="ag-node-name">Internet</span>
              <span className="ag-node-sub">Public access</span>
            </div>
          </div>
        </div>

        <AgArrow />

        {/* Registry */}
        <div className="ag-stage">
          <span className="ag-stage-label">Registry</span>
          <div className="ag-node ag-node-registry">
            <div className="ag-node-icon ag-node-icon-registry">
              <img src="/cloudsmith.png" alt="Cloudsmith" width="20" height="20" style={{ borderRadius: 4, objectFit: "contain" }} />
            </div>
            <div className="ag-node-content">
              <span className="ag-node-name">Cloudsmith</span>
              <span className="ag-node-sub">{owner}</span>
            </div>
          </div>
        </div>

        <AgArrow />

        {/* Repository */}
        <div className="ag-stage">
          <span className="ag-stage-label">Repository</span>
          <div className="ag-stage-nodes">
            {displayRepos.length > 0 ? (
              displayRepos.map((repo) => (
                <div key={repo.id} className="ag-node ag-node-repo">
                  <div className="ag-node-icon ag-node-icon-repo">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                  <div className="ag-node-content">
                    <span className="ag-node-name">{repo.label || repo.id}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="ag-node ag-node-repo">
                <div className="ag-node-icon ag-node-icon-repo">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <div className="ag-node-content">
                  <span className="ag-node-name">{data.repo}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <AgArrow />

        {/* Package */}
        <div className="ag-stage">
          <span className="ag-stage-label">Package</span>
          <div className="ag-node ag-node-package" style={{ borderLeftColor: accentColor }}>
            <div className="ag-node-icon ag-node-icon-package">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </div>
            <div className="ag-node-content">
              <span className="ag-node-name">{packageNode.label}</span>
              {packageNode.data.version && (
                <span className="ag-node-sub">{packageNode.data.version}</span>
              )}
              {maxSev && maxSev !== "None" && maxSev !== "Unknown" && (
                <span className="ag-sev-pill" style={{ background: SEVERITY_COLORS[maxSev] }}>
                  {maxSev}
                </span>
              )}
            </div>
          </div>
        </div>

        <AgArrow />

        {/* CVEs */}
        <div className="ag-stage">
          <span className="ag-stage-label">Vulnerabilities</span>
          <div className="ag-node ag-node-cves">
            <div className="ag-node-icon ag-node-icon-cves">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div className="ag-node-content">
              <span className="ag-node-name">
                {cves.length > 0 ? `${cves.length} CVE${cves.length !== 1 ? "s" : ""}` : "No CVEs"}
              </span>
              {cves.length > 0 ? (
                <div className="ag-sev-rows">
                  {SEVERITY_ORDER.filter((s) => sevCounts[s]).map((s) => (
                    <div key={s} className="ag-sev-row">
                      <span className="ag-sev-dot" style={{ background: SEVERITY_COLORS[s] }} />
                      <span className="ag-sev-label">{s}</span>
                      <span className="ag-sev-count">{sevCounts[s]}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="ag-node-sub">All clear</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="ag-footer">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>Shows the access path from the public internet to this package and its known vulnerabilities.</span>
      </div>
    </div>
  );
}

function AgArrow() {
  return (
    <div className="ag-arrow" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"/>
        <polyline points="12 5 19 12 12 19"/>
      </svg>
    </div>
  );
}
