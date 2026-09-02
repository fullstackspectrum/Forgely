import type { GraphResponse, GraphNode, GraphEdge } from "../types";
import { SEVERITY_RANK } from "../types";

/**
 * Collapse packages that share a name into one node per name.
 *
 * A repository holding fifty tagged builds of `library/node` draws fifty nodes
 * that all say the same thing. Measured on full-stack-spectrum/neuro-containers,
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
  /** Group node ids that are currently open, showing their versions. */
  openGroups: string[];
}

/** Hub-to-version edge, drawn only while a group is open. */
export const GROUP_MEMBER_EDGE = "group_member";

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
  const opened = new Map<string, GraphNode[]>();
  for (const [name, members] of byName) {
    if (members.length <= 1) continue;
    (expanded.has(name) ? opened : collapsed).set(name, members);
  }
  if (collapsed.size === 0 && opened.size === 0) {
    return { ...data, groupMembers: {}, openGroups: [] };
  }

  const standIn = new Map<string, string>();
  const groupMembers: Record<string, string[]> = {};
  const nodes: GraphNode[] = [];

  /** The group node standing for a set of versions, collapsed or open. */
  const hubFor = (name: string, members: GraphNode[]): GraphNode => {
    let severity: string | null = null;
    let vulnCount = 0;
    let downloads = 0;
    let quarantined = false;
    /* A scan that found nothing and a scan that never ran both rank 0, so
       `worse` cannot tell them apart — and a group with no vulnerable member
       would end up null, which the canvas reads as "Unknown" and
       hide-unsupported then removes. A group holding even one scanned package
       is not unscannable, so it floors at "None" instead. */
    let scanned = false;
    for (const m of members) {
      if (m.data.max_severity != null) scanned = true;
      severity = worse(severity, m.data.max_severity) ?? severity;
      vulnCount += m.data.vuln_count || 0;
      downloads += m.data.downloads || 0;
      quarantined = quarantined || !!m.data.is_quarantined;
    }
    return {
      id: GROUP_PREFIX + name,
      label: name,
      type: "package",
      data: {
        ...members[0].data,
        max_severity: severity ?? (scanned ? "None" : null),
        vuln_count: vulnCount,
        downloads,
        is_quarantined: quarantined,
        version: `${members.length} versions`,
      },
    };
  };

  /* Version id -> the open group it belongs to. An open group keeps its node:
     the versions hang off it rather than replacing it, so the thing that was
     clicked stays on screen as the centre they came out of. */
  const memberOf = new Map<string, string>();

  for (const node of data.nodes) {
    if (node.type !== "package") {
      nodes.push(node);
      continue;
    }
    const name = groupKeyOf(node);

    const open = opened.get(name);
    if (open) {
      nodes.push(node);
      memberOf.set(node.id, name);
      const gid = GROUP_PREFIX + name;
      if (!groupMembers[gid]) {
        groupMembers[gid] = open.map((m) => m.id);
        nodes.push(hubFor(name, open));
      }
      continue;
    }

    const members = collapsed.get(name);
    if (!members) {
      nodes.push(node);
      continue;
    }
    const gid = GROUP_PREFIX + name;
    standIn.set(node.id, gid);
    if (groupMembers[gid]) continue; // group node already emitted
    groupMembers[gid] = members.map((m) => m.id);
    nodes.push(hubFor(name, members));
  }

  /* Rewire edges onto the stand-in, dropping the duplicates that creates:
     fifty versions sharing one CVE collapse to a single edge, and a group
     pointing at itself is not a relationship. */
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of data.edges) {
    /* Two versions of one name sharing a CVE says nothing a reader does not
       already know, and it is most of the edges an open group would add. */
    const sName = memberOf.get(e.source);
    const tName = memberOf.get(e.target);
    if (sName && sName === tName) continue;

    let source = standIn.get(e.source) ?? e.source;
    let target = standIn.get(e.target) ?? e.target;
    /* The hub holds the group's place in the graph, so the repository still
       connects to it rather than to each version separately. */
    if (e.type === "repo_package") {
      if (sName) source = GROUP_PREFIX + sName;
      if (tName) target = GROUP_PREFIX + tName;
    }
    if (source === target) continue;
    const key = `${source} ${target} ${e.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...e, source, target });
  }

  /* The versions radiate from their hub. */
  for (const [name, members] of opened)
    for (const m of members)
      edges.push({ source: GROUP_PREFIX + name, target: m.id, type: GROUP_MEMBER_EDGE, label: "" });

  return { ...data, nodes, edges, groupMembers, openGroups: [...opened].map(([n]) => GROUP_PREFIX + n) };
}
