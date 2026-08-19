/**
 * Severity indicator that does not rely on colour.
 *
 * BRANDING.md §2.4: severity must never be communicated by colour alone. High
 * (#C4451F) and Ember (#EF9F27) are adjacent hues, and roughly 1 in 12 men has
 * some form of red-green colour vision deficiency — a substantial slice of a
 * DevOps audience. The new ramp makes this sharper than the old one did:
 * Critical and High used to be #ff4d4d and #ff8c1a, now they are #E8756B and
 * #F08A5A, which are closer together.
 *
 * So each level gets a distinct shape as well as a colour, and every mark
 * carries an accessible name whether or not a visible label sits beside it.
 */

const SHAPE: Record<string, string> = {
  Critical: "dot",                 // filled circle
  High: "dot-triangle",            // filled triangle
  Medium: "dot-square",            // filled square
  Low: "dot-hollow",               // hollow circle
  None: "dot-square-hollow",       // hollow square
  Unknown: "dot-square-hollow",
};

const TOKEN: Record<string, string> = {
  Critical: "var(--s-critical)",
  High: "var(--s-high)",
  Medium: "var(--s-medium)",
  Low: "var(--s-low)",
  None: "var(--s-none)",
  Unknown: "var(--t-muted)",
};

interface Props {
  severity: string | null | undefined;
  /** Render the severity name next to the mark. */
  showLabel?: boolean;
  className?: string;
}

export default function SeverityMark({ severity, showLabel = false, className = "" }: Props) {
  const sev = severity && severity in SHAPE ? severity : "Unknown";
  const shape = SHAPE[sev];
  const color = TOKEN[sev];

  /* The triangle is drawn with borders, so its colour comes from
     border-bottom-color rather than background. */
  const style =
    shape === "dot-triangle"
      ? { borderBottomColor: color }
      : shape.endsWith("-hollow")
        ? { borderColor: color }
        : { background: color };

  return (
    <>
      <i
        className={`sev-mark ${shape} ${className}`.trim()}
        style={style}
        role="img"
        aria-label={showLabel ? undefined : `Severity: ${sev}`}
        /* Hidden from screen readers when a visible label follows, so the
           severity is not announced twice. */
        aria-hidden={showLabel || undefined}
      />
      {showLabel && <span className="sev-mark-label" style={{ color }}>{sev}</span>}
    </>
  );
}
