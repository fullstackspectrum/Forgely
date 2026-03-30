import { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth";

interface Namespace {
  slug: string;
  name: string;
  type: string;
}

interface Repo {
  slug: string;
  name: string;
  description: string;
  package_count: number;
}

interface Props {
  currentOwner: string;
  currentRepo: string;
  refreshKey: number;
  onSelect: (owner: string, repo: string) => void;
}

export default function RepoSelector({
  currentOwner,
  currentRepo,
  refreshKey,
  onSelect,
}: Props) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [owner, setOwner] = useState(currentOwner);
  const [repo, setRepo] = useState(currentRepo);
  const [loadingNs, setLoadingNs] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);

  /* Fetch namespaces on mount or when refreshKey changes */
  useEffect(() => {
    setLoadingNs(true);
    apiFetch("/api/namespaces")
      .then((r) => r.json())
      .then((data) => setNamespaces(Array.isArray(data) ? data : []))
      .catch(() => setNamespaces([]))
      .finally(() => setLoadingNs(false));
  }, [refreshKey]);

  /* Fetch repos when owner changes */
  useEffect(() => {
    if (!owner) {
      setRepos([]);
      return;
    }
    setLoadingRepos(true);
    apiFetch(`/api/repos/${encodeURIComponent(owner)}`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setRepos(list);
        /* Auto-select first repo if current isn't in the list */
        if (list.length && !list.some((r: Repo) => r.slug === repo)) {
          setRepo(list[0].slug);
        }
      })
      .catch(() => setRepos([]))
      .finally(() => setLoadingRepos(false));
  }, [owner]);

  /* Keep local state in sync with props */
  useEffect(() => {
    setOwner(currentOwner);
    setRepo(currentRepo);
  }, [currentOwner, currentRepo]);

  const handleGo = () => {
    if (owner && repo) {
      onSelect(owner, repo);
    }
  };

  return (
    <div className="repo-selector">
      <div className="selector-field">
        <label className="selector-label">Workspace</label>
        <select
          className="selector-select"
          value={owner}
          onChange={(e) => {
            setOwner(e.target.value);
            setRepo("");
          }}
          disabled={loadingNs}
        >
          <option value="">
            {loadingNs ? "Loading…" : "Select workspace"}
          </option>
          {[...namespaces].sort((a, b) => a.name.localeCompare(b.name)).map((ns) => (
            <option key={ns.slug} value={ns.slug}>
              {ns.name}
              {ns.type ? ` (${ns.type})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="selector-field">
        <label className="selector-label">Repository</label>
        <select
          className="selector-select"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          disabled={!owner || loadingRepos}
        >
          <option value="">
            {loadingRepos
              ? "Loading…"
              : !owner
                ? "Select workspace first"
                : "Select repository"}
          </option>
          {[...repos].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.name}
              {r.package_count ? ` (${r.package_count} pkgs)` : ""}
            </option>
          ))}
        </select>
      </div>

      <button
        className="btn btn-accent btn-block"
        onClick={handleGo}
        disabled={!owner || !repo}
      >
        Load Graph
      </button>
    </div>
  );
}
