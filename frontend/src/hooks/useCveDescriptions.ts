import { useEffect, useRef, useState } from "react";
import type { CVERecord } from "../types";
import { apiFetch } from "../lib/auth";

/**
 * CVE descriptions for one package, fetched on selection.
 *
 * They are the bulk of the graph payload — 21.5 MB of the container repository' 29.2
 * MB — and invisible until a node is expanded, so the graph ships without them
 * and they are fetched here instead. The backend serves them from its warm
 * graph cache, so this is usually a local round trip with no upstream call.
 *
 * Returns a map of CVE id to description. Missing entries are expected, not
 * exceptional: callers fall back to whatever the record already carries, which
 * keeps this working against a backend that still inlines descriptions.
 */
export function useCveDescriptions(owner: string, repo: string, slug: string) {
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    abortRef.current?.abort();

    if (!owner || !repo || !slug) {
      setDescriptions({});
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    setLoading(true);

    const url = `/api/cve/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`;
    apiFetch(url, { signal: controller.signal })
      .then((resp) => (resp.ok ? resp.json() : []))
      .then((records: CVERecord[]) => {
        if (!active) return;
        const map: Record<string, string> = {};
        for (const record of records) {
          if (record.id && record.description) map[record.id] = record.description;
        }
        setDescriptions(map);
      })
      /* Descriptions are supplementary. A failure here should leave the panel
         showing everything else, not replace it with an error. */
      .catch(() => { if (active) setDescriptions({}); })
      .finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
      controller.abort();
    };
  }, [owner, repo, slug]);

  return { descriptions, loading };
}
