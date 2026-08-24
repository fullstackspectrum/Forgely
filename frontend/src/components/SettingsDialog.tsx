import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import ThemeToggle from "./ThemeToggle";
import type { Theme } from "../lib/theme";
import type { EdgeStyle } from "../types";

/**
 * Settings, in one place.
 *
 * These used to be spread along the bottom of the left panel and inside a
 * collapsed "Visibility" section, where nothing marked them out as durable —
 * they read as more filters, which is exactly what they are not. Gathering
 * them behind one button says what they are: choices that stay made.
 */

interface Props {
  open: boolean;
  onClose: () => void;

  theme: Theme;
  onThemeChange: (t: Theme) => void;

  hideSharedCveEdges: boolean;
  hideDependencies: boolean;
  hideUnsupported: boolean;
  hideCriticalAnimation: boolean;
  onHideSharedCveEdgesChange: (v: boolean) => void;
  onHideDependenciesChange: (v: boolean) => void;
  onHideUnsupportedChange: (v: boolean) => void;
  onHideCriticalAnimationChange: (v: boolean) => void;

  edgeStyle: EdgeStyle;
  onEdgeStyleChange: (v: EdgeStyle) => void;

  hasKey: boolean;
  onConnectClick: () => void;
  onDisconnect: () => void;

  onReset: () => void;
}

function Switch({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-row">
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`settings-switch${checked ? " on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="settings-switch-knob" />
      </button>
    </label>
  );
}

export default function SettingsDialog(p: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  /* Escape closes, and focus moves into the dialog so a keyboard user is not
     left tabbing through the graph behind it. */
  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") p.onClose(); };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [p.open, p.onClose]);

  if (!p.open) return null;

  return createPortal(
    <div className="modal-backdrop" onClick={p.onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="modal-content settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="modal-close" onClick={p.onClose} aria-label="Close settings">×</button>
        </div>

        <div className="modal-body settings-body">
          <section className="settings-section">
            <h4 className="settings-section-title">Appearance</h4>
            <div className="settings-row">
              <span className="settings-row-text">
                <span className="settings-row-label">Theme</span>
                <span className="settings-row-hint">Auto follows your system setting</span>
              </span>
              <ThemeToggle theme={p.theme} onChange={p.onThemeChange} />
            </div>
            <div className="settings-row">
              <span className="settings-row-text">
                <span className="settings-row-label">Edges</span>
                <span className="settings-row-hint">Curved separates edges that share endpoints</span>
              </span>
              <div className="theme-toggle" role="radiogroup" aria-label="Edge style">
                {(["curved", "straight"] as EdgeStyle[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={p.edgeStyle === s}
                    className={`theme-toggle-btn${p.edgeStyle === s ? " active" : ""}`}
                    onClick={() => p.onEdgeStyleChange(s)}
                  >
                    {s === "curved" ? "Curved" : "Straight"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h4 className="settings-section-title">Show on the graph</h4>
            {/* Stored as hide* but shown as show*: a switch that is on when
                something is hidden inverts what "on" means. */}
            <Switch
              label="Shared CVE edges"
              hint="Links packages affected by the same vulnerability"
              checked={!p.hideSharedCveEdges}
              onChange={(v) => p.onHideSharedCveEdgesChange(!v)}
            />
            <Switch
              label="Dependencies"
              hint="Transitive packages pulled in indirectly"
              checked={!p.hideDependencies}
              onChange={(v) => p.onHideDependenciesChange(!v)}
            />
            <Switch
              label="Unsupported scans"
              hint="Packages in formats the scanner cannot read"
              checked={!p.hideUnsupported}
              onChange={(v) => p.onHideUnsupportedChange(!v)}
            />
            <Switch
              label="Critical animation"
              hint="Pulsing rings around Critical packages"
              checked={!p.hideCriticalAnimation}
              onChange={(v) => p.onHideCriticalAnimationChange(!v)}
            />
          </section>

          <section className="settings-section">
            <h4 className="settings-section-title">Connection</h4>
            <div className="settings-row">
              <span className="settings-row-text">
                <span className="settings-row-label">Cloudsmith</span>
                <span className="settings-row-hint">
                  {p.hasKey ? "An API key is stored in this browser" : "No API key stored"}
                </span>
              </span>
              <div className="settings-connection">
                <button
                  className={`connect-btn ${p.hasKey ? "connected" : ""}`}
                  onClick={p.onConnectClick}
                >
                  <span className="connect-btn-dot" />
                  {p.hasKey ? "Connected" : "Connect"}
                </button>
                {p.hasKey && (
                  <button className="disconnect-btn" title="Disconnect" onClick={p.onDisconnect}>×</button>
                )}
              </div>
            </div>
          </section>

          <div className="settings-footer">
            {/* Severity and status filters are not listed above and are not
                reset here: they are a question about the open repo, not a
                preference, and they clear on their own. */}
            <span className="settings-footer-note">Settings are saved in this browser.</span>
            <button className="btn btn-muted" onClick={p.onReset}>Reset to defaults</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
