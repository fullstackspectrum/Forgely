import { useMemo, useState, useCallback } from "react";
import { currentTheme } from "../lib/theme";
import SeverityMark from "./SeverityMark";
import type { GraphResponse, GraphNode, CVERecord, PackageDetail, RepoIdentity, Severity } from "../types";
import { SEVERITY_COLORS, SEVERITY_RANK } from "../types";
import { useCveDescriptions } from "../hooks/useCveDescriptions";



function VersionString({ version, mono = false }: { version: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(version).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [version]);
  return (
    <span className="version-string-wrap">
      <span
        className="version-string-text"
        title={version}
        style={mono ? { fontFamily: "var(--fg-font-mono)", color: "var(--fg-blue-200)" } : undefined}
      >
        {version}
      </span>
      <button
        type="button"
        className="version-copy-btn"
        onClick={copy}
        title={copied ? "Copied!" : "Copy version"}
      >
        {copied ? "✓" : "⎘"}
      </button>
    </span>
  );
}

/* An empty set is no filter at all; otherwise a package matches when it
   carries a finding at any of the selected levels. */
function packageMatchesFilter(p: GraphNode, severities: Set<Severity>): boolean {
  if (severities.size === 0) return true;
  return p.data.cves.some((c) => severities.has(c.severity as Severity));
}
/* Module-level so the default prop is the same object on every render; a
   fresh `new Set()` would change identity and re-fire every memo keyed on it. */
const EMPTY_SEVERITIES: Set<Severity> = new Set();

import { usePackageDetail } from "../hooks/usePackageDetail";
import { usePackageGroup } from "../hooks/usePackageGroup";
import { useRepoAccess } from "../hooks/useRepoAccess";
import { GROUP_PREFIX, groupKeyOf } from "../lib/groupPackages";
import { getFormatIcon } from "../lib/formatIcons";
import { apiFetch } from "../lib/auth";

interface Props {
  data: GraphResponse;
  nodeId: string;
  owner: string;
  repo: string;
  expanded?: boolean;
  severities?: Set<Severity>;
  formatFilter?: string | null;
  onSeveritiesChange?: (s: Set<Severity>) => void;
  onFormatFilterChange?: (f: string | null) => void;
  onNodeSelect?: (id: string) => void;
  onOpenAttackGraph?: () => void;
}

