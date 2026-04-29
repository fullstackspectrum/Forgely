import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/auth";

interface Namespace {
  slug: string;
  name: string;
  type: string;
}

interface Repo {
  slug: string;
  name: string;
  description: string;
  package_count: number;
}

interface Props {
  currentOwner: string;
  currentRepo: string;
  refreshKey: number;
  onSelect: (owner: string, repo: string) => void;
}

/* ── Custom dropdown ─────────────────────────────────────────── */
interface DropdownOption {
  value: string;
  label: string;
  sub?: string;
}

function CustomDropdown({
  options,
  value,
  placeholder,
  disabled,
  onChange,
  searchable,
}: {
  options: DropdownOption[];
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    if (!open) setQuery("");
  }, [open, searchable]);

  const selected = options.find((o) => o.value === value);
  const filtered = searchable && query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className={`custom-dropdown${disabled ? " disabled" : ""}`} ref={ref}>
      <button
        className="custom-dropdown-trigger"
        onClick={() => !disabled && setOpen(!open)}
        type="button"
      >
        <span className={`custom-dropdown-value${!selected ? " placeholder" : ""}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className="custom-dropdown-chevron" width="10" height="6" viewBox="0 0 10 6">
          <path d="M0 0l5 6 5-6z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="custom-dropdown-menu">
          {searchable && (
            <input
              ref={inputRef}
              className="custom-dropdown-search"
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
              }}
            />
          )}
          {filtered.length === 0 ? (
            <div className="custom-dropdown-empty">{query ? "No matches" : "No options available"}</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.value}
                className={`custom-dropdown-item${opt.value === value ? " active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  setQuery("");
                }}
                type="button"
              >
                <span className="custom-dropdown-item-label">{opt.label}</span>
                {opt.sub && <span className="custom-dropdown-item-sub">{opt.sub}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function RepoSelector({
  currentOwner,
  currentRepo,
  refreshKey,
  onSelect,
}: Props) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [owner, setOwner] = useState(currentOwner);
  const [repo, setRepo] = useState(currentRepo);
  const [loadingNs, setLoadingNs] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);

  /* Fetch namespaces on mount or when refreshKey changes */
  useEffect(() => {
    setLoadingNs(true);
    apiFetch("/api/namespaces")
      .then((r) => r.json())
      .then((data) => setNamespaces(Array.isArray(data) ? data : []))
      .catch(() => setNamespaces([]))
      .finally(() => setLoadingNs(false));
  }, [refreshKey]);

  /* Fetch repos when owner changes */
  useEffect(() => {
    if (!owner) {
      setRepos([]);
      return;
    }
    setLoadingRepos(true);
    apiFetch(`/api/repos/${encodeURIComponent(owner)}`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setRepos(list);
        /* Auto-select first repo alphabetically if current isn't in the list */
        if (list.length && !list.some((r: Repo) => r.slug === repo)) {
          const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
          setRepo(sorted[0].slug);
        }
      })
      .catch(() => setRepos([]))
      .finally(() => setLoadingRepos(false));
  }, [owner]);

  /* Keep local state in sync with props */
  useEffect(() => {
    setOwner(currentOwner);
    setRepo(currentRepo);
  }, [currentOwner, currentRepo]);

  const handleGo = () => {
    if (owner && repo) {
      onSelect(owner, repo);
    }
  };

  return (
    <div className="repo-selector">
      <div className="selector-field">
        <label className="selector-label">Workspace</label>
        <CustomDropdown
          options={[...namespaces]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((ns) => ({
              value: ns.slug,
              label: ns.name,
              sub: ns.type || undefined,
            }))}
          value={owner}
          placeholder={loadingNs ? "Loading…" : "Select workspace"}
          disabled={loadingNs}
          onChange={(v) => {
            setOwner(v);
            setRepo("");
          }}
        />
      </div>

      <div className="selector-field">
        <label className="selector-label">Repository</label>
        <CustomDropdown
          options={[...repos]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((r) => ({
              value: r.slug,
              label: r.name,
              sub: r.package_count ? `${r.package_count} pkgs` : undefined,
            }))}
          value={repo}
          placeholder={
            loadingRepos
              ? "Loading…"
              : !owner
                ? "Select workspace first"
                : "Select repository"
          }
          disabled={!owner || loadingRepos}
          onChange={(v) => setRepo(v)}
          searchable
        />
      </div>

      <button
        className="btn btn-accent btn-block"
        onClick={handleGo}
        disabled={!owner || !repo}
      >
        Load Graph
      </button>
    </div>
  );
}
