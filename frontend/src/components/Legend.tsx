import { SEVERITY_RING } from "../programs/nodeWithSeverityRing";
import SeverityMark from "./SeverityMark";

/* State lives in App so it can be persisted and reset, and so both keys
   agree — one open and one closed across tabs reads as a bug. */
interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Legend({ collapsed, onToggle }: Props) {
  return (
    <div className={`legend${collapsed ? " legend-collapsed" : ""}`}>
      <div className="legend-header">
        <div className="legend-title">Forgely</div>
        <button className="collapse-toggle-btn" onClick={onToggle} title={collapsed ? "Show legend" : "Hide legend"}>
          {collapsed ? "▲" : "▼"}
        </button>
      </div>
      {!collapsed && (
        <>
          {/* Severity is shape as well as colour (BRANDING.md §2.4), so the
              legend has to teach the shapes, not just the palette. */}
          <div className="legend-items">
            {(["Critical", "High", "Medium", "Low", "None"] as const).map((sev) => (
              <span key={sev}>
                {/* Mirrors the canvas: blue node body, severity as a ring of
                    one width in the level's colour. Width is read from the
                    same constant the canvas uses, so the key cannot drift from
                    what it is describing. */}
                <i
                  className="legend-node-ring"
                  style={{
                    borderWidth: `${SEVERITY_RING[sev] || 0}px`,
                    borderColor: SEVERITY_RING[sev]
                      ? `var(--g-sev-${sev.toLowerCase()})`
                      : "transparent",
                  }}
                />
                {sev === "None" ? "No findings" : sev}
              </span>
            ))}
          </div>
          <div className="legend-items">
            <span>
              <i className="dot" style={{ background: "var(--c-bg)", border: "1px solid var(--c-border-strong)" }} /> Repository
            </span>
            <span>
              <i className="dot" style={{ background: "var(--t-primary)", border: "1px solid var(--t-muted)" }} /> Not scanned
            </span>
            <span>
              <i className="dot-hexagon" style={{ background: "var(--fg-blue-300)" }} /> Dependency
            </span>
            <span>
              <i className="dot" style={{ background: "var(--fg-blue-400)" }} /> Name (n) — click to show versions
            </span>
          </div>
          <div className="legend-edges">
            <span>
              <span className="edge-line shared" /> Shared CVE
            </span>
            <span>
              <span className="edge-line dep" /> Dependency
            </span>
          </div>
        </>
      )}
    </div>
  );
}
