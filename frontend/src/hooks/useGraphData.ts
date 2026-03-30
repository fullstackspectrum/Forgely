import { useCallback, useState } from "react";
import type { GraphResponse } from "../types";
import { apiFetch } from "../lib/auth";

export function useGraphData() {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(
    async (owner: string, repo: string, refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ owner, repo });
        const base = refresh ? "/api/graph/refresh" : "/api/graph";
        const url = `${base}?${params}`;
        const opts: RequestInit = refresh ? { method: "POST" } : {};
        const resp = await apiFetch(url, opts);
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.detail || `HTTP ${resp.status}`);
        }
        const json: GraphResponse = await resp.json();
        setData(json);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch graph data",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { data, loading, error, fetchGraph };
}
