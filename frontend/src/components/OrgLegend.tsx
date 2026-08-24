import { useState } from "react";
import { ORG_NODE_COLORS } from "../types";

const SHAPE_CLASS: Record<string, string> = {
  repo: "dot-square",
  upstream: "dot-triangle",
};

export default function OrgLegend() {
  /* Collapsed by default: the key teaches the vocabulary once, and after
     that it is a box sitting over the graph. The header stays visible so
     it can be opened again. */
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={`legend${collapsed ? " legend-collapsed" : ""}`}>
      <div className="legend-header">
        <div className="legend-title">Workspace</div>
        <button className="collapse-toggle-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? "Show legend" : "Hide legend"}>
          {collapsed ? "▲" : "▼"}
        </button>
      </div>
      {!collapsed && (
        <div className="legend-items">
          {Object.entries(ORG_NODE_COLORS).map(([type, color]) => {
            const cls = SHAPE_CLASS[type] ?? "dot";
            const style = cls === "dot-triangle"
              ? { borderBottomColor: color }
              : { background: color };
            return (
              <span key={type}>
                <i className={cls} style={style} /> {type.charAt(0).toUpperCase() + type.slice(1)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
