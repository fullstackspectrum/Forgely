import { useMemo, useState } from "react";
import { SEVERITY_COLORS } from "../types";
import type { WorkspaceOverviewResponse } from "../types";

interface Props {
  data: WorkspaceOverviewResponse;
  onRepoSelect: (slug: string) => void;
}

const SEV_ORDER = ["Critical", "High", "Medium", "Low"] as const;

const FORMAT_COLORS: Record<string, string> = {
  docker:    "#2496ed",
  npm:       "#cb3837",
  python:    "#3776ab",
  nuget:     "#004880",
  ruby:      "#cc342d",
  go:        "#00add8",
  cargo:     "#ce422b",
  helm:      "#0f1689",
  deb:       "#a81d33",
  debian:    "#a81d33",
  rpm:       "#c00",
  composer:  "#885630",
  swift:     "#f05138",
  dart:      "#0175c2",
  maven:     "#c71a36",
  gradle:    "#02303a",
  terraform: "#7b42bc",
  conan:     "#6699cb",
  hex:       "#4e2a8e",
};

function formatColor(fmt: string): string {
  return FORMAT_COLORS[fmt.toLowerCase()] ?? "#4a6080";
}

/* ── Severity bar ───────────────────────────────────────────── */
function SevBar({ critical, high, medium, low, safe }: { critical: number; high: number; medium: number; low: number; safe: number }) {
  const total = critical + high + medium + low + safe;
  if (total === 0) return null;
  const segs = [
    { key: "critical", count: critical, color: SEVERITY_COLORS.Critical },
    { key: "high",     count: high,     color: SEVERITY_COLORS.High },
    { key: "medium",   count: medium,   color: SEVERITY_COLORS.Medium },
    { key: "low",      count: low,      color: SEVERITY_COLORS.Low },
    { key: "safe",     count: safe,     color: SEVERITY_COLORS.None },
  ].filter((s) => s.count > 0);
  return (
    <div className="wo-sev-bar">
      {segs.map((s) => (
        <div key={s.key} className="wo-sev-bar-seg" style={{ flex: s.count, background: s.color, opacity: 0.85 }}
          title={`${s.key[0].toUpperCase() + s.key.slice(1)}: ${s.count}`} />
      ))}
    </div>
  );
}

