/**
 * Node hover card: a flat surface with a 1px border, a severity accent bar,
 * and an inline severity badge. Drawn on canvas rather than in the DOM
 * because it tracks a WebGL node position.
 * Also exports a custom label drawer that renders a lock badge for quarantined nodes.
 */
import type { Settings } from "sigma/settings";
import { token } from "./palette";

/* Resolved on call, not at module scope. token() reads computed styles, and
   this module is imported before the stylesheet is guaranteed to be applied —
   a map built at import time would cache the fallback colour forever. */
const SEV_TOKEN: Record<string, string> = {
  Critical: "--s-critical",
  High: "--s-high",
  Medium: "--s-medium",
  Low: "--s-low",
};

const severityColor = (sev: string): string | undefined =>
  sev in SEV_TOKEN ? token(SEV_TOKEN[sev]) : undefined;

const SEVERITY_BADGE_BG: Record<string, string> = {
  Critical: "rgba(232, 117, 107,0.22)",
  High:     "rgba(240, 138, 90,0.22)",
  Medium:   "rgba(217, 182, 92,0.18)",
  Low:      "rgba(139, 156, 175,0.18)",
};

export function drawDarkNodeHover(
  context: CanvasRenderingContext2D,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  settings: Settings,
): void {
  const fontSize  = settings.labelSize  ?? 13;
  const font      = settings.labelFont  ?? token("--fg-font-body");
  const weight    = settings.labelWeight ?? "600";
  const label          = (data.label as string | null | undefined) ?? "";
  const severity       = data.severity      as string | undefined;
  const nodeType       = data.nodeType      as string | undefined;
  const isQuarantined  = !!data.is_quarantined;
  /* Lowercased on the node, and left that way: package formats are written
     lowercase everywhere they appear — npm, docker, maven — and title-casing
     them here would disagree with the panel and the filter chips. */
  const format         = (data.format as string | undefined) || "";

  // Skip empty hover for repo nodes
  if (!label) return;

  context.font = `${weight} ${fontSize}px ${font}`;

  const ACCENT_W  = 3;
  const PAD_X     = 12;
  const PAD_Y     = 8;
  const INNER_GAP = 5;
  const radius    = 10;   // --fg-radius-lg: popovers and panels

  const showSeverity = nodeType === "package" && !!severity && !(severity === "Unknown" || severity === "None");

  const labelW = context.measureText(label).width;
  let contentW = labelW;

  if (showSeverity && severity) {
    context.font = `500 ${fontSize - 2}px ${font}`;
    contentW = Math.max(contentW, context.measureText(severity).width + 16);
    context.font = `${weight} ${fontSize}px ${font}`;
  }
  if (isQuarantined) {
    context.font = `500 ${fontSize - 2}px ${font}`;
    contentW = Math.max(contentW, context.measureText("Quarantined").width + 22);
    context.font = `${weight} ${fontSize}px ${font}`;
  }
  if (format) {
    context.font = `500 ${fontSize - 2}px ${font}`;
    contentW = Math.max(contentW, context.measureText(format).width + 14);
    context.font = `${weight} ${fontSize}px ${font}`;
  }

  const accentW   = severityColor(severity ?? "") ? ACCENT_W : 0;
  const boxWidth  = Math.round(contentW + PAD_X * 2 + accentW);
  const extraRows = (showSeverity ? 1 : 0) + (isQuarantined ? 1 : 0) + (format ? 1 : 0);
  const boxHeight = Math.round(fontSize + PAD_Y * 2 + extraRows * (fontSize + INNER_GAP));

  const x = data.x + data.size + 8;
  const y = data.y - boxHeight / 2;

  // ── Body: flat surface, 1px border ───────────────────────────────────────
  // Was three layers — drop shadow, vertical gradient body, and a top sheen
  // faking a glass highlight. §4: "Elevation: use borders and background
  // steps, not shadows. The identity is flat geometric shapes; drop shadows
  // fight it." A hover card is a popover, so §4 would permit one soft shadow,
  // but the sheen and gradient are not elevation — they are ornament.
  context.fillStyle = token("--c-surface");
  roundedRect(context, x, y, boxWidth, boxHeight, radius);
  context.fill();

  context.strokeStyle = token("--c-border");
  context.lineWidth   = 1;
  roundedRect(context, x, y, boxWidth, boxHeight, radius);
  context.stroke();

  // ── Layer 4: severity accent bar (left edge, clipped to rounded shape) ───
  const sevColor = severity && severityColor(severity);
  if (sevColor && accentW > 0) {
    context.save();
    roundedRect(context, x, y, boxWidth, boxHeight, radius);
    context.clip();
    context.fillStyle    = sevColor;
    context.globalAlpha  = 0.75;
    context.fillRect(x, y, ACCENT_W, boxHeight);
    context.restore();
  }

  // ── Layer 5: label text ───────────────────────────────────────────────────
  const textX = x + accentW + PAD_X;
  if (label) {
    context.font         = `${weight} ${fontSize}px ${font}`;
    context.fillStyle    = token("--t-primary");
    context.textBaseline = "top";
    context.fillText(label, textX, y + PAD_Y);
  }

  // ── Layer 6: format badge ────────────────────────────────────────────────
  let nextRowY = y + PAD_Y + fontSize + INNER_GAP;
  if (format) {
    context.font = `500 ${fontSize - 2}px ${font}`;
    const fW     = context.measureText(format).width + 14;
    const badgeH = Math.round(fontSize - 1);

    /* Neutral, like the quarantine badge and for the same reason: a format is
       a classification, not a severity, and every tinted chip that is not a
       severity makes the severity chips mean less. It leads the badge rows
       because it says what the thing *is*, before what is wrong with it. */
    context.fillStyle = "rgba(139, 156, 175, 0.18)";
    roundedRect(context, textX, nextRowY, fW, badgeH, 3);
    context.fill();

    context.fillStyle    = token("--fg-n-300");
    context.textBaseline = "top";
    context.fillText(format, textX + 7, nextRowY + 1);
    nextRowY += fontSize + INNER_GAP;
  }

  // ── Layer 7: severity badge ───────────────────────────────────────────────
  if (showSeverity && severity) {
    context.font = `500 ${fontSize - 2}px ${font}`;
    const badgeFg = severityColor(severity) ?? token("--t-muted");
    const badgeBg = SEVERITY_BADGE_BG[severity] ?? "rgba(245, 248, 251,0.08)";
    const sevW   = context.measureText(severity).width + 14;
    const badgeH = Math.round(fontSize - 1);

    context.fillStyle = badgeBg;
    roundedRect(context, textX, nextRowY, sevW, badgeH, 3);
    context.fill();

    context.fillStyle    = badgeFg;
    context.textBaseline = "top";
    context.fillText(severity, textX + 7, nextRowY + 1);
    nextRowY += fontSize + INNER_GAP;
  }

  // ── Layer 8: quarantine badge row ────────────────────────────────────────
  if (isQuarantined) {
    context.font = `500 ${fontSize - 2}px ${font}`;
    const qText  = "Quarantined";
    const qW     = context.measureText(qText).width + 22;
    const badgeH = Math.round(fontSize - 1);

    /* Neutral, for the same reason as the node badge: quarantine is a state,
       not a severity, and the severity ramp has to stay meaningful. */
    context.fillStyle = "rgba(139, 156, 175, 0.18)";
    roundedRect(context, textX, nextRowY, qW, badgeH, 4);
    context.fill();

    context.fillStyle    = token("--fg-n-300");
    context.textBaseline = "top";
    context.fillText(qText, textX + 15, nextRowY + 1);

    // Small lock glyph before the text
    const lx = textX + 7, ly = nextRowY + badgeH / 2;
    const lr = badgeH * 0.28;
    context.strokeStyle = token("--fg-n-300");
    context.lineWidth   = lr * 0.7;
    context.lineCap     = "round";
    context.beginPath();
    context.arc(lx, ly - lr * 0.5, lr * 0.6, Math.PI, 0);
    context.stroke();
    context.fillStyle = token("--fg-n-300");
    context.fillRect(lx - lr * 0.6, ly - lr * 0.1, lr * 1.2, lr * 1.0);
  }

  // ── Layer 9: corner lock badge on the node itself ────────────────────────
  if (isQuarantined) {
    const br = Math.max(5, (data.size ?? 1) * 0.58);
    drawLockBadge(context, data.x + (data.size ?? 1) * 0.72, data.y - (data.size ?? 1) * 0.72, br);
  }
}

