import { useCallback, useEffect, useRef, useState } from "react";
import type { OrgGraphResponse, OrgGraphNode } from "../types";
import { ORG_NODE_COLORS } from "../types";

interface Props {
  orgData: OrgGraphResponse | null;
  onHighlight: (nodeIds: string[]) => void;
  onNodeSelect: (nodeId: string) => void;
}

type QueryPrefix = "repo" | "user" | "service" | "team" | "entitlement" | "upstream";

const PREFIXES: QueryPrefix[] = ["repo", "user", "service", "team", "entitlement", "upstream"];

function parseQuery(raw: string): { prefix: QueryPrefix | null; term: string } {
  const trimmed = raw.trim();
  for (const p of PREFIXES) {
    if (trimmed.toLowerCase().startsWith(`${p}:`)) {
      return { prefix: p, term: trimmed.slice(p.length + 1).trim() };
    }
  }
  return { prefix: null, term: trimmed };
}

function matchNode(node: OrgGraphNode, prefix: QueryPrefix | null, term: string): boolean {
  if (!term) return false;
  const lower = term.toLowerCase();

  if (prefix) {
    if (node.type !== prefix) return false;
    return node.label.toLowerCase().includes(lower) || node.id.toLowerCase().includes(lower);
  }

  // Plain text search — match label or id across all non-org nodes
  if (node.type === "org") return false;
  return node.label.toLowerCase().includes(lower) || node.id.toLowerCase().includes(lower);
}

export default function OrgSearchBar({ orgData, onHighlight, onNodeSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrgGraphNode[]>([]);
  const [open, setOpen] = useState(false);
  const [statusText, setStatusText] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* Close dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const doSearch = useCallback(
    (q: string) => {
      const { prefix, term } = parseQuery(q);
      if (!term || !orgData) {
        setResults([]);
        setOpen(false);
        setStatusText("");
        onHighlight([]);
        return;
      }

      const matches = orgData.nodes.filter((n) => matchNode(n, prefix, term));
      setResults(matches);
      setOpen(matches.length > 0);

      const ids = matches.map((n) => n.id);
      onHighlight(ids);

      if (matches.length > 0) {
        setStatusText(`${matches.length} match${matches.length > 1 ? "es" : ""}`);
      } else {
        setStatusText("No matches");
      }
    },
    [orgData, onHighlight],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 200);
  };

  const handleSelect = (nodeId: string) => {
    setOpen(false);
    onHighlight([nodeId]);
    onNodeSelect(nodeId);
  };

  const clear = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
    setStatusText("");
    onHighlight([]);
  };

  return (
    <div className="package-search org-search" ref={containerRef}>
      <div className="package-search-input-row">
        <span className="search-icon">⌕</span>
        <input
          type="text"
          placeholder="Search nodes… repo:name, user:name, team:…"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              doSearch(query);
            }
            if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
        />
        {query && (
          <button className="search-clear" onClick={clear} title="Clear">
            ×
          </button>
        )}
        {statusText && <span className="search-status">{statusText}</span>}
      </div>

      {open && results.length > 0 && (
        <div className="package-search-dropdown">
          {/* Group results by type */}
          {PREFIXES.filter((p) => results.some((r) => r.type === p)).map((type) => (
            <div className="search-section" key={type}>
              <div className="search-section-label">{type.charAt(0).toUpperCase() + type.slice(1)}s</div>
              {results
                .filter((r) => r.type === type)
                .slice(0, 20)
                .map((r) => (
                  <button
                    key={r.id}
                    className="search-result-item"
                    onClick={() => handleSelect(r.id)}
                  >
                    <span className="result-name">{r.label}</span>
                    <span
                      className="result-badge"
                      style={{ background: ORG_NODE_COLORS[r.type] + "22", color: ORG_NODE_COLORS[r.type] }}
                    >
                      {r.type}
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
