import type { GraphResponse, GraphNode, GraphEdge } from "../types";
import { SEVERITY_RANK } from "../types";

/**
 * Collapse packages that share a name into one node per name.
 *
 * A repository holding fifty tagged builds of `library/node` draws fifty nodes
 * that all say the same thing. Measured on a 300-package container repository,
 * 292 package nodes carry only 15 distinct names — a 95% reduction. On a
 * language repo the effect is smaller (7,490 to 6,947) but never harmful.
 *
 * Grouping happens on the client rather than in the API: the graph is already
 * streamed and cached, so expanding a group is a local transform rather than a
 * refetch.
 *
 * A group carries the *highest* severity among its members. Understating risk
 * in order to summarise is the one thing a security view must not do.
 */

export const GROUP_PREFIX = "group:";

/** The name a package node groups under. */
export function groupKeyOf(node: GraphNode): string {
  return node.label || node.id.split("@")[0];
}

const worse = (a: string | null | undefined, b: string | null | undefined) =>
  (SEVERITY_RANK[b ?? ""] ?? 0) > (SEVERITY_RANK[a ?? ""] ?? 0) ? b : a;

export interface GroupedGraph extends GraphResponse {
  /** Group node id, mapped to the package node ids it stands for. */
  groupMembers: Record<string, string[]>;
}

/**
 * @param expanded Package names whose versions should be shown individually.
 */
export function groupPackages(data: GraphResponse, expanded: Set<string>): GroupedGraph {
  const byName = new Map<string, GraphNode[]>();
  for (const n of data.nodes) {
    if (n.type !== "package") continue;
    const key = groupKeyOf(n);
    const list = byName.get(key);
    if (list) list.push(n);
    else byName.set(key, [n]);
  }

  /* A name with one version gains nothing from a wrapper, so it stays itself.
     Otherwise a language repo would wrap several thousand nodes for no
     reduction at all. */
  const collapsed = new Map<string, GraphNode[]>();
  for (const [name, members] of byName) {
    if (members.length > 1 && !expanded.has(name)) collapsed.set(name, members);
  }
  if (collapsed.size === 0) return { ...data, groupMembers: {} };

  const standIn = new Map<string, string>();
  const groupMembers: Record<string, string[]> = {};
  const nodes: GraphNode[] = [];

  for (const node of data.nodes) {
    if (node.type !== "package") {
      nodes.push(node);
      continue;
    }
    const members = collapsed.get(groupKeyOf(node));
    if (!members) {
      nodes.push(node);
      continue;
    }
    const name = groupKeyOf(node);
    const gid = GROUP_PREFIX + name;
    standIn.set(node.id, gid);
    if (groupMembers[gid]) continue; // group node already emitted

    groupMembers[gid] = members.map((m) => m.id);
    let severity: string | null = null;
    let vulnCount = 0;
    let downloads = 0;
    let quarantined = false;
    for (const m of members) {
      severity = worse(severity, m.data.max_severity) ?? severity;
      vulnCount += m.data.vuln_count || 0;
      downloads += m.data.downloads || 0;
      quarantined = quarantined || !!m.data.is_quarantined;
    }

    nodes.push({
      id: gid,
      label: name,
      type: "package",
      data: {
        ...members[0].data,
        max_severity: severity,
        vuln_count: vulnCount,
        downloads,
        is_quarantined: quarantined,
        version: `${members.length} versions`,
      },
    });
  }

  /* Rewire edges onto the stand-in, dropping the duplicates that creates:
     fifty versions sharing one CVE collapse to a single edge, and a group
     pointing at itself is not a relationship. */
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of data.edges) {
    const source = standIn.get(e.source) ?? e.source;
    const target = standIn.get(e.target) ?? e.target;
    if (source === target) continue;
    const key = `${source} ${target} ${e.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...e, source, target });
  }

  return { ...data, nodes, edges, groupMembers };
}
