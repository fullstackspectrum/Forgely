import type { GraphResponse, CVERecord } from "../types";
import { SEVERITY_COLORS } from "../types";

interface Props {
  data: GraphResponse;
  nodeId: string;
}

export default function SidePanel({ data, nodeId }: Props) {
  const node = data.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = node.data;
  const sev = d.max_severity || "None";
  const sevColor = SEVERITY_COLORS[sev] || SEVERITY_COLORS.None;

  const sizeStr =
    d.size > 1048576
      ? `${(d.size / 1048576).toFixed(1)} MB`
      : d.size > 1024
        ? `${(d.size / 1024).toFixed(1)} KB`
        : d.size
          ? `${d.size} B`
          : "—";

  const uploadDate = d.uploaded_at && d.uploaded_at !== "N/A"
    ? new Date(d.uploaded_at).toLocaleDateString()
    : "—";

  /* Build CVE→packages reverse index for "also affects" */
  const cveIndex: Record<string, string[]> = {};
  for (const n of data.nodes) {
    for (const c of n.data.cves) {
      if (!c.id) continue;
      if (!cveIndex[c.id]) cveIndex[c.id] = [];
      if (!cveIndex[c.id].includes(n.id)) cveIndex[c.id].push(n.id);
    }
  }

  return (
    <div className="side-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{node.label}</h2>
          <span className="panel-version">{d.version}</span>
        </div>
        <span className="severity-badge" style={{ background: sevColor }}>
          {sev}
        </span>
      </div>

      {/* Metadata grid */}
      <div className="panel-meta">
        <MetaRow label="Format" value={d.format} />
        <MetaRow label="License" value={d.license} />
        <MetaRow label="Size" value={sizeStr} />
        <MetaRow label="Downloads" value={String(d.downloads ?? "—")} />
        <MetaRow label="Scan Status" value={d.scan_status} />
        <MetaRow label="Uploaded" value={uploadDate} />
        <MetaRow
          label="Vulnerabilities"
          value={String(d.vuln_count)}
          valueColor={d.vuln_count > 0 ? sevColor : undefined}
        />
      </div>

      {/* CVE list */}
      {d.cves.length > 0 && (
        <div className="panel-section">
          <h3 className="section-title">
            CVEs ({d.cves.length}
            {d.vuln_count > d.cves.length ? ` of ${d.vuln_count}` : ""})
          </h3>
          <div className="cve-list">
            {d.cves.map((cve, i) => (
              <CveCard
                key={`${cve.id}-${i}`}
                cve={cve}
                otherPackages={(cveIndex[cve.id] || []).filter(
                  (id) => id !== nodeId,
                )}
              />
            ))}
          </div>
        </div>
      )}

      {d.vuln_count > 0 && d.cves.length === 0 && (
        <div className="panel-section">
          <p style={{ color: "#e8a845" }}>
            ⚠ {d.vuln_count} vulnerabilities detected but details could not be
            retrieved.
          </p>
        </div>
      )}

      {d.vuln_count === 0 && node.type === "package" && (
        <div className="panel-section">
          <p style={{ color: "#666" }}>No CVEs recorded for this package.</p>
        </div>
      )}
    </div>
  );
}

function MetaRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <>
      <span className="meta-label">{label}</span>
      <span className="meta-value" style={valueColor ? { color: valueColor, fontWeight: 600 } : undefined}>
        {value || "—"}
      </span>
    </>
  );
}

function CveCard({
  cve,
  otherPackages,
}: {
  cve: CVERecord;
  otherPackages: string[];
}) {
  const color = SEVERITY_COLORS[cve.severity] || "#666";
  return (
    <div className="cve-card" style={{ borderLeftColor: color }}>
      <div className="cve-header">
        <span className="cve-id">{cve.id || "Unknown"}</span>
        <span
          className="cve-severity-badge"
          style={{ color, borderColor: color }}
        >
          {cve.severity}
        </span>
      </div>
      {cve.affected && (
        <div className="cve-affected">
          📦 <strong>Affected:</strong> {cve.affected}
          {cve.affected_version ? ` @ ${cve.affected_version}` : ""}
        </div>
      )}
      {cve.fixed_in && (
        <div className="cve-fixed">
          ✅ <strong>Fixed in:</strong> {cve.fixed_in}
        </div>
      )}
      {cve.description && (
        <div className="cve-description">
          {cve.description.length > 250
            ? cve.description.slice(0, 250) + "…"
            : cve.description}
        </div>
      )}
      <div className="cve-links">
        {cve.nvd_url && (
          <a href={cve.nvd_url} target="_blank" rel="noopener noreferrer">
            🛡 NVD
          </a>
        )}
        {cve.ghsa_url && (
          <a href={cve.ghsa_url} target="_blank" rel="noopener noreferrer">
            📋 GitHub Advisory
          </a>
        )}
        {cve.url && cve.url !== cve.nvd_url && cve.url !== cve.ghsa_url && (
          <a href={cve.url} target="_blank" rel="noopener noreferrer">
            🔗 Advisory
          </a>
        )}
      </div>
      {otherPackages.length > 0 && (
        <div className="cve-shared">
          ⚠ Also affects: {otherPackages.join(", ")}
        </div>
      )}
    </div>
  );
}
