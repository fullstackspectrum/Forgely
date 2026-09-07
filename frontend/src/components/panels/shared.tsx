/**
 * Pieces every detail panel uses.
 *
 * Extracted because four panels were sharing them through a single 1,700-line
 * module: any change to a row renderer meant opening the file that also held
 * every panel body, and the panels could not be read independently of it.
 */
import { useCallback, useState } from "react";
import type { CVERecord, GraphNode, RepoIdentity, Severity } from "../../types";
import { SEVERITY_COLORS } from "../../types";
import SeverityMark from "../SeverityMark";

export function packageMatchesFilter(p: GraphNode, severities: Set<Severity>): boolean {
  if (severities.size === 0) return true;
  return p.data.cves.some((c) => severities.has(c.severity as Severity));
}
/* Module-level so the default prop is the same object on every render; a
   fresh `new Set()` would change identity and re-fire every memo keyed on it. */

export const EMPTY_SEVERITIES: Set<Severity> = new Set();

export function VersionString({ version, mono = false }: { version: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(version).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [version]);
  return (
    <span className="version-string-wrap">
      <span
        className="version-string-text"
        title={version}
        style={mono ? { fontFamily: "var(--fg-font-mono)", color: "var(--fg-blue-200)" } : undefined}
      >
        {version}
      </span>
      <button
        type="button"
        className="version-copy-btn"
        onClick={copy}
        title={copied ? "Copied!" : "Copy version"}
      >
        {copied ? "✓" : "⎘"}
      </button>
    </span>
  );
}

/* An empty set is no filter at all; otherwise a package matches when it
   carries a finding at any of the selected levels. */

export const TAGS_PER_ROW = 3;

/** Hex long enough to be a content digest rather than a version number.
 *
 * Not anchored at the end: Cosign publishes its signatures as
 * `sha256-<64 hex>.sig`, which is a digest wearing a suffix and was slipping
 * through a fully anchored match to become a row's title. */

export function isDigest(value: string): boolean {
  return /^(sha256[:-])?[0-9a-f]{32,}/i.test(value);
}

/** Enough of a digest to compare at a glance; the full value is in the title. */

export function shortDigest(value: string): string {
  const hex = value.replace(/^sha256[:-]/i, "");
  return hex.length > 14 ? `${hex.slice(0, 12)}…` : hex;
}

/* Enough to see the shape of the exposure without scrolling; the rest is a
 * count, because past a handful the answer is "lots of people" and the precise
 * list belongs in the CIEM graph. */

export const ACCESS_ROWS = 8;

export function AccessRow({ identity }: { identity: RepoIdentity }) {
  /* Why they have it, in the fewest words that are still true. */
  const reason =
    identity.via === "org"
      ? `organisation ${identity.org_role || "role"}`
      : identity.via === "team"
        ? `team ${identity.team}`
        : "granted on this repository";

  return (
    <li className="access-row" data-permission={identity.permission}>
      <span className="access-name" title={identity.id}>{identity.name}</span>
      <span className="access-perm">{identity.permission}</span>
      <span className="access-via">
        {identity.kind === "service" ? "service · " : ""}{reason}
      </span>
    </li>
  );
}

/* ================================================================
   Group Detail — one package name, every version it was published under
   ================================================================ */

export function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * One digest, click to copy.
 *
 * A SHA-512 is 128 characters — far too wide for the panel and useless
 * truncated, since the reason to look at a digest is to compare it. It wraps,
 * and the whole row is a copy button so nobody has to select it by hand.
 */

export function Digest({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`pkg-digest${copied ? " copied" : ""}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          /* Clipboard access can be refused; the digest is still on screen to
             be copied by hand, so this is not worth an error state. */
          () => {},
        );
      }}
      title={copied ? "Copied" : `Copy ${label}`}
    >
      <span className="pkg-digest-label">{copied ? "Copied" : label}</span>
      <code className="pkg-digest-value">{value}</code>
    </button>
  );
}

/**
 * Inline "still loading" mark.
 *
 * Sized to sit on a line of text rather than to be noticed: these appear beside
 * labels that already say what is coming, so the spinner only needs to say
 * "not yet", not "look here".
 */

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="inline-spinner" role="status" aria-label={label} />;
}

export function MetaRow({
  label,
  value,
  valueColor,
  onClick,
  active,
}: {
  label: string;
  value: string;
  valueColor?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const text = value || "—";
  return (
    <>
      <span className="meta-label">{label}</span>
      {onClick ? (
        <button
          type="button"
          className={`meta-value meta-value-clickable${active ? " active" : ""}`}
          style={valueColor ? { color: valueColor, fontWeight: 600 } : undefined}
          onClick={onClick}
          title={active ? "Clear filter" : `Filter graph by ${value}`}
        >
          {text}
        </button>
      ) : (
        <span className="meta-value" style={valueColor ? { color: valueColor, fontWeight: 600 } : undefined}>
          {text}
        </span>
      )}
    </>
  );
}

/* `description` is passed in rather than read off `cve`: it arrives from
   /api/cve after the graph has rendered, and falls back to the record's own
   value when the graph still carries one. */

export function CveCard({ cve, description }: { cve: CVERecord; description: string }) {
  const color = SEVERITY_COLORS[cve.severity] || "var(--fg-n-600)";
  return (
    <div className="cve-card" style={{ borderLeftColor: color }}>
      <div className="cve-header">
        <span className="cve-id">{cve.id || "Unknown"}</span>
        <span
          className="cve-severity-badge"
          style={{ color, borderColor: color }}
        >
          {cve.severity}
        </span>
      </div>
      {cve.affected && (
        <div className="cve-affected">
          📦 <strong>Affected:</strong> {cve.affected}
          {cve.affected_version ? ` @ ${cve.affected_version}` : ""}
        </div>
      )}
      {cve.fixed_in && (
        <div className="cve-fixed">
          ✅ <strong>Fixed in:</strong> {cve.fixed_in}
        </div>
      )}
      {description && (
        <div className="cve-description">
          {description.length > 250
            ? description.slice(0, 250) + "…"
            : description}
        </div>
      )}
      <div className="cve-links">
        {cve.nvd_url && (
          <a href={cve.nvd_url} target="_blank" rel="noopener noreferrer">
            🛡 NVD
          </a>
        )}
        {cve.ghsa_url && (
          <a href={cve.ghsa_url} target="_blank" rel="noopener noreferrer">
            📋 GitHub Advisory
          </a>
        )}
        {cve.url && cve.url !== cve.nvd_url && cve.url !== cve.ghsa_url && (
          <a href={cve.url} target="_blank" rel="noopener noreferrer">
            🔗 Advisory
          </a>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Dependency Detail View
   ================================================================ */
