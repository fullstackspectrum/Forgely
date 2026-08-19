/**
 * Node hover card: a flat surface with a 1px border, a severity accent bar,
 * and an inline severity badge. Drawn on canvas rather than in the DOM
 * because it tracks a WebGL node position.
 * Also exports a custom label drawer that renders a lock badge for quarantined nodes.
 */
import { drawDiscNodeLabel } from "sigma/rendering";
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

  const accentW   = severityColor(severity ?? "") ? ACCENT_W : 0;
  const boxWidth  = Math.round(contentW + PAD_X * 2 + accentW);
  const extraRows = (showSeverity ? 1 : 0) + (isQuarantined ? 1 : 0);
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

  // ── Layer 6: severity badge ───────────────────────────────────────────────
  let nextRowY = y + PAD_Y + fontSize + INNER_GAP;
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

  // ── Layer 7: quarantine badge row ────────────────────────────────────────
  if (isQuarantined) {
    context.font = `500 ${fontSize - 2}px ${font}`;
    const qText  = "Quarantined";
    const qW     = context.measureText(qText).width + 22;
    const badgeH = Math.round(fontSize - 1);

    context.fillStyle = "rgba(217, 182, 92,0.20)";
    roundedRect(context, textX, nextRowY, qW, badgeH, 3);
    context.fill();

    context.fillStyle    = token("--s-medium");
    context.textBaseline = "top";
    context.fillText(qText, textX + 15, nextRowY + 1);

    // Small lock glyph before the text
    const lx = textX + 7, ly = nextRowY + badgeH / 2;
    const lr = badgeH * 0.28;
    context.strokeStyle = token("--s-medium");
    context.lineWidth   = lr * 0.7;
    context.lineCap     = "round";
    context.beginPath();
    context.arc(lx, ly - lr * 0.5, lr * 0.6, Math.PI, 0);
    context.stroke();
    context.fillStyle = token("--s-medium");
    context.fillRect(lx - lr * 0.6, ly - lr * 0.1, lr * 1.2, lr * 1.0);
  }

  // ── Layer 8: corner lock badge on the node itself ────────────────────────
  if (isQuarantined) {
    const br = Math.max(5, (data.size ?? 1) * 0.58);
    drawLockBadge(context, data.x + (data.size ?? 1) * 0.72, data.y - (data.size ?? 1) * 0.72, br);
  }
}

export function drawNodeLabel(
  context: CanvasRenderingContext2D,
  data: any,
  settings: Settings,
): void {
  drawDiscNodeLabel(context, data, settings);
}

export { drawLockBadge };

/** Draws a small amber lock badge centred at (cx, cy) with radius r. */
function drawLockBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();

  // Dark border ring for contrast against any node colour
  ctx.beginPath();
  ctx.arc(cx, cy, r + r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(10, 22, 34,0.55)";
  ctx.fill();

  // Amber filled background circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = token("--s-medium");
  ctx.fill();

  // White lock — shackle (open-bottom arch)
  const shackleR   = r * 0.36;
  const shackleY   = cy - r * 0.12;
  const shackleW   = r * 0.22;
  ctx.beginPath();
  ctx.arc(cx, shackleY, shackleR, Math.PI, 0);
  ctx.strokeStyle = token("--t-primary");
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
  ctx.fillStyle = token("--t-primary");
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
