import { useEffect, useRef, useState } from "react";
import { apiFetch, getApiKey, saveApiKey } from "../lib/auth";
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
  hideMalwareAnimation: boolean;
  onHideSharedCveEdgesChange: (v: boolean) => void;
  onHideDependenciesChange: (v: boolean) => void;
  onHideUnsupportedChange: (v: boolean) => void;
  onHideCriticalAnimationChange: (v: boolean) => void;
  onHideMalwareAnimationChange: (v: boolean) => void;

  edgeStyle: EdgeStyle;
  onEdgeStyleChange: (v: EdgeStyle) => void;

  hasKey: boolean;
  /* Fired after a successful connect, switch or disconnect, so the app can
     re-read the stored key and refresh anything keyed on it. */
  onConnectionChanged: () => void;
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
  const [tab, setTab] = useState<"general" | "connection">("general");
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

        {/* Tabs, so a tall Connection panel and a tall General list do not
            have to share one scroll. */}
        <div className="settings-tabs" role="tablist">
          {(["general", "connection"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`settings-tab${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "general" ? "General" : "Connection"}
              {t === "connection" && (
                /* The state is worth seeing without opening the tab. */
                <span className={`settings-btn-dot${p.hasKey ? " connected" : ""}`} />
              )}
            </button>
          ))}
        </div>
        <div className="modal-body settings-body">
          {tab === "general" && (<>
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
            <Switch
              label="Malware animation"
              hint="Pulsing rings around packages flagged as malware"
              checked={!p.hideMalwareAnimation}
              onChange={(v) => p.onHideMalwareAnimationChange(!v)}
            />
          </section>
          </>)}

          {tab === "connection" && (
          <section className="settings-section">
            <h4 className="settings-section-title">Connection</h4>
            <ConnectionPanel
              hasKey={p.hasKey}
              onChanged={p.onConnectionChanged}
              onDisconnect={p.onDisconnect}
            />
          </section>
          )}

          {/* Reset belongs to the preferences, not the credentials — showing it
              on the Connection tab would suggest it signs you out. */}
          {tab === "general" && (
          <div className="settings-footer">
            {/* Severity and status filters are not listed above and are not
                reset here: they are a question about the open repo, not a
                preference, and they clear on their own. */}
            <span className="settings-footer-note">Settings are saved in this browser.</span>
            <button className="btn btn-muted" onClick={p.onReset}>Reset to defaults</button>
          </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Connect, switch or disconnect, and who the stored key belongs to.
 *
 * This used to be a separate modal reached from a button inside this dialog —
 * a dialog opening a dialog to answer a question the first one was already
 * asking. It also meant the authorised user was only ever visible in the modal,
 * so the settings row could say "Connected" without saying connected as whom.
 */
function ConnectionPanel({
  hasKey,
  onChanged,
  onDisconnect,
}: {
  hasKey: boolean;
  onChanged: () => void;
  onDisconnect: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ name: string; slug: string; email: string } | null>(null);
  /* Read on every render rather than held in state: disconnecting clears it
     from storage, and a copy here would keep showing the old suffix. */
  const stored = getApiKey();

  /* Who the stored key belongs to, resolved when the dialog opens. Failure is
     silent — the panel still shows the key and its controls, and a broken key
     announces itself the moment anything else is fetched. */
  useEffect(() => {
    if (!hasKey) { setUser(null); return; }
    let active = true;
    apiFetch("/api/auth/validate", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.valid) setUser({ name: d.name, slug: d.slug, email: d.email });
        else { setUser(null); setError("The saved key no longer works — enter a new one"); }
      })
      .catch(() => { if (active) setUser(null); });
    return () => { active = false; };
  }, [hasKey]);

  async function connect() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch("/api/auth/validate", {
        method: "POST",
        headers: { "X-Api-Key": trimmed },
      });
      const data = await resp.json();
      if (!data.valid) {
        setError(data.error || "Cloudsmith rejected that key — check it has read access to the workspace");
        return;
      }
      saveApiKey(trimmed);
      setUser({ name: data.name, slug: data.slug, email: data.email });
      setKey("");
      onChanged();
    } catch {
      setError("Couldn't reach Cloudsmith — check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    setUser(null);
    setKey("");
    setError(null);
    onDisconnect();
  }

  return (
    <div className="settings-connection-panel">
      <div className="settings-conn-status">
        <span className={`settings-btn-dot${hasKey ? " connected" : ""}`} />
        <span className="settings-conn-state">{hasKey ? "Connected" : "Not connected"}</span>
        {hasKey && (
          <button className="settings-conn-disconnect" onClick={disconnect}>Disconnect</button>
        )}
      </div>

      {hasKey && (
        <div className="settings-conn-identity">
          <span className="settings-conn-user">
            {user ? (user.name || user.slug) : "Checking…"}
          </span>
          {user?.email && <span className="settings-conn-email">{user.email}</span>}
          {stored && (
            <code className="settings-conn-key" title="Only the last four characters are shown">
              {"•".repeat(8)}{stored.slice(-4)}
            </code>
          )}
        </div>
      )}

      <div className="settings-conn-entry">
        <input
          type="password"
          className="connect-input"
          placeholder={hasKey ? "Replace with a new API key" : "Cloudsmith API key"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && connect()}
        />
        <button className="btn btn-accent" onClick={connect} disabled={busy || !key.trim()}>
          {busy ? "…" : hasKey ? "Switch" : "Connect"}
        </button>
      </div>

      {error && <div className="connect-error">{error}</div>}

      {!hasKey && (
        <a
          className="settings-conn-help"
          href="https://app.cloudsmith.com/user/settings/api/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Generate a key →
        </a>
      )}
    </div>
  );
}
