import { useState } from "react";

interface Props {
  onSearch: (results: string[]) => void;
  cveIndex: Record<string, string[]>;
}

export default function SearchBar({ onSearch, cveIndex }: Props) {
  const [query, setQuery] = useState("");
  const [resultText, setResultText] = useState("");

  const doSearch = () => {
    const q = query.trim().toUpperCase();
    if (!q) {
      onSearch([]);
      setResultText("");
      return;
    }

    /* Exact match first, then substring */
    let matches = cveIndex[q] || [];
    if (!matches.length) {
      const partial: string[] = [];
      for (const [key, ids] of Object.entries(cveIndex)) {
        if (key.includes(q)) {
          for (const id of ids) {
            if (!partial.includes(id)) partial.push(id);
          }
        }
      }
      matches = partial;
    }

    if (matches.length) {
      setResultText(
        `${matches.length} package${matches.length > 1 ? "s" : ""} affected`,
      );
    } else {
      setResultText("No matches");
    }
    onSearch(matches);
  };

  const clear = () => {
    setQuery("");
    setResultText("");
    onSearch([]);
  };

  return (
    <div className="toolbar-group search-bar">
      <label htmlFor="cve-input">🔍</label>
      <input
        id="cve-input"
        type="text"
        placeholder="Search CVE…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && doSearch()}
      />
      <button className="btn btn-accent" onClick={doSearch}>
        Search
      </button>
      <button className="btn btn-muted" onClick={clear}>
        Clear
      </button>
      {resultText && (
        <span className="search-result-text">{resultText}</span>
      )}
    </div>
  );
}
