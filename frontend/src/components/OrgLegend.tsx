import { ORG_NODE_COLORS, ORG_NODE_SHAPE } from "../types";

/* The canvas shape vocabulary, as CSS marks. Driven off the same map the
   canvas uses, so the key cannot describe shapes the graph no longer draws. */
const SHAPE_CLASS: Record<string, string> = {
  tilted: "dot-square",
  square: "dot-square",
  circle: "dot",
  triangle: "dot-triangle",
  hexagon: "dot-hexagon",
};

/* State lives in App so it can be persisted and reset, and so both keys
   agree — one open and one closed across tabs reads as a bug. */
interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export default function OrgLegend({ collapsed, onToggle }: Props) {
  return (
    <div className={`legend${collapsed ? " legend-collapsed" : ""}`}>
      <div className="legend-header">
        <div className="legend-title">Workspace</div>
        <button className="collapse-toggle-btn" onClick={onToggle} title={collapsed ? "Show legend" : "Hide legend"}>
          {collapsed ? "▲" : "▼"}
        </button>
      </div>
      {!collapsed && (
        <div className="legend-items">
          {Object.entries(ORG_NODE_COLORS).map(([type, color]) => {
            const cls = SHAPE_CLASS[ORG_NODE_SHAPE[type] ?? "circle"] ?? "dot";
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
