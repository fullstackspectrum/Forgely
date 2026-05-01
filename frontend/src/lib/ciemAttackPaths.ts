import type { OrgGraphResponse, OrgGraphNode } from "../types";

export type Permission = "Admin" | "Write";

export interface AttackPath {
  identityId: string;
  teamId: string | null;
  repoId: string;
  permission: Permission;
  pathType: "direct" | "indirect";
}

export interface IdentityRisk {
  nodeId: string;
  node: OrgGraphNode;
  paths: AttackPath[];
  permissions: Set<Permission>;
  repoCount: number;
  isServiceAdmin: boolean;
  isBroadAccess: boolean;
  riskScore: number;
}

function parsePermission(label: string): Permission | null {
  const l = label.toLowerCase();
  if (l.includes("admin")) return "Admin";
  if (l.includes("write")) return "Write";
  return null;
}

export function computeAttackPaths(data: OrgGraphResponse): IdentityRisk[] {
  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));

  // team → [member identityIds]
  const teamMembers = new Map<string, string[]>();
  for (const e of data.edges) {
    if (e.type !== "team_member") continue;
    if (!teamMembers.has(e.target)) teamMembers.set(e.target, []);
    teamMembers.get(e.target)!.push(e.source);
  }

  const pathsByIdentity = new Map<string, AttackPath[]>();

  function addPath(identityId: string, path: AttackPath) {
    if (!pathsByIdentity.has(identityId)) pathsByIdentity.set(identityId, []);
    pathsByIdentity.get(identityId)!.push(path);
  }

  for (const edge of data.edges) {
    if (edge.type !== "access") continue;
    const perm = parsePermission(edge.label);
    if (!perm) continue;

    const src = nodeMap.get(edge.source);
    if (!src) continue;

    if (src.type === "user" || src.type === "service") {
      addPath(edge.source, {
        identityId: edge.source,
        teamId: null,
        repoId: edge.target,
        permission: perm,
        pathType: "direct",
      });
    } else if (src.type === "team") {
      for (const memberId of teamMembers.get(edge.source) ?? []) {
        const member = nodeMap.get(memberId);
        if (!member || (member.type !== "user" && member.type !== "service")) continue;
        addPath(memberId, {
          identityId: memberId,
          teamId: edge.source,
          repoId: edge.target,
          permission: perm,
          pathType: "indirect",
        });
      }
    }
  }

  // Prefer direct over indirect for same identity+repo combination
  for (const [id, paths] of pathsByIdentity) {
    const directRepos = new Set(
      paths.filter((p) => p.pathType === "direct").map((p) => p.repoId),
    );
    pathsByIdentity.set(
      id,
      paths.filter((p) => p.pathType === "direct" || !directRepos.has(p.repoId)),
    );
  }

  const result: IdentityRisk[] = [];

  for (const [id, paths] of pathsByIdentity) {
    const node = nodeMap.get(id);
    if (!node) continue;

    // Admin-first, then Write; direct before indirect; then by repo id
    paths.sort((a, b) => {
      if (a.permission !== b.permission) return a.permission === "Admin" ? -1 : 1;
      if (a.pathType !== b.pathType) return a.pathType === "direct" ? -1 : 1;
      return a.repoId.localeCompare(b.repoId);
    });

    const permissions = new Set<Permission>(paths.map((p) => p.permission));
    const repoCount = new Set(paths.map((p) => p.repoId)).size;
    const hasAdmin = permissions.has("Admin");
    const isServiceAdmin = node.type === "service" && hasAdmin;
    const isBroadAccess = repoCount > 3;

    let riskScore = 0;
    if (hasAdmin) riskScore += 40;
    if (permissions.has("Write")) riskScore += 20;
    if (isBroadAccess) riskScore += repoCount * 3;
    if (isServiceAdmin) riskScore += 30;

    result.push({
      nodeId: id,
      node,
      paths,
      permissions,
      repoCount,
      isServiceAdmin,
      isBroadAccess,
      riskScore,
    });
  }

  return result.sort((a, b) => b.riskScore - a.riskScore);
}

export function getIdentityRisk(
  data: OrgGraphResponse,
  identityId: string,
): IdentityRisk | null {
  const all = computeAttackPaths(data);
  return all.find((r) => r.nodeId === identityId) ?? null;
}
