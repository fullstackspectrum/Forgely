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
  | "shared_cve"
  | "has_deps"
  | "Critical"
  | "High"
  | "Medium"
  | "Low";

export type LayoutType = "force" | "circular" | "radial" | "tree" | "horizontal";

export type EdgeStyle = "curved" | "straight";

export const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ff4d4d",
  High: "#ff8c1a",
  Medium: "#ffd11a",
  Low: "#79b8ff",
  None: "#28a745",
  Unknown: "#666666",
};

export const SEVERITY_RANK: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/* ===== Org-level graph types ===== */

export type OrgNodeFilter = "all" | "repo" | "user" | "service" | "team" | "entitlement";

export interface OrgGraphNode {
  id: string;
  label: string;
  type: "org" | "repo" | "user" | "service" | "team" | "entitlement";
  data: Record<string, unknown>;
}

export interface OrgGraphEdge {
  source: string;
  target: string;
  type: "org_repo" | "member_org" | "service_org" | "access" | "entitlement_repo";
  label: string;
}

export interface OrgGraphStats {
  total_repos: number;
  total_members: number;
  total_services: number;
  total_nodes: number;
  total_edges: number;
}

export interface OrgGraphResponse {
  owner: string;
  nodes: OrgGraphNode[];
  edges: OrgGraphEdge[];
  stats: OrgGraphStats;
}

export const ORG_NODE_COLORS: Record<string, string> = {
  org: "#4a90d9",
  repo: "#28a745",
  user: "#ff8c1a",
  service: "#a76dff",
  team: "#ff4d87",
  entitlement: "#ffd11a",
};
