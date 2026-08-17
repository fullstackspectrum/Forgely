import { useState } from "react";

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
          <div className="legend-items">
            <span>
              <i className="dot" style={{ background: "var(--c-bg)" }} /> Repository
            </span>
            <span>
              <i className="dot" style={{ background: "var(--s-none)" }} /> Package (Safe)
            </span>
            <span>
              <i className="dot" style={{ background: "var(--t-primary)", border: "1px solid var(--t-muted)" }} /> Package (Not Scanned)
            </span>
            <span>
              <i className="dot-hexagon" style={{ background: "var(--fg-blue-300)" }} /> Dependency
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
