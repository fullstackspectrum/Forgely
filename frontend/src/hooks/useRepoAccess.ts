import { useEffect, useRef, useState } from "react";
import type { RepoAccess } from "../types";
import { apiFetch } from "../lib/auth";

/**
 * Who can reach the repository a package lives in.
 *
 * The join between the two halves of the app: the SCA graph knows a package is
 * vulnerable, the CIEM graph knows who can reach its repository, and answering
 * "so who can touch this artefact" used to mean switching tabs and rebuilding a
 * different graph.
 *
 * Keyed on the repository rather than the package, so clicking between packages
 * in the same repo is one fetch, not one per package.
 */
export function useRepoAccess(owner: string, repo: string) {
  const [access, setAccess] = useState<RepoAccess | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    abortRef.current?.abort();

    if (!owner || !repo) {
      setAccess(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    setLoading(true);

    const url = `/api/repo-access/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    apiFetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RepoAccess | null) => { if (active) setAccess(d); })
      /* Supplementary. A package panel that cannot answer "who can reach this"
         should still show the vulnerability it was opened for. */
      .catch(() => { if (active) setAccess(null); })
      .finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
      controller.abort();
    };
  }, [owner, repo]);

  return { access, loading };
}