export default function SidePanel({
  data,
  nodeId,
  owner,
  repo,
  expanded = false,
  severities = EMPTY_SEVERITIES,
  formatFilter = null,
  onSeveritiesChange,
  onFormatFilterChange,
  onNodeSelect,
  onOpenAttackGraph,
}: Props) {
  const [sevFilter, setSevFilter] = useState<string>("All");
  const [showSharedOnly, setShowSharedOnly] = useState(false);
  const [cveQuery, setCveQuery] = useState<string>("");
  const [cvePage, setCvePage] = useState(0);
  const [depsExpanded, setDepsExpanded] = useState(false);
  /* Reachability is a different question from "what is this package", and
     answering it inline meant scrolling past every digest and tag to reach it. */
  const [panelTab, setPanelTab] = useState<"details" | "reach">("details");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const node = data.nodes.find((n) => n.id === nodeId);

  /* Direct dependencies of this node (outgoing "dependency" edges).
     Must be declared before any early returns to satisfy the Rules of Hooks. */
  const dependencies = useMemo(() => {
    if (!node || node.type !== "package") return [];
    const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const list: GraphNode[] = [];
    for (const e of data.edges) {
      if (e.type !== "dependency" || e.source !== nodeId) continue;
      if (seen.has(e.target)) continue;
      seen.add(e.target);
      const target = nodeMap.get(e.target);
      if (target) list.push(target);
    }
    list.sort((a, b) => {
      const av = (b.data.vuln_count || 0) - (a.data.vuln_count || 0);
      return av !== 0 ? av : a.label.localeCompare(b.label);
    });
    return list;
  }, [data, nodeId, node]);

  /* CVE descriptions are fetched on demand rather than carried in the graph
     payload (perf/08). Declared before the early returns for the same reason
     as `dependencies` above. */
  const { descriptions: cveDescriptions } = useCveDescriptions(
    owner,
    repo,
    node?.type === "package" && node.data.cves.length > 0 ? node.data.slug : "",
  );

  /* Everything below the graph's own fields. Declared here, above the early
     return, for the same reason as the two hooks around it: a group id does
     not resolve to a node, and a hook skipped on that render would change the
     hook order React is counting on. */
  const { detail, loading: detailLoading } = usePackageDetail(
    owner,
    repo,
    node?.type === "package" ? node.data.slug : "",
  );

  /* Who can reach the repository this package lives in. Keyed on the repo, so
     clicking between packages in it does not refetch. */
  const { access, loading: accessLoading } = useRepoAccess(
    node?.type === "package" ? owner : "",
    node?.type === "package" ? repo : "",
  );

  /* A group node stands for several packages and is not in `data` at all —
     the grouping is a client-side transform over these same nodes. */
  if (nodeId.startsWith(GROUP_PREFIX)) {
    return (
      <GroupDetail
        data={data}
        name={nodeId.slice(GROUP_PREFIX.length)}
        owner={owner}
        repo={repo}
        onNodeSelect={onNodeSelect}
        onFormatFilterChange={onFormatFilterChange}
        formatFilter={formatFilter}
      />
    );
  }

  if (!node) return null;

  /* Repo node gets a completely different detail view */
  if (node.type === "repo") {
    return (
      <RepoDetail
        data={data}
        node={node}
        owner={owner}
        repo={repo}
        expanded={expanded}
        severities={severities}
        formatFilter={formatFilter}
        onSeveritiesChange={onSeveritiesChange}
        onFormatFilterChange={onFormatFilterChange}
        onNodeSelect={onNodeSelect}
      />
    );
  }

  /* Dependency node view */
  if (node.type === "dependency") {
    return (
      <DependencyDetail
        data={data}
        node={node}
        expanded={expanded}
        severities={severities}
        onSeveritiesChange={onSeveritiesChange}
        onNodeSelect={onNodeSelect}
      />
    );
  }

  const toggleSeverity = (s: Severity) => {
    if (!onSeveritiesChange) return;
    const next = new Set(severities);
    if (next.has(s)) next.delete(s); else next.add(s);
    onSeveritiesChange(next);
  };
  const toggleFormat = (f: string) => {
    if (!onFormatFilterChange) return;
    onFormatFilterChange(formatFilter === f ? null : f);
  };

  const d = node.data;
  const sev = d.max_severity || "None";
  const sevColor = SEVERITY_COLORS[sev] || SEVERITY_COLORS.None;

  const sizeStr =
    d.size > 1048576
      ? `${(d.size / 1048576).toFixed(1)} MB`
      : d.size > 1024
        ? `${(d.size / 1024).toFixed(1)} KB`
        : d.size
          ? `${d.size} B`
          : "—";

  const uploadDate = d.uploaded_at && d.uploaded_at !== "N/A"
    ? new Date(d.uploaded_at).toLocaleDateString()
    : "—";

  /* Build CVE→packages reverse index for "also affects" */
  const cveIndex: Record<string, string[]> = {};
  for (const n of data.nodes) {
    for (const c of n.data.cves) {
      if (!c.id) continue;
      if (!cveIndex[c.id]) cveIndex[c.id] = [];
      if (!cveIndex[c.id].includes(n.id)) cveIndex[c.id].push(n.id);
    }
  }

  /* The API's own link when we have it: the hand-built one guesses at a URL
     shape, and guesses wrong for formats whose name is not the group name. */
  const cloudsmithUrl = detail?.web_url
    ? detail.web_url
    : node.type === "package" && d.slug
      ? `https://app.cloudsmith.com/${owner}/r/${repo}/package-group/${d.format}/${encodeURIComponent(node.label)}/${d.slug}`
      : null;

  const canGenerateReport =
    node.type === "package" &&
    !!d.slug &&
    (d.vuln_count > 0 || /scanned/i.test(d.scan_status || ""));
  const handleGenerateReport = async () => {
    if (!canGenerateReport || reportLoading) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const resp = await apiFetch(
        `/api/vulnly-report/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(d.slug)}?theme=${currentTheme()}`,
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-");
      const filename = `vulnly-${safe(node.label)}${d.version ? `-${safe(d.version)}` : ""}.html`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setReportDone(true);
      setTimeout(() => setReportDone(false), 2500);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className={`side-panel${expanded ? " side-panel-expanded" : ""}`}>
      <div className="panel-summary">
      <div className="panel-header">
        <span className="panel-eyebrow">Package</span>
        <h2 className="panel-title">{node.label}</h2>
        {d.version && <span className="panel-version"><VersionString version={d.version} /></span>}
      </div>

      <div className="panel-status-row">
        <div className="panel-status-badges">
          <button
            type="button"
            className={`severity-badge severity-badge-clickable${severities.has(sev as Severity) ? " active" : ""}`}
            data-severity={sev}
            onClick={() => toggleSeverity(sev as Severity)}
            title={severities.has(sev as Severity) ? `Clear ${sev} filter` : `Add ${sev} to the filter`}
            disabled={!onSeveritiesChange || sev === "None" || sev === "Unknown"}
          >
            {sev}
          </button>
          <span className="vuln-count-inline" style={d.vuln_count > 0 ? { color: sevColor } : undefined}>
            {d.vuln_count} {d.vuln_count === 1 ? "vulnerability" : "vulnerabilities"}
          </span>
          {d.is_quarantined && (
            <span className="quarantine-badge" title="This package is quarantined">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Quarantined
            </span>
          )}
        </div>
        {((onOpenAttackGraph && (d.max_severity === "Critical" || d.max_severity === "High")) || canGenerateReport || cloudsmithUrl) && (
        <div className="panel-status-actions">
          {onOpenAttackGraph && (d.max_severity === "Critical" || d.max_severity === "High") && (
            <button
              type="button"
              className="attack-graph-btn"
              onClick={onOpenAttackGraph}
              title="View attack path"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              <span>Attack path</span>
            </button>
          )}
          {(canGenerateReport || cloudsmithUrl) && (
            <>
            {canGenerateReport && (
              <button
                type="button"
                className={`vulnly-report-btn${d.vuln_count === 0 ? " vulnly-report-btn-clean" : ""}${reportDone ? " vulnly-report-btn-done" : ""}`}
                onClick={handleGenerateReport}
                disabled={reportLoading || reportDone}
                title={reportLoading ? "Generating report…" : reportDone ? "Report downloaded" : "Download Vulnly HTML report"}
              >
                {reportLoading ? (
                  <span className="vulnly-spinner" aria-hidden="true" />
                ) : reportDone ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                )}
                <span>{reportLoading ? "Generating…" : reportDone ? "Downloaded!" : "Vulnly Report"}</span>
              </button>
            )}
            {cloudsmithUrl && (
              <a
                className="cloudsmith-view-btn"
                href={cloudsmithUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="View in Cloudsmith"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            )}
            </>
          )}
        </div>
        )}
      </div>
      {reportError && (
        <div className="vulnly-report-error" role="alert">
          ⚠ {reportError}
        </div>
      )}

      {/* Two stats first — "lead with consequence, not classification" (§8).
          The vulnerability count is what the user acts on; format and licence
          are reference detail and stay in the table below. */}
      <div className="panel-stats">
        <div className="panel-stat" data-severity={d.vuln_count > 0 ? (d.max_severity ?? undefined) : undefined}>
          <div className="panel-stat-value">{d.vuln_count}</div>
          <div className="panel-stat-key">
            {d.vuln_count === 1 ? "Vulnerability" : "Vulnerabilities"}
          </div>
        </div>
        <div className="panel-stat">
          <div className="panel-stat-value">{dependencies.length}</div>
          <div className="panel-stat-key">
            {dependencies.length === 1 ? "Dependency" : "Dependencies"}
          </div>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="panel-meta">
        <MetaRow
          label="Format"
          value={d.format}
          onClick={d.format ? () => toggleFormat(d.format.toLowerCase()) : undefined}
          active={!!d.format && formatFilter === d.format.toLowerCase()}
        />
        <MetaRow label="License" value={detail?.spdx_license || d.license} />
        <MetaRow label="Size" value={sizeStr} />
        <MetaRow label="Downloads" value={String(d.downloads ?? "—")} />
        <MetaRow label="Scan status" value={d.scan_status} />
        <MetaRow label="Uploaded" value={uploadDate} />
        {/* Rows below need the fetched detail, so each is omitted rather than
            shown as an em dash while it loads or if it never arrives. */}
        {detail?.uploader && <MetaRow label="Uploaded by" value={detail.uploader} />}
        {detail?.type_display && <MetaRow label="Type" value={detail.type_display} />}
        {detail?.distro && <MetaRow label="Distribution" value={detail.distro} />}
        {detail?.architectures?.length ? (
          <MetaRow label="Architecture" value={detail.architectures.join(", ")} />
        ) : null}
        {detail?.epoch && <MetaRow label="Epoch" value={detail.epoch} />}
        {detail?.release && <MetaRow label="Release" value={detail.release} />}
        {detail?.filename && <MetaRow label="Filename" value={detail.filename} />}
        {detail && detail.num_files > 0 && (
          <MetaRow label="Files" value={String(detail.num_files)} />
        )}
        {detail?.status && <MetaRow label="Status" value={detail.status} />}
      </div>

      {/* The rows above are the ones that need the fetched detail. Without
          this the panel looked finished while half of it was still coming. */}
      {detailLoading && !detail && (
        <div className="panel-loading">
          <Spinner label="Loading package metadata" />
          <span>Loading digests, tags and identifiers…</span>
        </div>
      )}

      {/* A one-line summary is worth more than any row above it, but only some
          formats carry one. */}
      {detail?.summary && <p className="panel-summary-text">{detail.summary}</p>}

      {/* Flags worth interrupting for. Quarantine already has its own badge in
          the header, so only the two the graph does not draw appear here. */}
      {(detail?.is_malware_detected || detail?.policy_violated) && (
        <div className="pkg-flags">
          {detail.is_malware_detected && (
            <span className="pkg-flag pkg-flag-danger">Malware detected</span>
          )}
          {detail.policy_violated && (
            <span className="pkg-flag pkg-flag-warn">Policy violated</span>
          )}
        </div>
      )}
      </div>

      <div className="panel-details">

      {/* Two questions, two tabs: what this package is, and who can reach it.
          Both were one scroll before, and the second was under every digest. */}
      <div className="panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === "details"}
          className={`panel-tab${panelTab === "details" ? " active" : ""}`}
          onClick={() => setPanelTab("details")}
        >
          Details
          {detailLoading && <Spinner />}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === "reach"}
          className={`panel-tab${panelTab === "reach" ? " active" : ""}`}
          onClick={() => setPanelTab("reach")}
        >
          Reachability
          {accessLoading
            ? <Spinner />
            : access && <span className="panel-tab-count">{access.identities.length}</span>}
        </button>
      </div>
      {panelTab === "reach" && (<>

      {/* Who can reach this — the CIEM answer, on the SCA side.
          
          A vulnerable package is only as exposed as the people who can reach
          the repository holding it: Admin and Write are who could replace the
          artefact, Read is who is served it. Answering that used to mean
          switching tabs and rebuilding the identity graph. */}
      {accessLoading && !access && (
        <div className="panel-section panel-loading">
          <Spinner label="Loading reachability" />
          <span>Working out who can reach this repository…</span>
        </div>
      )}

      {!accessLoading && access && access.identities.length === 0 && (
        <p className="cve-empty">No identities have access to this repository.</p>
      )}

      {!accessLoading && !access && (
        <p className="cve-empty">Could not load reachability for this repository.</p>
      )}

      {access && access.identities.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Who can reach this</h3>
          <p className="access-hint">
            Access to <strong>{access.repo}</strong>, the repository this package
            is published in.
          </p>

          <div className="access-counts">
            {([["Admin", access.admin], ["Write", access.write], ["Read", access.read]] as const)
              .filter(([, n]) => n > 0)
              .map(([label, n]) => (
                <span key={label} className={`access-count access-count-${label.toLowerCase()}`}>
                  <strong>{n}</strong> {label}
                </span>
              ))}
          </div>

          <ul className="access-list">
            {access.identities.slice(0, ACCESS_ROWS).map((i) => (
              <AccessRow key={i.id} identity={i} />
            ))}
          </ul>
          {access.identities.length > ACCESS_ROWS && (
            <p className="access-more">
              +{access.identities.length - ACCESS_ROWS} more with access
            </p>
          )}

          {access.entitlements.length > 0 && (
            <p className="access-hint access-tokens">
              {access.entitlements.length} entitlement{access.entitlements.length === 1 ? "" : "s"}
              {" "}can download from it without a user account:{" "}
              {access.entitlements.join(", ")}
            </p>
          )}
        </div>
      )}
      </>)}

      {panelTab === "details" && (<>
      {/* Identifiers — the fields that actually name this artefact in its own
          ecosystem. Every format uses different keys (a Docker image has a
          platform, a Conda package a build string, an Alpine package a distro
          version), so they are listed as returned rather than mapped onto a
          fixed set that would drop whatever we had not anticipated. */}
      {detail && Object.keys(detail.identifiers).length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Identifiers</h3>
          <div className="panel-meta">
            {Object.entries(detail.identifiers).map(([key, value]) => (
              <MetaRow key={key} label={humanise(key)} value={value} />
            ))}
          </div>
        </div>
      )}

      {/* Tags, grouped by the category the registry files them under. */}
      {detail && Object.keys(detail.tags).length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Tags</h3>
          {Object.entries(detail.tags).map(([category, values]) => (
            <div key={category} className="pkg-tag-group">
              <span className="pkg-tag-category">{humanise(category)}</span>
              <div className="pkg-tag-list">
                {values.map((v) => (
                  <span key={v} className="pkg-tag" title={v}>{v}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Digests, strongest first — the weaker ones are still shown because
          they are what an older toolchain will be comparing against. */}
      {detail && (detail.checksum_sha512 || detail.checksum_sha256 || detail.checksum_sha1 || detail.checksum_md5) && (
        <div className="panel-section">
          <h3 className="section-title">Digests</h3>
          <div className="pkg-digests">
            {([
              ["SHA-512", detail.checksum_sha512],
              ["SHA-256", detail.checksum_sha256],
              ["SHA-1", detail.checksum_sha1],
              ["MD5", detail.checksum_md5],
            ] as const)
              .filter(([, value]) => !!value)
              .map(([label, value]) => (
                <Digest key={label} label={label} value={value} />
              ))}
          </div>
        </div>
      )}

      {/* Dependencies */}
      {dependencies.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Dependencies</h3>
          <button
            type="button"
            className={`dep-summary-card dep-summary-card-clickable${depsExpanded ? " expanded" : ""}`}
            onClick={() => setDepsExpanded((v) => !v)}
            aria-expanded={depsExpanded}
            title={depsExpanded ? "Hide dependency list" : "Show dependency list"}
          >
            <span className="dep-summary-value">{dependencies.length}</span>
            <span className="dep-summary-label">
              direct {dependencies.length === 1 ? "dependency" : "dependencies"}
            </span>
            <span className="dep-summary-chevron" aria-hidden="true">
              {depsExpanded ? "▾" : "▸"}
            </span>
          </button>
          {depsExpanded && (
            <div className="dep-list">
              {dependencies.map((dep) => {
                const sev = dep.data.max_severity || "None";
                const sevColor = SEVERITY_COLORS[sev] || SEVERITY_COLORS.None;
                const hasVulns = dep.data.vuln_count > 0;
                const clickable = !!onNodeSelect;
                return (
                  <button
                    key={dep.id}
                    type="button"
                    className={`dep-row${clickable ? " dep-row-clickable" : ""}`}
                    onClick={clickable ? () => onNodeSelect!(dep.id) : undefined}
                    disabled={!clickable}
                    title={clickable ? `Focus ${dep.label} in graph` : dep.label}
                  >
                    <span className="dep-row-name">{dep.label}</span>
                    {dep.data.version && (
                      <span className="dep-row-version">{dep.data.version}</span>
                    )}
                    {hasVulns && (
                      <span
                        className="dep-row-badge severity-badge"
                        data-severity={sev}
                        title={`${dep.data.vuln_count} ${dep.data.vuln_count === 1 ? "vulnerability" : "vulnerabilities"}, highest severity ${sev}`}
                      >
                        <SeverityMark severity={sev} />
                        {dep.data.vuln_count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CVE list */}
      {d.cves.length > 0 && (() => {
        const sorted = [...d.cves].sort(
          (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
        );
        const sevCounts: Record<string, number> = {};
        for (const c of sorted) {
          sevCounts[c.severity] = (sevCounts[c.severity] || 0) + 1;
        }
        const sharedCount = sorted.filter((c) => (cveIndex[c.id]?.length ?? 0) > 1).length;
        const q = cveQuery.trim().toLowerCase();
        const filtered = sorted.filter((c) => {
          if (sevFilter !== "All" && c.severity !== sevFilter) return false;
          if (showSharedOnly && (cveIndex[c.id]?.length ?? 0) <= 1) return false;
          if (!q) return true;
          return (
            (c.id || "").toLowerCase().includes(q) ||
            (cveDescriptions[c.id] || c.description || "").toLowerCase().includes(q) ||
            (c.affected || "").toLowerCase().includes(q)
          );
        });
        const filterOptions = ["All", "Critical", "High", "Medium", "Low"].filter(
          (s) => s === "All" || sevCounts[s]
        );

        const pageSize = expanded ? 15 : 5;
        const totalPages = Math.ceil(filtered.length / pageSize);
        const safePage = Math.min(cvePage, Math.max(0, totalPages - 1));
        const paginated = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

        return (
          <div className="panel-section">
            <h3 className="section-title">
              CVEs ({filtered.length}{filtered.length !== d.cves.length ? ` of ${d.cves.length}` : ""}
              {d.vuln_count > d.cves.length ? ` — ${d.vuln_count} total` : ""})
            </h3>
            <div className="cve-search-row">
              <span className="cve-search-icon" aria-hidden="true">⌕</span>
              <input
                type="text"
                className="cve-search-input"
                placeholder="Search CVEs (e.g. CVE-2024-1234)"
                value={cveQuery}
                onChange={(e) => { setCveQuery(e.target.value); setCvePage(0); }}
              />
              {cveQuery && (
                <button
                  type="button"
                  className="cve-search-clear"
                  onClick={() => { setCveQuery(""); setCvePage(0); }}
                  title="Clear"
                >
                  ×
                </button>
              )}
            </div>
            <div className="cve-filter-bar">
              {filterOptions.map((s) => (
                <button
                  key={s}
                  className={`cve-filter-btn${sevFilter === s ? " active severity-badge" : ""}`}
                  data-severity={sevFilter === s && s !== "All" ? s : undefined}
                  onClick={() => { setSevFilter(s); setCvePage(0); }}
                >
                  {s}{s !== "All" ? ` (${sevCounts[s]})` : ""}
                </button>
              ))}
              {sharedCount > 0 && (
                <button
                  className={`cve-filter-btn cve-filter-btn-shared${showSharedOnly ? " active" : ""}`}
                  onClick={() => { setShowSharedOnly((v) => !v); setCvePage(0); }}
                  title="Show only CVEs shared with other packages"
                >
                  Shared ({sharedCount})
                </button>
              )}
            </div>
            <div className="cve-list">
              {filtered.length === 0 ? (
                <div className="cve-empty">No CVEs match your search.</div>
              ) : paginated.map((cve, i) => (
                <CveCard
                  key={`${cve.id}-${i}`}
                  cve={cve}
                  description={cveDescriptions[cve.id] || cve.description}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="cve-pagination">
                <button
                  className="cve-page-btn"
                  onClick={() => setCvePage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                >
                  ‹
                </button>
                <span className="cve-page-label">
                  {safePage + 1} / {totalPages}
                </span>
                <button
                  className="cve-page-btn"
                  onClick={() => setCvePage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage === totalPages - 1}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {d.vuln_count > 0 && d.cves.length === 0 && (
        <div className="panel-section">
          <p style={{ color: "var(--s-medium)" }}>
            ⚠ {d.vuln_count} vulnerabilities detected but details could not be
            retrieved.
          </p>
        </div>
      )}

      {d.vuln_count === 0 && node.type === "package" && (() => {
        const unsupported = /not supported/i.test(d.scan_status || "");
        if (unsupported) {
          return (
            <div className="panel-section">
              <div className="no-cves-card no-cves-card-unsupported">
                <div className="no-cves-icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="no-cves-text">
                  <strong>Scan not supported</strong>
                  <span>Security scanning isn't available for this package format.</span>
                </div>
              </div>
            </div>
          );
        }
        return (
          <div className="panel-section">
            <div className="no-cves-card">
              <div className="no-cves-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div className="no-cves-text">
                <strong>All clear</strong>
                <span>No CVEs recorded for this package.</span>
              </div>
            </div>
          </div>
        );
      })()}
      </>)}
      </div>
    </div>
  );
}

/* How many tags a version row shows before collapsing the rest into a count.
 * A Docker image can carry a dozen; past a handful they stop distinguishing
 * one row from the next and start hiding the rows below. */
const TAGS_PER_ROW = 3;

/** Hex long enough to be a content digest rather than a version number.
 *
 * Not anchored at the end: Cosign publishes its signatures as
 * `sha256-<64 hex>.sig`, which is a digest wearing a suffix and was slipping
 * through a fully anchored match to become a row's title. */
function isDigest(value: string): boolean {
  return /^(sha256[:-])?[0-9a-f]{32,}/i.test(value);
}

/** Enough of a digest to compare at a glance; the full value is in the title. */
function shortDigest(value: string): string {
  const hex = value.replace(/^sha256[:-]/i, "");
  return hex.length > 14 ? `${hex.slice(0, 12)}…` : hex;
}

/* Enough to see the shape of the exposure without scrolling; the rest is a
 * count, because past a handful the answer is "lots of people" and the precise
 * list belongs in the CIEM graph. */
const ACCESS_ROWS = 8;

function AccessRow({ identity }: { identity: RepoIdentity }) {
  /* Why they have it, in the fewest words that are still true. */
  const reason =
    identity.via === "org"
      ? `organisation ${identity.org_role || "role"}`
      : identity.via === "team"
        ? `team ${identity.team}`
        : "granted on this repository";

  return (
    <li className="access-row" data-permission={identity.permission}>
      <span className="access-name" title={identity.id}>{identity.name}</span>
      <span className="access-perm">{identity.permission}</span>
      <span className="access-via">
        {identity.kind === "service" ? "service · " : ""}{reason}
      </span>
    </li>
  );
}

/* ================================================================
   Group Detail — one package name, every version it was published under
   ================================================================ */

function GroupDetail({
  data,
  name,
  owner,
  repo,
  onNodeSelect,
  onFormatFilterChange,
  formatFilter,
}: {
  data: GraphResponse;
  name: string;
  owner: string;
  repo: string;
  onNodeSelect?: (id: string) => void;
  onFormatFilterChange?: (f: string | null) => void;
  formatFilter?: string | null;
}) {
  const [query, setQuery] = useState("");
  const { members: detail, loading } = usePackageGroup(owner, repo, name);

  /* The graph's own nodes for this name. These carry the severity and the node
     id, which is what a click has to select; the fetched detail carries tags
     and architecture. They are joined on slug. */
  const nodes = useMemo(
    () => data.nodes.filter((n) => n.type === "package" && groupKeyOf(n) === name),
    [data, name],
  );

  const detailBySlug = useMemo(() => {
    const m = new Map<string, PackageDetail>();
    for (const d of detail ?? []) if (d.slug) m.set(d.slug, d);
    return m;
  }, [detail]);

  /* Tags every member carries say nothing about which version to pick — on a
     proxied Docker group that is "upstream" and "index-docker-io" on all
     sixteen rows, crowding out the ones that differ. Dropped from the rows;
     they are still on each package's own panel. */
  const ubiquitousTags = useMemo(() => {
    if (!detail || detail.length < 2) return new Set<string>();
    const counts = new Map<string, number>();
    for (const m of detail) {
      for (const t of new Set(Object.values(m.tags).flat())) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return new Set([...counts].filter(([, n]) => n === detail.length).map(([t]) => t));
  }, [detail]);

  const rows = useMemo(() => {
    const list = nodes.map((n) => ({ node: n, meta: detailBySlug.get(n.data.slug) }));
    /* Worst first — a group is opened to find out which version to avoid. */
    list.sort((a, b) => {
      const sev = (SEVERITY_RANK[b.node.data.max_severity ?? ""] ?? 0)
        - (SEVERITY_RANK[a.node.data.max_severity ?? ""] ?? 0);
      if (sev !== 0) return sev;
      const vc = (b.node.data.vuln_count || 0) - (a.node.data.vuln_count || 0);
      if (vc !== 0) return vc;
      return (b.node.data.uploaded_at || "").localeCompare(a.node.data.uploaded_at || "");
    });
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    /* Searches the tags too: on a Docker group the version is a digest, so the
       tag is the only part anyone can recognise. */
    return list.filter(({ node, meta }) =>
      node.data.version.toLowerCase().includes(q)
      || Object.values(meta?.tags ?? {}).some((vals) =>
        vals.some((v) => v.toLowerCase().includes(q)))
      || (meta?.architectures ?? []).some((a) => a.toLowerCase().includes(q)),
    );
  }, [nodes, detailBySlug, query]);

  const totals = useMemo(() => {
    let vulns = 0;
    let worst: string | null = null;
    for (const n of nodes) {
      vulns += n.data.vuln_count || 0;
      if ((SEVERITY_RANK[n.data.max_severity ?? ""] ?? 0) > (SEVERITY_RANK[worst ?? ""] ?? 0)) {
        worst = n.data.max_severity ?? null;
      }
    }
    return { vulns, worst };
  }, [nodes]);

  const format = nodes[0]?.data.format ?? "";
  const worstColor = SEVERITY_COLORS[totals.worst ?? "None"] ?? SEVERITY_COLORS.None;

  return (
    <div className="side-panel">
      <div className="panel-header">
        <h2 className="panel-title" title={name}>{name}</h2>
        <div className="panel-subtitle">
          {nodes.length} {nodes.length === 1 ? "version" : "versions"}
        </div>
      </div>

      <div className="panel-stats">
        <div className="panel-stat" data-severity={totals.vulns > 0 ? (totals.worst ?? undefined) : undefined}>
          <div className="panel-stat-value">{totals.vulns}</div>
          <div className="panel-stat-key">
            {totals.vulns === 1 ? "Vulnerability" : "Vulnerabilities"}
          </div>
        </div>
        <div className="panel-stat">
          <div className="panel-stat-value" style={{ color: worstColor }}>
            {totals.worst ?? "None"}
          </div>
          <div className="panel-stat-key">Worst severity</div>
        </div>
      </div>

      <div className="panel-meta">
        <MetaRow
          label="Format"
          value={format}
          onClick={format && onFormatFilterChange
            ? () => onFormatFilterChange(formatFilter === format.toLowerCase() ? null : format.toLowerCase())
            : undefined}
          active={!!format && formatFilter === format.toLowerCase()}
        />
        <MetaRow label="Repository" value={`${owner}/${repo}`} />
      </div>

      <div className="panel-section">
        <h3 className="section-title">Versions</h3>

        {nodes.length > 6 && (
          <input
            className="cve-search-input group-search"
            placeholder="Filter by version, tag or architecture…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}

        {loading && !detail && (
          <p className="cve-empty">Loading version details…</p>
        )}

        {rows.length === 0 ? (
          <p className="cve-empty">No versions match that filter.</p>
        ) : (
          <ul className="group-version-list">
            {rows.map(({ node, meta }) => {
              const sev = node.data.max_severity || "None";
              const version = node.data.version;
              const digest = isDigest(version);
              /* A Docker version is the manifest digest, which nobody reads
                 and which is the same width as the panel. When there is a tag
                 that names the thing — 24-slim, 26.7-slim — that leads, and
                 the digest drops to the meta line in short form. */
              /* The registry's own "version" tags first: those are what a
                 person typed — 24-slim, 26.7-slim, latest. The other
                 categories are provenance (upstream, index-docker-io) and are
                 identical on every row in the group, so leading with one of
                 those labelled six different images the same. */
              const versionTags = (meta?.tags?.version ?? []).filter((t) => !isDigest(t));
              const otherTags = Object.entries(meta?.tags ?? {})
                .filter(([category]) => category !== "version")
                .flatMap(([, values]) => values);
              const label = digest
                ? (versionTags[0] ?? shortDigest(version))
                : version;
              const rest = [...versionTags, ...otherTags]
                .filter((t) => t !== label && !ubiquitousTags.has(t));
              /* Only when the label is a tag: otherwise the label already is
                 the short digest and the meta line repeated it verbatim. */
              const showDigest = digest && label !== shortDigest(version);
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    className="group-version-row"
                    data-severity={sev !== "None" && sev !== "Unknown" ? sev : undefined}
                    onClick={() => onNodeSelect?.(node.id)}
                    title={`${node.label} ${version}`}
                  >
                    <span className="group-version-label">{label}</span>

                    {sev !== "None" && sev !== "Unknown" && (
                      <span className="severity-badge group-version-badge" data-severity={sev}>
                        {sev}
                        {node.data.vuln_count > 0 && (
                          <span className="group-version-count">{node.data.vuln_count}</span>
                        )}
                      </span>
                    )}

                    {/* Everything below needs the fetched detail, so the row
                        stays useful — label and severity — without it. */}
                    <span className="group-version-meta">
                      {showDigest && <code>{shortDigest(version)}</code>}
                      {meta?.type_display && <span>{meta.type_display}</span>}
                      {meta?.architectures?.map((a) => (
                        <span key={a} className="group-version-arch">{a}</span>
                      ))}
                    </span>

                    {rest.length > 0 && (
                      <span className="group-version-tags">
                        {rest.slice(0, TAGS_PER_ROW).map((t) => (
                          <span key={t} className="pkg-tag" title={t}>
                            {isDigest(t) ? shortDigest(t) : t}
                          </span>
                        ))}
                        {rest.length > TAGS_PER_ROW && (
                          <span className="group-version-more">+{rest.length - TAGS_PER_ROW}</span>
                        )}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** "docker_platform_os" -> "Docker platform os". Identifier keys come straight
 *  from the registry and are snake_case machine names. */
function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * One digest, click to copy.
 *
 * A SHA-512 is 128 characters — far too wide for the panel and useless
 * truncated, since the reason to look at a digest is to compare it. It wraps,
 * and the whole row is a copy button so nobody has to select it by hand.
 */
function Digest({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`pkg-digest${copied ? " copied" : ""}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          /* Clipboard access can be refused; the digest is still on screen to
             be copied by hand, so this is not worth an error state. */
          () => {},
        );
      }}
      title={copied ? "Copied" : `Copy ${label}`}
    >
      <span className="pkg-digest-label">{copied ? "Copied" : label}</span>
      <code className="pkg-digest-value">{value}</code>
    </button>
  );
}

/**
 * Inline "still loading" mark.
 *
 * Sized to sit on a line of text rather than to be noticed: these appear beside
 * labels that already say what is coming, so the spinner only needs to say
 * "not yet", not "look here".
 */
function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="inline-spinner" role="status" aria-label={label} />;
}

function MetaRow({
  label,
  value,
  valueColor,
  onClick,
  active,
}: {
  label: string;
  value: string;
  valueColor?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const text = value || "—";
  return (
    <>
      <span className="meta-label">{label}</span>
      {onClick ? (
        <button
          type="button"
          className={`meta-value meta-value-clickable${active ? " active" : ""}`}
          style={valueColor ? { color: valueColor, fontWeight: 600 } : undefined}
          onClick={onClick}
          title={active ? "Clear filter" : `Filter graph by ${value}`}
        >
          {text}
        </button>
      ) : (
        <span className="meta-value" style={valueColor ? { color: valueColor, fontWeight: 600 } : undefined}>
          {text}
        </span>
      )}
    </>
  );
}

/* `description` is passed in rather than read off `cve`: it arrives from
   /api/cve after the graph has rendered, and falls back to the record's own
   value when the graph still carries one. */
function CveCard({ cve, description }: { cve: CVERecord; description: string }) {
  const color = SEVERITY_COLORS[cve.severity] || "var(--fg-n-600)";
  return (
    <div className="cve-card" style={{ borderLeftColor: color }}>
      <div className="cve-header">
        <span className="cve-id">{cve.id || "Unknown"}</span>
        <span
          className="cve-severity-badge"
          style={{ color, borderColor: color }}
        >
          {cve.severity}
        </span>
      </div>
      {cve.affected && (
        <div className="cve-affected">
          📦 <strong>Affected:</strong> {cve.affected}
          {cve.affected_version ? ` @ ${cve.affected_version}` : ""}
        </div>
      )}
      {cve.fixed_in && (
        <div className="cve-fixed">
          ✅ <strong>Fixed in:</strong> {cve.fixed_in}
        </div>
      )}
      {description && (
        <div className="cve-description">
          {description.length > 250
            ? description.slice(0, 250) + "…"
            : description}
        </div>
      )}
      <div className="cve-links">
        {cve.nvd_url && (
          <a href={cve.nvd_url} target="_blank" rel="noopener noreferrer">
            🛡 NVD
          </a>
        )}
        {cve.ghsa_url && (
          <a href={cve.ghsa_url} target="_blank" rel="noopener noreferrer">
            📋 GitHub Advisory
          </a>
        )}
        {cve.url && cve.url !== cve.nvd_url && cve.url !== cve.ghsa_url && (
          <a href={cve.url} target="_blank" rel="noopener noreferrer">
            🔗 Advisory
          </a>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Dependency Detail View
   ================================================================ */

function DependencyDetail({
  data,
  node,
  expanded = false,
  severities = EMPTY_SEVERITIES,
  onSeveritiesChange,
  onNodeSelect,
}: {
  data: GraphResponse;
  node: GraphNode;
  expanded?: boolean;
  severities?: Set<Severity>;
  onSeveritiesChange?: (s: Set<Severity>) => void;
  onNodeSelect?: (id: string) => void;
}) {
  const [pkgQuery, setPkgQuery] = useState("");

  const toggleSeverity = (s: Severity) => {
    if (!onSeveritiesChange) return;
    const next = new Set(severities);
    if (next.has(s)) next.delete(s); else next.add(s);
    onSeveritiesChange(next);
  };

  const linkedPackages = useMemo(() => {
    const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const list: { pkg: GraphNode; versionExpr: string }[] = [];
    for (const e of data.edges) {
      if (e.type !== "dependency" || e.target !== node.id) continue;
      if (seen.has(e.source)) continue;
      seen.add(e.source);
      const src = nodeMap.get(e.source);
      if (src) list.push({ pkg: src, versionExpr: e.label || "" });
    }
    list.sort((a, b) => {
      const bv = (b.pkg.data.vuln_count || 0) - (a.pkg.data.vuln_count || 0);
      return bv !== 0 ? bv : a.pkg.label.localeCompare(b.pkg.label);
    });
    return list;
  }, [data, node.id]);

  const filtered = pkgQuery
    ? linkedPackages.filter(({ pkg }) => pkg.label.toLowerCase().includes(pkgQuery.toLowerCase()))
    : linkedPackages;

  return (
    <div className={`side-panel${expanded ? " side-panel-expanded" : ""}`}>
      <div className="panel-summary">
        <div className="panel-header">
          <h2 className="panel-title">{node.label}</h2>
          {node.data.version && (
            <span className="panel-version">
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>requires </span>
              <VersionString version={node.data.version} mono />
            </span>
          )}
        </div>
        <div className="dep-panel-type-row">
          <span className="dep-panel-badge">Dependency</span>
          <span className="dep-panel-count">{linkedPackages.length} {linkedPackages.length === 1 ? "package" : "packages"}</span>
        </div>
      </div>

      <div className="panel-details">
        <div className="panel-section">
          <h3 className="section-title">Linked packages</h3>
          <input
            className="dep-panel-search"
            type="search"
            placeholder="Filter packages…"
            value={pkgQuery}
            onChange={(e) => setPkgQuery(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="dep-panel-empty">{pkgQuery ? "No matches" : "No linked packages"}</p>
          ) : (
            <ul className="dep-pkg-list">
              {filtered.map(({ pkg, versionExpr }) => {
                const sev = pkg.data.max_severity || "None";
                const sevColor = SEVERITY_COLORS[sev] || SEVERITY_COLORS.None;
                const isActive = severities.has(sev as Severity);
                return (
                  <li key={pkg.id} className="dep-pkg-row">
                    <button
                      type="button"
                      className="dep-pkg-name"
                      onClick={() => onNodeSelect?.(pkg.id)}
                      title={`Select ${pkg.label}`}
                    >
                      <span className="dep-pkg-label">{pkg.label}</span>
                      {pkg.data.version && <span className="dep-pkg-version">{pkg.data.version}</span>}
                      {versionExpr && <span className="dep-pkg-expr" title="Required version expression">{versionExpr}</span>}
                    </button>
                    {sev !== "None" && (
                      <button
                        type="button"
                        className={`severity-badge severity-badge-clickable${isActive ? " active" : ""}`}
                        data-severity={sev}
                        onClick={() => toggleSeverity(sev as Severity)}
                        title={isActive ? `Clear ${sev} filter` : `Add ${sev} to the filter`}
                      >
                        {sev}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Repo Detail View
   ================================================================ */

function RepoDetail({
  data,
  node,
  owner,
  repo,
  expanded = false,
  severities = EMPTY_SEVERITIES,
  formatFilter = null,
  onSeveritiesChange,
  onFormatFilterChange,
  onNodeSelect,
}: {
  data: GraphResponse;
  node: GraphNode;
  owner: string;
  repo: string;
  expanded?: boolean;
  severities?: Set<Severity>;
  formatFilter?: string | null;
  onSeveritiesChange?: (s: Set<Severity>) => void;
  onFormatFilterChange?: (f: string | null) => void;
  onNodeSelect?: (id: string) => void;
}) {
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function handleRepoReport() {
    if (reportLoading || reportDone) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const resp = await apiFetch(
        `/api/vulnly-repo-report/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?theme=${currentTheme()}`,
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vulnly-${owner}-${repo}-repo-summary.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setReportDone(true);
      setTimeout(() => setReportDone(false), 2500);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setReportLoading(false);
    }
  }

  const stats = useMemo(() => {
    const packages = data.nodes.filter((n) => n.type === "package");
    const deps = data.nodes.filter((n) => n.type === "dependency");

    /* Format breakdown */
    const formatCounts: Record<string, number> = {};
    const filteredFormatCounts: Record<string, number> = {};
    for (const p of packages) {
      const f = p.data.format || "unknown";
      formatCounts[f] = (formatCounts[f] || 0) + 1;
      if (packageMatchesFilter(p, severities)) {
        filteredFormatCounts[f] = (filteredFormatCounts[f] || 0) + 1;
      }
    }
    const formats = Object.entries(formatCounts)
      .sort((a, b) => b[1] - a[1]);

    /* Vulnerability breakdown */
    let totalVulns = 0;
    const sevCounts: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    const allCves = new Set<string>();
    for (const p of packages) {
      totalVulns += p.data.vuln_count;
      for (const c of p.data.cves) {
        if (c.id) allCves.add(c.id);
        if (sevCounts[c.severity] !== undefined) {
          sevCounts[c.severity]++;
        }
      }
    }

    /* Packages with most vulns */
    const topVuln = [...packages]
      .filter((p) => p.data.vuln_count > 0)
      .sort((a, b) => b.data.vuln_count - a.data.vuln_count)
      .slice(0, 5);

    return { packages, deps, formats, filteredFormatCounts, totalVulns, sevCounts, uniqueCves: allCves.size, topVuln };
  }, [data, severities]);

  const repoUrl = `https://app.cloudsmith.com/${owner}/r/${repo}/`;

  const toggleSeverity = (s: Severity) => {
    if (!onSeveritiesChange) return;
    const next = new Set(severities);
    if (next.has(s)) next.delete(s); else next.add(s);
    onSeveritiesChange(next);
  };
  const toggleFormat = (f: string) => {
    if (!onFormatFilterChange) return;
    onFormatFilterChange(formatFilter === f ? null : f);
  };

  return (
    <div className={`side-panel${expanded ? " side-panel-expanded" : ""}`}>
      <div className="panel-summary">
      <div className="panel-header">
        {/* The Cloudsmith logo used to sit here as a 36px avatar. It is not
            our mark and it made the panel read as Cloudsmith's own UI; the
            repository name is the thing the user is looking at, so it leads.
            The "View in Cloudsmith" link below stays — it goes there, and §8
            says to name things by what the user controls. */}
        <div className="repo-header-row">
          <div>
            <span className="panel-eyebrow">Repository</span>
            <h2 className="panel-title">{node.label}</h2>
            <span className="panel-version">{owner}</span>
          </div>
        </div>
      </div>

      <div className="panel-status-row">
        <a
          className="cloudsmith-view-btn"
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="View in Cloudsmith"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
        <button
          className={`vulnly-report-btn${reportDone ? " vulnly-report-btn-done" : ""}`}
          onClick={handleRepoReport}
          disabled={reportLoading || reportDone}
          title={reportLoading ? "Generating report…" : reportDone ? "Report downloaded" : "Download Vulnly repo summary report"}
        >
          {reportLoading ? (
            <span className="vulnly-spinner" aria-hidden="true" />
          ) : reportDone ? (
            <span aria-hidden="true">✓</span>
          ) : (
            <span aria-hidden="true">⬇</span>
          )}
          <span>{reportLoading ? "Generating…" : reportDone ? "Downloaded!" : "Vulnly Report"}</span>
        </button>
      </div>
      {reportError && (
        <div className="vulnly-report-error" role="alert">⚠ {reportError}</div>
      )}

      {/* Overview cards */}
      <div className="repo-cards">
        <div className="repo-card">
          <span className="repo-card-value">{stats.packages.length}</span>
          <span className="repo-card-label">Packages</span>
        </div>
        <div className="repo-card">
          <span className="repo-card-value">{stats.deps.length}</span>
          <span className="repo-card-label">Dependencies</span>
        </div>
        <div className="repo-card">
          <span className="repo-card-value">{stats.uniqueCves}</span>
          <span className="repo-card-label">Unique CVEs</span>
        </div>
        <div className="repo-card">
          <span className="repo-card-value">{stats.totalVulns}</span>
          <span className="repo-card-label">Total findings</span>
        </div>
      </div>
      </div>

      <div className="panel-details">

      {/* Format breakdown */}
      <div className="panel-section">
        <h3 className="section-title">Package formats</h3>
        <div className="repo-format-grid">
          {stats.formats.map(([fmt, count]) => {
            const icon = getFormatIcon(fmt);
            const fmtKey = fmt.toLowerCase();
            const active = formatFilter === fmtKey;
            const filteredCount = stats.filteredFormatCounts[fmt] ?? 0;
            const dimmed = severities.size > 0 && filteredCount === 0;
            const clickable = !!onFormatFilterChange && fmt !== "unknown" && !dimmed;
            return (
              <button
                key={fmt}
                type="button"
                className={`repo-format-card${clickable ? " repo-format-card-clickable" : ""}${active ? " active" : ""}${dimmed ? " repo-format-card-dimmed" : ""}`}
                onClick={clickable ? () => toggleFormat(fmtKey) : undefined}
                disabled={!clickable}
                title={dimmed ? `No matching packages in ${fmt}` : active ? "Clear format filter" : `Filter graph by ${fmt}`}
              >
                {severities.size > 0 && filteredCount > 0 && (
                  <span className="repo-format-card-filter-badge">{filteredCount}</span>
                )}
                <div className="repo-format-card-icon">
                  {icon ? (
                    <img src={icon} alt={fmt} />
                  ) : (
                    <span className="repo-format-card-icon-fallback">{fmt.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="repo-format-card-meta">
                  <span className="repo-format-card-name">{fmt}</span>
                  <span className="repo-format-card-count">{count}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Severity breakdown */}
      {(["Critical", "High", "Medium", "Low"] as const).some((s) => stats.sevCounts[s] > 0) && (
        <div className="panel-section">
          <h3 className="section-title">Severity breakdown</h3>
          <div className="repo-sev-bars">
            {(["Critical", "High", "Medium", "Low"] as const)
              .filter((s) => stats.sevCounts[s] > 0)
              .map((s) => {
                const count = stats.sevCounts[s];
                const max = Math.max(...Object.values(stats.sevCounts), 1);
                const active = severities.has(s);
                const clickable = !!onSeveritiesChange && count > 0;
                return (
                  <button
                    key={s}
                    type="button"
                    className={`repo-sev-row${clickable ? " repo-sev-row-clickable" : ""}${active ? " active" : ""}`}
                    onClick={clickable ? () => toggleSeverity(s) : undefined}
                    disabled={!clickable}
                    title={active ? `Clear ${s} filter` : `Filter graph by ${s}`}
                  >
                    <span className="repo-sev-label" style={{ color: SEVERITY_COLORS[s] }}>{s}</span>
                    <div className="repo-sev-track">
                      <div
                        className="repo-sev-fill"
                        style={{ width: `${(count / max) * 100}%`, background: SEVERITY_COLORS[s] }}
                      />
                    </div>
                    <span className="repo-sev-count">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Most vulnerable packages */}
      {stats.topVuln.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">Most vulnerable</h3>
          <div className="repo-top-vuln">
            {stats.topVuln.map((p) => {
              const s = p.data.max_severity || "None";
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`repo-vuln-row${onNodeSelect ? " repo-vuln-row-clickable" : ""}`}
                  onClick={onNodeSelect ? () => { onSeveritiesChange?.(new Set()); onNodeSelect(p.id); } : undefined}
                  disabled={!onNodeSelect}
                  title={onNodeSelect ? `Select ${p.label}` : undefined}
                >
                  <span className="repo-vuln-name">{p.label}</span>
                  <span
                    className="repo-vuln-badge severity-badge"
                    data-severity={s}
                    title={`${p.data.vuln_count} ${p.data.vuln_count === 1 ? "vulnerability" : "vulnerabilities"}, highest severity ${s}`}
                  >
                    <SeverityMark severity={s} />
                    {p.data.vuln_count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
