import { token } from "../lib/palette";

export interface CVERecord {
  id: string;
  severity: string;
  description: string;
  url: string;
  nvd_url: string;
  ghsa_url: string;
  affected: string;
  affected_version: string;
  fixed_in: string;
}

export interface NodeData {
  version: string;
  format: string;
  max_severity: string | null;
  vuln_count: number;
  cves: CVERecord[];
  downloads: number;
  license: string;
  size: number;
  scan_status: string;
  uploaded_at: string;
  slug: string;
  pkg_type: string;
  is_quarantined: boolean;
}

export interface GraphNode {
  id: string;
  label: string;
  type: "repo" | "package" | "dependency";
  data: NodeData;
}

export interface GraphEdge {
  source: string;
  target: string;
  /* "group_member" is added on the client when a package group is opened; the
     API never sends one. */
  type: "repo_package" | "dependency" | "shared_cve" | "group_member";
  label?: string;
}

export interface GraphStats {
  critical: number;
  high: number;
  medium: number;
  low: number;
  safe: number;
  total_cves: number;
  total_nodes: number;
  total_edges: number;
}

export interface GraphResponse {
  owner: string;
  repo: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export type FilterType =
  | "all"
  | "vulnerable"
  | "safe"
  | "quarantined"
  | "shared_cve"
  | "has_deps"
  | "Critical"
  | "High"
  | "Medium"
  | "Low";

export type LayoutType = "force" | "circular" | "radial" | "tree" | "horizontal";

export type EdgeStyle = "curved" | "straight";

/* Resolved from the stylesheet rather than duplicated, so there is one
   definition of severity colour. Getters rather than plain values because this
   module is evaluated during import, which can precede the stylesheet being
   applied — reading on first access defers that to render time.

   Consumers that render to the DOM should prefer `var(--s-critical)` directly;
   these exist for Sigma and canvas, which need a resolved string. */
export const SEVERITY_COLORS: Record<string, string> = {
  get Critical() { return token("--s-critical"); },
  get High() { return token("--s-high"); },
  get Medium() { return token("--s-medium"); },
  get Low() { return token("--s-low"); },
  get None() { return token("--s-none"); },
  get Unknown() { return token("--t-muted"); },
};

export const SEVERITY_RANK: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/* ===== Org-level graph types ===== */

/* Node types the CIEM graph can be filtered to.
 *
 * The filter is a *set* of these, and an empty set means everything. There is
 * no AND/OR mode as the SCA status filters have, because a node carries
 * exactly one type — "repo AND upstream" matches nothing by construction,
 * while the SCA flags describe independent properties one package can hold at
 * once. Selecting several types is therefore always a union. */
export type OrgNodeType = "repo" | "user" | "service" | "team" | "entitlement" | "upstream";

export interface OrgGraphNode {
  id: string;
  label: string;
  type: "org" | "repo" | "user" | "service" | "team" | "entitlement" | "upstream";
  data: Record<string, unknown>;
}

export interface OrgGraphEdge {
  source: string;
  target: string;
  type: "org_repo" | "member_org" | "service_org" | "team_org" | "team_member" | "access" | "entitlement_repo" | "repo_upstream" | "shared_upstream";
  label: string;
}

export interface OrgGraphStats {
  total_repos: number;
  total_members: number;
  total_services: number;
  total_teams: number;
  total_upstreams: number;
  shared_upstreams: number;
  total_nodes: number;
  total_edges: number;
}

export interface OrgGraphResponse {
  owner: string;
  nodes: OrgGraphNode[];
  edges: OrgGraphEdge[];
  stats: OrgGraphStats;
}

/* ===== Workspace package overview types ===== */

export interface WorkspaceCveSummary {
  id: string;
  severity: string;
  description: string;
  packages: string[];
}

export interface WorkspaceRepoSummary {
  slug: string;
  name: string;
  package_count: number;
  vuln_count: number;
  max_severity: string | null;
  critical: number;
  high: number;
  medium: number;
  low: number;
  safe: number;
  cves: WorkspaceCveSummary[];
  formats: Record<string, number>;
}

export interface WorkspaceOverviewResponse {
  owner: string;
  repos: WorkspaceRepoSummary[];
}

/* Node kinds in the org graph. These are categories, not severities, so they
   take the blue ramp plus one amber — the palette has no green, purple, pink
   or cyan, and inventing them would put six competing hues on a canvas whose
   whole job is encoding distance in blue.

   Ember belongs to the workspace and nothing else. BRANDING.md §1 allows one
   ember per view, and it marks the origin — the same role the repository plays
   in the package graph. Entitlements used to carry it, which put 51 embers on
   screen and left the origin with no way to stand out. */
export const ORG_NODE_COLORS: Record<string, string> = {
  get org() { return token("--g-org-org"); },
  get repo() { return token("--g-org-repo"); },
  get team() { return token("--g-org-team"); },
  get user() { return token("--g-org-user"); },
  get service() { return token("--g-org-service"); },
  get upstream() { return token("--g-org-upstream"); },
  get entitlement() { return token("--g-org-entitlement"); },
};

/* Shape per kind, mirroring the package graph's vocabulary.
 *
 * The mark is a grid of rounded squares around one displaced ember cell, so a
 * square is a Cloudsmith artefact store and the tilt is the origin. Identities
 * are circles, the family sharing a shape and separating by size. Upstreams
 * are hexagons for the same reason dependencies are in the package graph: they
 * sit outside the boundary and are a different kind of thing.
 *
 * Never colour alone (§2.4): every kind here differs from its neighbours in
 * shape or size as well as hue. */
export const ORG_NODE_SHAPE: Record<string, string> = {
  org: "tilted",
  repo: "square",
  entitlement: "square",   // a grant on a repo: same family, far less weight
  team: "circle",
  user: "circle",
  service: "triangle",
  upstream: "hexagon",
};