/* ── Format heatmap ─────────────────────────────────────────── */
function FormatHeatmap({ formats }: { formats: Record<string, number> }) {
  const sorted = Object.entries(formats)
    .filter(([, c]) => c > 0)
    .sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return null;
  const max = sorted[0][1];
  return (
    <div className="wo-format-grid">
      {sorted.map(([fmt, count]) => {
        const intensity = 0.25 + (count / max) * 0.75;
        const bg = formatColor(fmt);
        return (
          <div
            key={fmt}
            className="wo-format-tile"
            style={{ background: `${bg}${Math.round(intensity * 255).toString(16).padStart(2, "0")}`, borderColor: `${bg}66` }}
            title={`${fmt}: ${count} package${count !== 1 ? "s" : ""}`}
          >
            <span className="wo-format-tile-name">{fmt}</span>
            <span className="wo-format-tile-count">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Highlight helper ───────────────────────────────────────── */
function Hl({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="wo-search-highlight">{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>;
}

export default function WorkspaceOverviewPanel({ data, onRepoSelect }: Props) {
  const [query, setQuery] = useState("");

  /* Aggregate totals */
  const totals = useMemo(() => {
    let packages = 0, vulns = 0, critical = 0, high = 0, medium = 0, low = 0, safe = 0;
    const formats: Record<string, number> = {};
    for (const r of data.repos) {
      packages += r.package_count;
      vulns += r.vuln_count;
      critical += r.critical;
      high += r.high;
      medium += r.medium;
      low += r.low;
      safe += r.safe;
      for (const [fmt, cnt] of Object.entries(r.formats ?? {})) {
        formats[fmt] = (formats[fmt] ?? 0) + cnt;
      }
    }
    return { packages, vulns, critical, high, medium, low, safe, formats };
  }, [data]);

  /* Cheap unique CVE count — just set of IDs, no merging */
  const uniqueCveCount = useMemo(() => {
    const ids = new Set<string>();
    for (const r of data.repos) for (const c of r.cves) ids.add(c.id);
    return ids.size;
  }, [data.repos]);

  /* Per-repo search index — built once, O(repos × CVEs × pkgs) but stored */
  const repoSearchIndex = useMemo(() =>
    data.repos.map((r) => ({
      slug: r.slug,
      name: r.name,
      nameLower: r.name.toLowerCase(),
      maxSev: r.max_severity,
      packageCount: r.package_count,
      vulnCount: r.vuln_count,
      cveIds: r.cves.map((c) => c.id),
      packages: [...new Set(r.cves.flatMap((c) => c.packages))],
    })),
    [data.repos]
  );

  /* Search results — repos where something matches */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return repoSearchIndex
      .filter((r) =>
        r.nameLower.includes(q) ||
        r.cveIds.some((id) => id.toLowerCase().includes(q)) ||
        r.packages.some((p) => p.toLowerCase().includes(q))
      )
      .map((r) => ({
        slug: r.slug,
        name: r.name,
        maxSev: r.maxSev,
        matchedCves: r.cveIds.filter((id) => id.toLowerCase().includes(q)),
        matchedPkgs: r.packages.filter((p) => p.toLowerCase().includes(q)),
      }));
  }, [repoSearchIndex, query]);

  return (
    <div className="side-panel wo-panel">
      {/* Header */}
      <div className="panel-header">
        <div className="panel-pkg-name">{data.owner}</div>
        <div className="panel-pkg-sub">Workspace overview</div>
      </div>

      {/* Top stats */}
      <div className="wo-stats-row">
        <div className="wo-stat-item">
          <span className="wo-stat-value">{data.repos.length}</span>
          <span className="wo-stat-label">Repos</span>
        </div>
        <div className="wo-stat-item">
          <span className="wo-stat-value">{totals.packages}</span>
          <span className="wo-stat-label">Packages</span>
        </div>
        <div className="wo-stat-item">
          <span className="wo-stat-value" style={{ color: totals.vulns > 0 ? SEVERITY_COLORS[data.repos.find(r => r.max_severity)?.max_severity ?? ""] ?? "#ff4d4d" : "#28a745" }}>
            {totals.vulns}
          </span>
          <span className="wo-stat-label">Vulns</span>
        </div>
        <div className="wo-stat-item">
          <span className="wo-stat-value">{uniqueCveCount}</span>
          <span className="wo-stat-label">CVEs</span>
        </div>
      </div>

      {/* Severity bar */}
      <SevBar {...totals} />
      <div className="wo-sev-stats">
        {SEV_ORDER.map((sev) => {
          const count = totals[sev.toLowerCase() as keyof typeof totals] as number;
          return count > 0 ? (
            <span key={sev} className="wo-sev-stat" style={{ color: SEVERITY_COLORS[sev] }}>{count} {sev}</span>
          ) : null;
        })}
        {totals.safe > 0 && <span className="wo-sev-stat" style={{ color: SEVERITY_COLORS.None }}>{totals.safe} Safe</span>}
      </div>

      {/* Format heatmap */}
      {Object.keys(totals.formats).length > 0 && (
        <>
          <div className="wo-cve-section-label">Package Formats</div>
          <FormatHeatmap formats={totals.formats} />
        </>
      )}

      {/* Search bar */}
      <div className="wo-cve-section-label">
        Search
        {searchResults !== null && (
          <span className="wo-cve-count-badge">{searchResults.length} repo{searchResults.length !== 1 ? "s" : ""}</span>
        )}
      </div>
      <div className="wo-search-row">
        <input
          className="wo-search-input"
          type="text"
          placeholder="CVE ID, package or repo name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && <button className="wo-search-clear" onClick={() => setQuery("")}>×</button>}
      </div>

      {/* Search results (repo-centric) */}
      {searchResults !== null ? (
        <div className="wo-cve-list">
          {searchResults.length === 0 ? (
            <div className="wo-cve-empty">No repos match "{query}"</div>
          ) : (
            searchResults.map((r) => {
              const color = r.maxSev ? SEVERITY_COLORS[r.maxSev] ?? "#555577" : "#555577";
              return (
                <button key={r.slug} className="wo-search-result-row" onClick={() => onRepoSelect(r.slug)}>
                  <div className="wo-search-result-header">
                    <span className="wo-repo-sev-dot" style={{ background: color }} />
                    <span className="wo-search-result-name"><Hl text={r.name} query={query} /></span>
                  </div>
                  {r.matchedCves.length > 0 && (
                    <div className="wo-search-result-tags">
                      {r.matchedCves.slice(0, 6).map((id) => (
                        <span key={id} className="wo-pkg-tag"><Hl text={id} query={query} /></span>
                      ))}
                      {r.matchedCves.length > 6 && <span className="wo-tag-overflow">+{r.matchedCves.length - 6}</span>}
                    </div>
                  )}
                  {r.matchedPkgs.length > 0 && (
                    <div className="wo-search-result-tags">
                      {r.matchedPkgs.slice(0, 4).map((p) => (
                        <span key={p} className="wo-repo-tag"><Hl text={p} query={query} /></span>
                      ))}
                      {r.matchedPkgs.length > 4 && <span className="wo-tag-overflow">+{r.matchedPkgs.length - 4}</span>}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      ) : (
        /* Default repo list */
        <>
          <div className="wo-cve-section-label">Repositories</div>
          <div className="wo-repo-list">
            {[...data.repos].sort((a, b) => b.vuln_count - a.vuln_count).map((repo) => (
              <button key={repo.slug} className="wo-repo-row" onClick={() => onRepoSelect(repo.slug)}>
                <span className="wo-repo-sev-dot" style={{ background: repo.max_severity ? SEVERITY_COLORS[repo.max_severity] ?? "#555577" : "#555577" }} />
                <span className="wo-repo-row-name">{repo.name}</span>
                <span className="wo-repo-row-count">{repo.package_count} pkg{repo.package_count !== 1 ? "s" : ""}</span>
                {(repo.critical + repo.high + repo.medium + repo.low) > 0 && (
                  <span className="wo-repo-row-vulns" style={{ color: SEVERITY_COLORS[repo.max_severity ?? ""] ?? "#ff4d4d" }}>
                    {repo.vuln_count} vuln{repo.vuln_count !== 1 ? "s" : ""}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
