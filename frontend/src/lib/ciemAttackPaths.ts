import type { OrgGraphResponse, OrgGraphNode } from "../types";

export type Permission = "Admin" | "Write";

export interface AttackPath {
  identityId: string;
  teamId:     string | null;
  repoId:     string;
  permission: Permission;
  pathType:   "direct" | "indirect";
}

export interface IdentityRisk {
  nodeId:         string;
  node:           OrgGraphNode;
  paths:          AttackPath[];
  permissions:    Set<Permission>;
  repoCount:      number;
  isServiceAdmin: boolean;
  isBroadAccess:  boolean;
  riskScore:      number;
}

function parsePermission(label: string): Permission | null {
  const l = label.toLowerCase();
  // "Owner" is Cloudsmith's top level — treat as Admin
  if (l.includes("owner") || l.includes("admin")) return "Admin";
  if (l.includes("write"))                         return "Write";
  return null;
}

export function computeAttackPaths(data: OrgGraphResponse): IdentityRisk[] {
  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));

  /* ── Build lookup tables in a single pass over edges ──────── */

  // identity id → team ids the identity belongs to
  const identityTeams = new Map<string, string[]>();

  // team id → { repoId, permission }[] (repos accessible by that team)
  const teamRepos = new Map<string, { repoId: string; permission: Permission }[]>();

  // identity id → { repoId, permission }[] (repos accessible directly)
  const identityDirectRepos = new Map<string, { repoId: string; permission: Permission }[]>();

  for (const e of data.edges) {
    if (e.type === "team_member") {
      // source = user/service, target = team
      const srcNode = nodeMap.get(e.source);
      if (!srcNode || (srcNode.type !== "user" && srcNode.type !== "service")) continue;
      const list = identityTeams.get(e.source) ?? [];
      list.push(e.target);
      identityTeams.set(e.source, list);
      continue;
    }

    if (e.type === "access") {
      const perm = parsePermission(e.label);
      if (!perm) continue;
      const src = nodeMap.get(e.source);
      if (!src) continue;

      if (src.type === "user" || src.type === "service") {
        const list = identityDirectRepos.get(e.source) ?? [];
        list.push({ repoId: e.target, permission: perm });
        identityDirectRepos.set(e.source, list);
      } else if (src.type === "team") {
        const list = teamRepos.get(e.source) ?? [];
        list.push({ repoId: e.target, permission: perm });
        teamRepos.set(e.source, list);
      }
    }
  }

  /* ── Compute paths for every identity ─────────────────────── */

  // Collect all identity IDs that appear in any access context
  const allIdentityIds = new Set([
    ...identityDirectRepos.keys(),
    ...identityTeams.keys(),
  ]);

  const result: IdentityRisk[] = [];

  for (const identityId of allIdentityIds) {
    const node = nodeMap.get(identityId);
    if (!node || (node.type !== "user" && node.type !== "service")) continue;

    const paths: AttackPath[] = [];

    // Direct paths: identity has an access edge directly to a repo
    for (const { repoId, permission } of identityDirectRepos.get(identityId) ?? []) {
      paths.push({ identityId, teamId: null, repoId, permission, pathType: "direct" });
    }

    // Indirect paths: identity is a member of a team that has access to a repo
    for (const teamId of identityTeams.get(identityId) ?? []) {
      for (const { repoId, permission } of teamRepos.get(teamId) ?? []) {
        paths.push({ identityId, teamId, repoId, permission, pathType: "indirect" });
      }
    }

    if (paths.length === 0) continue;

    /* Deduplicate: for a given repo keep one path per (teamId | direct) route.
       If the identity has BOTH direct AND team-based access to the same repo,
       keep both so the team membership is visible.  Only collapse multiple
       indirect entries for the *exact same team → repo* pair (which would be
       duplicate edges in the data). */
    const seen = new Set<string>();
    const deduped: AttackPath[] = [];
    for (const p of paths) {
      const key = `${p.repoId}::${p.teamId ?? "direct"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(p);
    }

    // Sort: Admin first, then Write; direct before indirect; then by repoId
    deduped.sort((a, b) => {
      if (a.permission !== b.permission) return a.permission === "Admin" ? -1 : 1;
      if (a.pathType  !== b.pathType)   return a.pathType  === "direct" ? -1 : 1;
      return a.repoId.localeCompare(b.repoId);
    });

    const permissions = new Set<Permission>(deduped.map((p) => p.permission));
    const repoCount   = new Set(deduped.map((p) => p.repoId)).size;
    const hasAdmin    = permissions.has("Admin");
    const isServiceAdmin = node.type === "service" && hasAdmin;
    const isBroadAccess  = repoCount > 3;

    let riskScore = 0;
    if (hasAdmin) riskScore += 40;
    if (permissions.has("Write")) riskScore += 20;
    if (isBroadAccess) riskScore += repoCount * 3;
    if (isServiceAdmin) riskScore += 30;

    result.push({
      nodeId: identityId, node, paths: deduped,
      permissions, repoCount, isServiceAdmin, isBroadAccess, riskScore,
    });
  }

  return result.sort((a, b) => b.riskScore - a.riskScore);
}

export function getIdentityRisk(data: OrgGraphResponse, identityId: string): IdentityRisk | null {
  return computeAttackPaths(data).find((r) => r.nodeId === identityId) ?? null;
}
