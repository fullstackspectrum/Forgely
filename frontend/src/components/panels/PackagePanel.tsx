/**
 * A single package: what it is, what is wrong with it, and who can reach it.
 *
 * Rendered only for package nodes. That matters beyond tidiness — its hooks
 * (package detail, CVE descriptions, repository access) used to sit above the
 * routing returns in SidePanel, so selecting a repository or a dependency
 * still mounted every one of them and they had to be neutered with empty
 * arguments. Now they only run when a package is actually selected.
 */
import { useMemo, useState } from "react";
import { currentTheme } from "../../lib/theme";
import SeverityMark from "../SeverityMark";
import type { GraphNode, GraphResponse, RepoIdentity, Severity } from "../../types";
import { SEVERITY_COLORS, SEVERITY_RANK } from "../../types";
import { useCveDescriptions } from "../../hooks/useCveDescriptions";
import { usePackageDetail } from "../../hooks/usePackageDetail";
import { useRepoAccess } from "../../hooks/useRepoAccess";
import { apiFetch } from "../../lib/auth";
import {
  ACCESS_ROWS, AccessRow, CveCard, Digest, EMPTY_SEVERITIES, MetaRow, Spinner,
  VersionString, humanise,
} from "./shared";

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
  /* Open the identity graph focused on the repository holding this package. */
  onViewInCiem?: (repoSlug: string) => void;
}

export default function PackagePanel({
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
  onViewInCiem,
}: Props) {
  const [sevFilter, setSevFilter] = useState<string>("All");
  const [showSharedOnly, setShowSharedOnly] = useState(false);
  const [cveQuery, setCveQuery] = useState<string>("");
  const [cvePage, setCvePage] = useState(0);
  const [depsExpanded, setDepsExpanded] = useState(false);
  /* Reachability is a different question from "what is this package", and
     answering it inline meant scrolling past every digest and tag to reach it. */
  const [panelTab, setPanelTab] = useState<"details" | "vulns" | "deps" | "reach">("details");
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

  /* All three hooks run before the early return below, because a hook skipped
     on one render changes the order React counts on. They take an empty
     argument instead, which each hook treats as "nothing to fetch".
     
     The condition is only whether the node exists: the router guarantees the
     type, so the `node.type === "package"` these used to carry was checking
     something already decided one level up.
     
     Everything here is fetched on selection rather than carried in the graph
     payload — CVE descriptions alone were 21.5 MB of a 29.2 MB response. */
  const slug = node?.data.slug ?? "";

  const { descriptions: cveDescriptions, loading: cveLoading } = useCveDescriptions(
    owner,
    repo,
    node && node.data.cves.length > 0 ? slug : "",
  );

  const { detail, loading: detailLoading } = usePackageDetail(owner, repo, slug);

  /* Keyed on the repository, so clicking between packages in it does not
     refetch. */
  const { access, loading: accessLoading } = useRepoAccess(
    node ? owner : "",
    node ? repo : "",
  );

  /* The router only sends packages here, but the node can still be missing
     for a frame while the graph rebuilds under a held selection. */
  if (!node || node.type !== "package") return null;

  /* Dependencies are not universal: plenty of formats do not declare them and
     Cloudsmith does not resolve them for every one that does. The tab is only
     offered when there is something behind it.
     
     Derived rather than corrected in an effect, because the selection can
     change under a held tab — click a package with dependencies, open the tab,
     click one without — and an effect would render the empty tab once before
     fixing it. */
  const hasDeps = dependencies.length > 0;
  const activeTab = panelTab === "deps" && !hasDeps ? "details" : panelTab;

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

      {/* The actions belong with what they act on: they were below the
          severity badges, which put a row of state between the package's
          name and the things you can do to it. */}
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
          {/* Ahead of quarantine: malware is the worse fact, and this row is
              read left to right. Taken from the node rather than the fetched
              detail, so it appears with the panel rather than a moment later —
              the graph already carries the flag to draw the node's badge. */}
          {(d.is_malware_detected || detail?.is_malware_detected) && (
            <span className="malware-badge" title="Malware was detected in this package">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="7" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Malware
            </span>
          )}
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

      {/* Malware moved up to the status row beside quarantine: both are states
          of the package, and burying the worse one below the metadata meant it
          arrived with the detail fetch rather than with the panel. */}
      {detail?.policy_violated && (
        <div className="pkg-flags">
          <span className="pkg-flag pkg-flag-warn">Policy violated</span>
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
          aria-selected={activeTab === "details"}
          className={`panel-tab${activeTab === "details" ? " active" : ""}`}
          onClick={() => setPanelTab("details")}
        >
          Details
          {detailLoading && <Spinner />}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "vulns"}
          className={`panel-tab${activeTab === "vulns" ? " active" : ""}`}
          onClick={() => setPanelTab("vulns")}
        >
          Vulnerabilities
          {cveLoading
            ? <Spinner />
            : d.vuln_count > 0 && (
              /* Tinted by severity: the count is the one number on this panel
                 worth reading before deciding which tab to open. */
              <span className="panel-tab-count" data-severity={d.max_severity ?? undefined}>
                {d.vuln_count}
              </span>
            )}
        </button>
        {hasDeps && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "deps"}
            className={`panel-tab${activeTab === "deps" ? " active" : ""}`}
            onClick={() => setPanelTab("deps")}
          >
            Dependencies
            <span className="panel-tab-count">{dependencies.length}</span>
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "reach"}
          className={`panel-tab${activeTab === "reach" ? " active" : ""}`}
          onClick={() => setPanelTab("reach")}
        >
          Reachability
          {accessLoading
            ? <Spinner />
            : access && <span className="panel-tab-count">{access.identities.length}</span>}
        </button>
      </div>
      {activeTab === "reach" && (<>

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

          {/* The list below answers "who"; the graph answers "how" — which
              teams and entitlements the access actually runs through. */}
          {onViewInCiem && (
            <button
              type="button"
              className="access-ciem-btn"
              onClick={() => onViewInCiem(access.repo)}
              title={`Open the identity graph focused on ${access.repo}`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              View access graph
            </button>
          )}

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

      {activeTab === "details" && (<>
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


      </>)}

      {activeTab === "deps" && (<>
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
      </>)}

      {activeTab === "vulns" && (<>
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
