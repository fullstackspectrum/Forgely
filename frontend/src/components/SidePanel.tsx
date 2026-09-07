/**
 * Picks the detail panel for whatever is selected.
 *
 * Four kinds of node get four genuinely different views — a package, a group
 * standing for several versions of one, a transitive dependency, and the
 * repository itself. They used to share one 1,700-line module in which the
 * package view was also the router, which meant the package's own hooks ran
 * for every selection regardless of type and had to be passed empty arguments
 * to keep them quiet.
 *
 * Routing here instead means each panel mounts only when it is the answer.
 */
import type { GraphResponse, Severity } from "../types";
import { GROUP_PREFIX } from "../lib/groupPackages";
import { EMPTY_SEVERITIES } from "./panels/shared";
import PackagePanel from "./panels/PackagePanel";
import GroupPanel from "./panels/GroupPanel";
import DependencyPanel from "./panels/DependencyPanel";
import RepoPanel from "./panels/RepoPanel";

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
  /** Open the identity graph focused on the repository holding this package. */
  onViewInCiem?: (repoSlug: string) => void;
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
  onViewInCiem,
}: Props) {
  /* A group node stands for several packages and is not in `data` at all —
     the grouping is a client-side transform over these same nodes. */
  if (nodeId.startsWith(GROUP_PREFIX)) {
    return (
      <GroupPanel
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

  const node = data.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  if (node.type === "repo") {
    return (
      <RepoPanel
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

  if (node.type === "dependency") {
    return (
      <DependencyPanel
        data={data}
        node={node}
        expanded={expanded}
        severities={severities}
        onSeveritiesChange={onSeveritiesChange}
        onNodeSelect={onNodeSelect}
      />
    );
  }

  return (
    <PackagePanel
      data={data}
      nodeId={nodeId}
      owner={owner}
      repo={repo}
      expanded={expanded}
      severities={severities}
      formatFilter={formatFilter}
      onSeveritiesChange={onSeveritiesChange}
      onFormatFilterChange={onFormatFilterChange}
      onNodeSelect={onNodeSelect}
      onOpenAttackGraph={onOpenAttackGraph}
      onViewInCiem={onViewInCiem}
    />
  );
}
