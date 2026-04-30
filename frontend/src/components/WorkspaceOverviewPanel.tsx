import { useMemo, useState } from "react";
import { SEVERITY_COLORS } from "../types";
import type { WorkspaceOverviewResponse, WorkspaceCveSummary } from "../types";

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

/* ── CVE row ────────────────────────────────────────────────── */
function CveRow({ cve, query, repoMap }: { cve: WorkspaceCveSummary & { repos: string[] }; query: string; repoMap: Record<string, string> }) {
  const color = SEVERITY_COLORS[cve.severity] ?? "#888";
  const hl = (text: string) => {
    if (!query) return <>{text}</>;
    const i = text.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) return <>{text}</>;
    return <>{text.slice(0, i)}<mark className="wo-search-highlight">{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>;
  };
  return (
    <div className="wo-cve-row">
      <div className="wo-cve-header">
        <span className="cve-severity-badge" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>{cve.severity}</span>
        <span className="wo-cve-id">{hl(cve.id)}</span>
      </div>
      {cve.description && <div className="wo-cve-desc">{cve.description.slice(0, 120)}{cve.description.length > 120 ? "…" : ""}</div>}
      <div className="wo-cve-packages">
        {cve.packages.map((p) => <span key={p} className="wo-pkg-tag">{hl(p)}</span>)}
      </div>
      <div className="wo-cve-repos">
        {cve.repos.map((r) => <span key={r} className="wo-repo-tag">{hl(repoMap[r] ?? r)}</span>)}
      </div>
    </div>
  );
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

  /* Aggregate CVEs across repos, recording which repos each appears in */
  const repoMap = useMemo(() =>
    Object.fromEntries(data.repos.map((r) => [r.slug, r.name])), [data]);

  const allCves = useMemo(() => {
    const map: Record<string, WorkspaceCveSummary & { repos: string[] }> = {};
    for (const repo of data.repos) {
      for (const cve of repo.cves) {
        if (!map[cve.id]) {
          map[cve.id] = { ...cve, repos: [] };
        } else {
          // Merge packages from other repos
          for (const pkg of cve.packages) {
            if (!map[cve.id].packages.includes(pkg)) map[cve.id].packages.push(pkg);
          }
        }
        if (!map[cve.id].repos.includes(repo.slug)) {
          map[cve.id].repos.push(repo.slug);
        }
      }
    }
    const rank: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
    return Object.values(map).sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0));
  }, [data]);

  const filteredCves = useMemo(() => {
    if (!query.trim()) return allCves;
    const q = query.trim().toLowerCase();
    return allCves.filter((c) =>
      c.id.toLowerCase().includes(q) ||
      c.packages.some((p) => p.toLowerCase().includes(q)) ||
      c.repos.some((r) => (repoMap[r] ?? r).toLowerCase().includes(q))
    );
  }, [allCves, query, repoMap]);

  const uniqueCves = allCves.length;

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
          <span className="wo-stat-value">{uniqueCves}</span>
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

      {/* Repo list */}
      <div className="wo-cve-section-label">Repositories</div>
      <div className="wo-repo-list">
        {data.repos.map((repo) => (
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

      {/* CVE search */}
      {allCves.length > 0 && (
        <>
          <div className="wo-cve-section-label">
            CVEs
            {query && <span className="wo-cve-count-badge">{filteredCves.length} / {uniqueCves}</span>}
          </div>
          <div className="wo-search-row">
            <input
              className="wo-search-input"
              type="text"
              placeholder="Search CVE, package or repo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && <button className="wo-search-clear" onClick={() => setQuery("")}>×</button>}
          </div>
          <div className="wo-cve-list">
            {filteredCves.length === 0 ? (
              <div className="wo-cve-empty">No CVEs match "{query}"</div>
            ) : (
              filteredCves.map((cve) => <CveRow key={`${cve.id}`} cve={cve} query={query} repoMap={repoMap} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}
