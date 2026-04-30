import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/auth";

interface Namespace {
  slug: string;
  name: string;
  type: string;
}

interface Props {
  currentOwner: string;
  refreshKey: number;
  onSelect: (owner: string) => void;
}

/* ── Custom dropdown (same as RepoSelector) ──────────────────── */
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
}: {
  options: DropdownOption[];
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = options.find((o) => o.value === value);

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
          {options.length === 0 ? (
            <div className="custom-dropdown-empty">No options available</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                className={`custom-dropdown-item${opt.value === value ? " active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
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

export default function WorkspaceSelector({
  currentOwner,
  refreshKey,
  onSelect,
}: Props) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loadingNs, setLoadingNs] = useState(false);

  useEffect(() => {
    setLoadingNs(true);
    apiFetch("/api/namespaces")
      .then((r) => r.json())
      .then((data) => setNamespaces(Array.isArray(data) ? data : []))
      .catch(() => setNamespaces([]))
      .finally(() => setLoadingNs(false));
  }, [refreshKey]);

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
          value={currentOwner}
          placeholder={loadingNs ? "Loading…" : "Select workspace"}
          disabled={loadingNs}
          onChange={(v) => onSelect(v)}
        />
      </div>
    </div>
  );
}
