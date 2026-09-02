import { useEffect, useRef, useState } from "react";
import type { PackageDetail } from "../types";
import { apiFetch } from "../lib/auth";

/**
 * Full metadata for one package, fetched when it is selected.
 *
 * The graph carries only the handful of fields it draws. Everything the panel
 * shows beyond that — digests, tags, format-specific identifiers, who uploaded
 * it — would multiply the graph payload by the number of packages in order to
 * serve the one the user clicked, so it is fetched here instead. Same
 * arrangement as useCveDescriptions.
 *
 * Returns null until it arrives, and on failure. The panel keeps rendering
 * what the graph already gave it either way: this is additional detail, not a
 * precondition for showing anything.
 */
export function usePackageDetail(owner: string, repo: string, slug: string) {
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    abortRef.current?.abort();

    if (!owner || !repo || !slug) {
      setDetail(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    setLoading(true);
    /* Cleared up front: leaving the previous package's digests on screen while
       the next one loads attributes them to the wrong package. */
    setDetail(null);

    const url = `/api/package/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`;
    apiFetch(url, { signal: controller.signal })
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((d: PackageDetail | null) => { if (active) setDetail(d); })
      .catch(() => { if (active) setDetail(null); })
      .finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
      controller.abort();
    };
  }, [owner, repo, slug]);

  return { detail, loading };
}
