import { useCallback, useEffect, useRef, useState } from "react";

interface SearchResult {
  name: string;
  version: string;
  format: string;
  slug: string;
  node_id: string;
}

interface Props {
  owner: string;
  repo: string;
  graphNodeIds: string[];
  onHighlight: (nodeIds: string[]) => void;
  onNodeSelect: (nodeId: string) => void;
  cveIndex: Record<string, string[]>;
}

export default function SearchBar({
  owner,
  repo,
  graphNodeIds,
  onHighlight,
  onNodeSelect,
  cveIndex,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cveMatches, setCveMatches] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        setCveMatches([]);
        setOpen(false);
        setStatusText("");
        onHighlight([]);
        return;
      }

      /* Local CVE search */
      const upper = trimmed.toUpperCase();
      let localCveHits: string[] = [];
      if (upper.startsWith("CVE-") || upper.startsWith("GHSA-")) {
        localCveHits = cveIndex[upper] || [];
        if (!localCveHits.length) {
          for (const [key, ids] of Object.entries(cveIndex)) {
            if (key.includes(upper)) {
              for (const id of ids) {
                if (!localCveHits.includes(id)) localCveHits.push(id);
              }
            }
          }
        }
      }
      setCveMatches(localCveHits);

      /* Cloudsmith API search */
      if (!owner || !repo) return;
      setLoading(true);
      fetch(`/api/search?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&query=${encodeURIComponent(trimmed)}`)
        .then((r) => r.json())
        .then((data: SearchResult[]) => {
          setResults(data);
          setOpen(true);

          /* Combine Cloudsmith results + CVE matches for graph highlighting */
          const nodeIds = new Set<string>(localCveHits);
          for (const r of data) {
            if (graphNodeIds.includes(r.node_id)) {
              nodeIds.add(r.node_id);
            }
          }
          const allIds = Array.from(nodeIds);
          onHighlight(allIds);

          if (allIds.length > 0) {
            setStatusText(`${allIds.length} match${allIds.length > 1 ? "es" : ""}`);
          } else if (data.length > 0) {
            setStatusText(`${data.length} found (not in graph)`);
          } else if (localCveHits.length > 0) {
            setStatusText(`${localCveHits.length} CVE match${localCveHits.length > 1 ? "es" : ""}`);
          } else {
            setStatusText("No matches");
          }
        })
        .catch(() => {
          setResults([]);
          if (localCveHits.length > 0) {
            onHighlight(localCveHits);
            setStatusText(`${localCveHits.length} CVE match${localCveHits.length > 1 ? "es" : ""}`);
          } else {
            setStatusText("Search failed");
          }
        })
        .finally(() => setLoading(false));
    },
    [owner, repo, graphNodeIds, cveIndex, onHighlight],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 350);
  };

  const handleSelect = (nodeId: string) => {
    setOpen(false);
    if (graphNodeIds.includes(nodeId)) {
      onHighlight([nodeId]);
      onNodeSelect(nodeId);
    }
  };

  const clear = () => {
    setQuery("");
    setResults([]);
    setCveMatches([]);
    setOpen(false);
    setStatusText("");
    onHighlight([]);
  };

  return (
    <div className="package-search" ref={containerRef}>
      <div className="package-search-input-row">
        <span className="search-icon">⌕</span>
        <input
          type="text"
          placeholder="Search packages, dependencies, CVEs…"
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
            if (results.length > 0 || cveMatches.length > 0) setOpen(true);
          }}
        />
        {loading && <span className="search-spinner" />}
        {query && (
          <button className="search-clear" onClick={clear} title="Clear">
            ×
          </button>
        )}
        {statusText && <span className="search-status">{statusText}</span>}
      </div>

      {open && (results.length > 0 || cveMatches.length > 0) && (
        <div className="package-search-dropdown">
          {cveMatches.length > 0 && (
            <div className="search-section">
              <div className="search-section-label">CVE Matches</div>
              {cveMatches.map((id) => (
                <button
                  key={`cve-${id}`}
                  className="search-result-item"
                  onClick={() => handleSelect(id)}
                >
                  <span className="result-name">{id}</span>
                  <span className="result-badge result-badge-cve">CVE</span>
                </button>
              ))}
            </div>
          )}
          {results.length > 0 && (
            <div className="search-section">
              <div className="search-section-label">Packages</div>
              {results.map((r, i) => {
                const inGraph = graphNodeIds.includes(r.node_id);
                return (
                  <button
                    key={`pkg-${i}`}
                    className={`search-result-item ${inGraph ? "" : "result-dim"}`}
                    onClick={() => handleSelect(r.node_id)}
                    disabled={!inGraph}
                  >
                    <span className="result-name">{r.name}</span>
                    <span className="result-version">{r.version}</span>
                    <span className="result-badge">{r.format}</span>
                    {!inGraph && <span className="result-note">not in graph</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
