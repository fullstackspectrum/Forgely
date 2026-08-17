import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphResponse } from "../types";
import { apiFetch } from "../lib/auth";

/** Progress reported by the backend during a build. */
export interface GraphProgress {
  /** Backend phase name: "packages" | "scanning" | "dependencies" | "cached" */
  phase: string;
  done: number;
  total: number;
}

/** One NDJSON line from /api/graph/stream. */
type Frame =
  | { type: "progress"; phase: string; done: number; total: number }
  | { type: "graph"; data: GraphResponse }
  | { type: "error"; detail: string; status?: number };

export function useGraphData() {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<GraphProgress | null>(null);

  /* Cancels the in-flight build when a new one starts or the app unmounts.
     Without this, switching repos mid-build leaves the old stream running and
     its terminal frame lands after the new one — showing the wrong graph. */
  const abortRef = useRef<AbortController | null>(null);
  /* Aborting is not synchronous: frames already parsed in the loop below can
     still be dispatched after abort(). The sequence number makes stale frames
     inert rather than merely unlikely. */
  const seqRef = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const fetchGraph = useCallback(
    async (owner: string, repo: string, refresh = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++seqRef.current;
      const current = () => seq === seqRef.current;

      setLoading(true);
      setError(null);
      setProgress(null);

      try {
        const params = new URLSearchParams({ owner, repo });
        if (refresh) params.set("refresh", "true");
        const resp = await apiFetch(`/api/graph/stream?${params}`, {
          signal: controller.signal,
        });

        /* Failures raised before the first byte still arrive as real HTTP
           statuses — auth, missing params. Once the stream has opened the
           backend can only report through an error frame. */
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(
            resp.status === 401
              ? `401: ${body.detail || "Authentication required"}`
              : body.detail || `HTTP ${resp.status}`,
          );
        }

        let streamError: string | null = null;

        const handle = (frame: Frame) => {
          if (!current()) return;
          if (frame.type === "progress") {
            setProgress({
              phase: frame.phase,
              done: frame.done,
              total: frame.total,
            });
          } else if (frame.type === "graph") {
            setData(frame.data);
          } else if (frame.type === "error") {
            streamError =
              frame.status === 401
                ? `401: ${frame.detail || "Authentication required"}`
                : frame.detail || "Failed to fetch graph data";
          }
        };

        if (!resp.body) {
          /* No streaming body (non-browser fetch, some test environments).
             The payload is complete and correct — only progressive. */
          for (const line of (await resp.text()).split("\n")) {
            if (line.trim()) handle(JSON.parse(line));
          }
        } else {
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            /* stream:true so a multi-byte character split across a chunk
               boundary is held, not replaced with U+FFFD. */
            buf += decoder.decode(value, { stream: true });

            /* The graph frame is megabytes; it will always span chunks.
               Only dispatch on a complete line. */
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (line) handle(JSON.parse(line));
            }
          }

          buf += decoder.decode();
          if (buf.trim()) handle(JSON.parse(buf));
        }

        if (streamError) throw new Error(streamError);
      } catch (err) {
        /* An abort is this hook cancelling itself — not a failure to report. */
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!current()) return;
        setError(
          err instanceof Error ? err.message : "Failed to fetch graph data",
        );
      } finally {
        if (current()) {
          setLoading(false);
          setProgress(null);
        }
      }
    },
    [],
  );

  return { data, loading, error, progress, fetchGraph };
}
