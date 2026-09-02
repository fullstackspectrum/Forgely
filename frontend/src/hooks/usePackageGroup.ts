import { useEffect, useRef, useState } from "react";
import type { PackageDetail } from "../types";
import { apiFetch } from "../lib/auth";

/**
 * Every version published under one package name.
 *
 * One request for the whole group rather than one per member: the backend
 * serves these from the package list it already holds, so a fifty-version
 * group costs a single local round trip instead of fifty upstream calls.
 *
 * The name goes in the query string because Docker names contain a slash and
 * would not survive as a path segment.
 */
export function usePackageGroup(owner: string, repo: string, name: string) {
  const [members, setMembers] = useState<PackageDetail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    abortRef.current?.abort();

    if (!owner || !repo || !name) {
      setMembers(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    setLoading(true);
    setMembers(null);

    const url =
      `/api/package-group/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `?name=${encodeURIComponent(name)}`;
    apiFetch(url, { signal: controller.signal })
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((list: PackageDetail[] | null) => { if (active) setMembers(list); })
      /* The graph already knows the versions and their severities, so the list
         still renders without this — it just loses tags and architecture. */
      .catch(() => { if (active) setMembers(null); })
      .finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
      controller.abort();
    };
  }, [owner, repo, name]);

  return { members, loading };
}
