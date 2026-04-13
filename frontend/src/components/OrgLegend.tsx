import { ORG_NODE_COLORS } from "../types";

const SHAPE_CLASS: Record<string, string> = {
  repo: "dot-square",
  upstream: "dot-triangle",
};

export default function OrgLegend() {
  return (
    <div className="legend">
      <div className="legend-title">Workspace</div>
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
    </div>
  );
}
