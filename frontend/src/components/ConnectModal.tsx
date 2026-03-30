import { useState } from "react";
import { saveApiKey, clearApiKey, getApiKey, apiFetch } from "../lib/auth";

interface Props {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}

export default function ConnectModal({ open, onClose, onConnected }: Props) {
  const [key, setKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ name: string; slug: string; email: string } | null>(null);

  const existing = getApiKey();

  async function handleConnect() {
    const trimmed = key.trim();
    if (!trimmed) return;

    setValidating(true);
    setError(null);
    try {
      const resp = await fetch("/api/auth/validate", {
        method: "POST",
        headers: { "X-Api-Key": trimmed },
      });
      const data = await resp.json();
      if (!data.valid) {
        setError(data.error || "Invalid API key");
        return;
      }
      saveApiKey(trimmed);
      setUser({ name: data.name, slug: data.slug, email: data.email });
      setKey("");
      onConnected();
    } catch {
      setError("Failed to validate key. Check your connection.");
    } finally {
      setValidating(false);
    }
  }

  async function handleTest() {
    setError(null);
    try {
      const resp = await apiFetch("/api/auth/validate", { method: "POST" });
      const data = await resp.json();
      if (data.valid) {
        setUser({ name: data.name, slug: data.slug, email: data.email });
      } else {
        setError("Stored key is no longer valid");
      }
    } catch {
      setError("Connection failed");
    }
  }

  function handleDisconnect() {
    clearApiKey();
    setUser(null);
    setKey("");
    onConnected();
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Connect to Cloudsmith</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {existing ? (
          <div className="modal-body">
            <div className="connect-status connected">
              <span className="connect-dot" />
              Connected
            </div>

            {user && (
              <div className="connect-user-card">
                <span className="connect-user-name">{user.name || user.slug}</span>
                {user.email && <span className="connect-user-email">{user.email}</span>}
              </div>
            )}

            <div className="connect-key-preview">
              <span className="connect-key-label">API Key</span>
              <code className="connect-key-masked">
                {"•".repeat(8)}…{existing.slice(-4)}
              </code>
            </div>

            <div className="connect-actions">
              <button className="btn btn-muted" onClick={handleTest}>
                Test Connection
              </button>
              <button className="btn btn-danger" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>

            {error && <div className="connect-error">{error}</div>}

            <div className="connect-divider" />
            <p className="connect-hint">Switch credentials by entering a new key:</p>
            <div className="connect-input-row">
              <input
                type="password"
                className="connect-input"
                placeholder="New Cloudsmith API key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              />
              <button
                className="btn btn-accent"
                onClick={handleConnect}
                disabled={validating || !key.trim()}
              >
                {validating ? "…" : "Switch"}
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="connect-status disconnected">
              <span className="connect-dot" />
              Not connected
            </div>

            <p className="connect-hint">
              Enter your Cloudsmith API key to get started.
              <br />
              <a
                href="https://app.cloudsmith.com/user/settings/api/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Generate a key →
              </a>
            </p>

            <div className="connect-input-row">
              <input
                type="password"
                className="connect-input"
                placeholder="Cloudsmith API key"
                value={key}
                autoFocus
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              />
              <button
                className="btn btn-accent"
                onClick={handleConnect}
                disabled={validating || !key.trim()}
              >
                {validating ? "Validating…" : "Connect"}
              </button>
            </div>

            {error && <div className="connect-error">{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
