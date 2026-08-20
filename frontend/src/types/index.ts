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
  type: "repo_package" | "dependency" | "shared_cve";
  label: string;
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

export type OrgNodeFilter = "all" | "repo" | "user" | "service" | "team" | "entitlement" | "upstream";

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
   whole job is encoding distance in blue. */
export const ORG_NODE_COLORS: Record<string, string> = {
  get org() { return token("--c-action"); },
  get repo() { return token("--fg-blue-300"); },
  get user() { return token("--fg-blue-200"); },
  get service() { return token("--fg-blue-100"); },
  get team() { return token("--fg-n-400"); },
  get entitlement() { return token("--c-origin"); },
  get upstream() { return token("--fg-n-300"); },
};
