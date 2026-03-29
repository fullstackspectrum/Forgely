import { useEffect, useState } from "react";
import type { GraphResponse } from "../types";

export function useGraphData() {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = refresh ? "/api/graph/refresh" : "/api/graph";
      const opts = refresh ? { method: "POST" } : {};
      const resp = await fetch(url, opts);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${resp.status}`);
      }
      const json: GraphResponse = await resp.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch graph data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
  }, []);

  return { data, loading, error, refresh: () => fetchGraph(true) };
}
