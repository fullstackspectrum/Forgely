import { useState } from "react";
import { SEVERITY_RING } from "../programs/nodeWithSeverityRing";
import SeverityMark from "./SeverityMark";

export default function Legend() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`legend${collapsed ? " legend-collapsed" : ""}`}>
      <div className="legend-header">
        <div className="legend-title">Forgely</div>
        <button className="collapse-toggle-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? "Show legend" : "Hide legend"}>
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
                {/* Mirrors the canvas: blue node body, severity as a ring whose
                    thickness scales with the level so it survives greyscale. */}
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