/* How much of the graph shows through a label plate. Opaque would read as a
 * row of chips laid over the canvas; this reads as the label having been cut
 * out of it, which is what a label is. */
const PLATE_ALPHA = 0.8;

/** A length token as a number of pixels. Tokens are strings like "4px". */
function tokenPx(name: string, fallback: number): number {
  const parsed = parseFloat(token(name, `${fallback}px`));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Node label with a backing plate.
 *
 * Sigma's default draws bare text beside the node. On a graph this dense that
 * puts a light string over whatever happens to be behind it — other nodes,
 * their rings, a bundle of edges — and in dark mode the result is white text
 * on a blue square. A plate in the canvas colour cuts the label out of the
 * background so it reads whatever it lands on.
 *
 * The plate is the *canvas* colour rather than a surface colour: it is not a
 * card sitting above the graph, it is a hole punched in it. Held at 78% so the
 * graph stays visible through it and the labels do not read as a second layer
 * of objects.
 */
export function drawNodeLabel(
  context: CanvasRenderingContext2D,
  data: any,
  settings: Settings,
): void {
  const label = (data.label as string | null | undefined) ?? "";
  if (!label) return;

  const fontSize = settings.labelSize ?? 13;
  const font     = settings.labelFont ?? token("--fg-font-body");
  const weight   = settings.labelWeight ?? "500";
  context.font = `${weight} ${fontSize}px ${font}`;

  const PAD_X = 6;
  const PAD_Y = 3;
  /* Measured from the node's edge, not its centre: `size` here is the rendered
     radius, so this clears nodes of every size by the same visual gap. */
  const GAP = 6;

  const textW = context.measureText(label).width;
  const textX = data.x + data.size + GAP;
  const boxH  = fontSize + PAD_Y * 2;
  const boxX  = textX - PAD_X;
  const boxY  = data.y - boxH / 2;
  const boxW  = textW + PAD_X * 2;

  context.save();
  context.globalAlpha = PLATE_ALPHA;
  context.fillStyle = token("--c-bg");
  /* The mark is rounded squares, so the plate is one too — at the small radius
     rather than a pill, which would read as a chip sitting on the graph. */
  roundedRect(context, boxX, boxY, boxW, boxH, tokenPx("--fg-radius-sm", 4));
  context.fill();
  context.restore();

  /* A hairline rather than a shadow: elevation here is a border and a
     background step, which is what the rest of the surface language does. */
  context.strokeStyle = token("--c-hairline");
  context.lineWidth = 1;
  roundedRect(context, boxX, boxY, boxW, boxH, tokenPx("--fg-radius-sm", 4));
  context.stroke();

  context.fillStyle = (settings.labelColor as { color?: string })?.color ?? token("--t-secondary");
  context.textBaseline = "middle";
  context.fillText(label, textX, data.y);
}

export { drawLockBadge };

/** Draws a small amber lock badge centred at (cx, cy) with radius r. */
function drawLockBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();

  /* A light ring, not a dark one. The disc below is now dark, so the halo that
     separates the badge from the node underneath has to be the opposite: a
     dark ring on a dark disc merged the two into one blob. */
  ctx.beginPath();
  ctx.arc(cx, cy, r + r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = token("--c-bg");
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  /* Not a severity colour. This was --s-medium (gold), which meant every
     quarantined package put a Medium-severity disc on the canvas for a state
     that is not a severity at all — and on a container repo that is dozens of
     amber discs competing with the single ember origin. §1: "there is exactly
     one of it on screen. If your UI has three amber things in it, the
     metaphor is dead and so is the colour's meaning." */
  /* Was --fg-n-400, a mid grey, carrying a near-white glyph: about 3:1, which
     is not enough for a shape this small, and in the light theme --t-primary
     is dark so the lock nearly vanished into the disc. A dark disc with a
     white glyph is high contrast in both themes and stays neutral — a
     quarantine is a state, not a severity, and must not borrow the ramp. */
  ctx.fillStyle = token("--fg-n-800");
  ctx.fill();

  // White lock — shackle (open-bottom arch)
  const shackleR   = r * 0.36;
  const shackleY   = cy - r * 0.12;
  const shackleW   = r * 0.26;
  ctx.beginPath();
  ctx.arc(cx, shackleY, shackleR, Math.PI, 0);
  /* Fixed light, not --t-primary: the disc is dark in both themes, so the
     glyph has to be too — a theme-following colour turned the lock dark-on-dark
     in the light theme. */
  ctx.strokeStyle = token("--fg-n-0");
  ctx.lineWidth   = shackleW;
  ctx.lineCap     = "round";
  ctx.stroke();

  // White lock — body (rounded rectangle)
  const bW = r * 0.88;
  const bH = r * 0.58;
  const bX = cx - bW / 2;
  const bY = cy + r * 0.08;
  const br = r * 0.12;
  ctx.beginPath();
  ctx.moveTo(bX + br, bY);
  ctx.lineTo(bX + bW - br, bY);
  ctx.arcTo(bX + bW, bY, bX + bW, bY + br, br);
  ctx.lineTo(bX + bW, bY + bH - br);
  ctx.arcTo(bX + bW, bY + bH, bX + bW - br, bY + bH, br);
  ctx.lineTo(bX + br, bY + bH);
  ctx.arcTo(bX, bY + bH, bX, bY + bH - br, br);
  ctx.lineTo(bX, bY + br);
  ctx.arcTo(bX, bY, bX + br, bY, br);
  ctx.closePath();
  // Matches the shackle above, for the same reason.
  ctx.fillStyle = token("--fg-n-0");
  ctx.fill();

  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
