import { useState } from "react";
import type { LayoutType, EdgeStyle } from "../types";

const LAYOUTS: { key: LayoutType; icon: string; label: string }[] = [
  { key: "force",      icon: "⚛", label: "Force" },
  { key: "circular",   icon: "◎", label: "Circular" },
  { key: "radial",     icon: "◉", label: "Radial" },
  { key: "tree",       icon: "⏛", label: "Tree" },
  { key: "horizontal", icon: "⇥", label: "Horizontal" },
];

export default function LayoutPopout({
  layout,
  edgeStyle,
  onLayoutChange,
  onEdgeStyleChange,
}: {
  layout: LayoutType;
  edgeStyle: EdgeStyle;
  onLayoutChange: (l: LayoutType) => void;
  onEdgeStyleChange: (e: EdgeStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = LAYOUTS.find((l) => l.key === layout);

  return (
    <div className="layout-popout">
      <button
        className="layout-popout-trigger"
        onClick={() => setOpen(!open)}
        title="Layout & Edge Style"
      >
        <span className="layout-popout-icon">{current?.icon ?? "⚛"}</span>
        <span className="layout-popout-label">{current?.label ?? "Layout"}</span>
        <span className={`layout-popout-chevron${open ? " open" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="layout-popout-menu">
          <div className="layout-popout-section">
            <span className="layout-popout-section-title">Layout</span>
            {LAYOUTS.map((l) => (
              <button
                key={l.key}
                className={`layout-popout-item${layout === l.key ? " active" : ""}`}
                onClick={() => { onLayoutChange(l.key); setOpen(false); }}
              >
                <span className="layout-popout-item-icon">{l.icon}</span>
                {l.label}
              </button>
            ))}
          </div>
          <div className="layout-popout-divider" />
          <div className="layout-popout-section">
            <span className="layout-popout-section-title">Edges</span>
            <button
              className={`layout-popout-item${edgeStyle === "curved" ? " active" : ""}`}
              onClick={() => { onEdgeStyleChange("curved"); setOpen(false); }}
            >
              <span className="layout-popout-item-icon">∿</span>
              Curved
            </button>
            <button
              className={`layout-popout-item${edgeStyle === "straight" ? " active" : ""}`}
              onClick={() => { onEdgeStyleChange("straight"); setOpen(false); }}
            >
              <span className="layout-popout-item-icon">—</span>
              Straight
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
