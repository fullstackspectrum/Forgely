/**
 * One package name, and every version published under it.
 *
 * Shown when a collapsed group node is selected: the group is a client-side
 * transform, so it exists on the canvas but not in the graph payload.
 */
import { useMemo, useState } from "react";
import type { GraphResponse, PackageDetail } from "../../types";
import { SEVERITY_COLORS, SEVERITY_RANK } from "../../types";
import { usePackageGroup } from "../../hooks/usePackageGroup";
import { groupKeyOf, GROUP_PREFIX } from "../../lib/groupPackages";
import { getFormatIcon } from "../../lib/formatIcons";
import {
  MetaRow, TAGS_PER_ROW, isDigest, shortDigest,
} from "./shared";

export default function GroupPanel({
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
