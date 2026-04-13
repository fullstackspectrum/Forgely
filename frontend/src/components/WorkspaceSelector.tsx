import { useEffect, useState } from "react";
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
        <select
          className="selector-select"
          value={currentOwner}
          onChange={(e) => onSelect(e.target.value)}
          disabled={loadingNs}
        >
          <option value="">
            {loadingNs ? "Loading…" : "Select workspace"}
          </option>
          {[...namespaces]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((ns) => (
              <option key={ns.slug} value={ns.slug}>
                {ns.name}
                {ns.type ? ` (${ns.type})` : ""}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}
