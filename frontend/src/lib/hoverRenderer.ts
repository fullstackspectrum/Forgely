/**
 * Glass-style node hover renderer: layered canvas card with gradient body,
 * top sheen, severity accent bar, and an inline severity badge.
 * Also exports a custom label drawer that renders a lock badge for quarantined nodes.
 */
import { drawDiscNodeLabel } from "sigma/rendering";
import type { Settings } from "sigma/settings";

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ff4d4d",
  High:     "#ff8c1a",
  Medium:   "#ffd11a",
  Low:      "#79b8ff",
};

const SEVERITY_BADGE: Record<string, [string, string]> = {
  Critical: ["rgba(255,77,77,0.22)",  "#ff7070"],
  High:     ["rgba(255,140,26,0.22)", "#ffaa50"],
  Medium:   ["rgba(255,209,26,0.18)", "#ffdd50"],
  Low:      ["rgba(121,184,255,0.18)","#90ccff"],
};

export function drawDarkNodeHover(
  context: CanvasRenderingContext2D,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  settings: Settings,
): void {
  const fontSize  = settings.labelSize  ?? 12;
  const font      = settings.labelFont  ?? "Inter, system-ui, sans-serif";
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
  const radius    = 9;

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

  const accentW   = SEVERITY_COLORS[severity ?? ""] ? ACCENT_W : 0;
  const boxWidth  = Math.round(contentW + PAD_X * 2 + accentW);
  const extraRows = (showSeverity ? 1 : 0) + (isQuarantined ? 1 : 0);
  const boxHeight = Math.round(fontSize + PAD_Y * 2 + extraRows * (fontSize + INNER_GAP));

  const x = data.x + data.size + 8;
  const y = data.y - boxHeight / 2;

  // ── Layer 1: drop shadow + glass body ────────────────────────────────────
  context.save();
  context.shadowColor    = "rgba(0, 0, 0, 0.65)";
  context.shadowBlur     = 22;
  context.shadowOffsetY  = 5;
  const bodyGrad = context.createLinearGradient(x, y, x, y + boxHeight);
  bodyGrad.addColorStop(0, "rgba(30, 33, 52, 0.97)");
  bodyGrad.addColorStop(1, "rgba(16, 18, 30, 0.97)");
  context.fillStyle = bodyGrad;
  roundedRect(context, x, y, boxWidth, boxHeight, radius);
  context.fill();
  context.restore();

  // ── Layer 2: top sheen (glass highlight) ─────────────────────────────────
  const sheen = context.createLinearGradient(x, y, x, y + boxHeight * 0.5);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.11)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = sheen;
  roundedRect(context, x, y, boxWidth, boxHeight, radius);
  context.fill();

  // ── Layer 3: outer border ────────────────────────────────────────────────
  context.strokeStyle = "rgba(255, 255, 255, 0.11)";
  context.lineWidth   = 1;
  roundedRect(context, x, y, boxWidth, boxHeight, radius);
  context.stroke();

  // ── Layer 4: severity accent bar (left edge, clipped to rounded shape) ───
  const sevColor = severity && SEVERITY_COLORS[severity];
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
    context.fillStyle    = "#ededf5";
    context.textBaseline = "top";
    context.fillText(label, textX, y + PAD_Y);
  }

  // ── Layer 6: severity badge ───────────────────────────────────────────────
  let nextRowY = y + PAD_Y + fontSize + INNER_GAP;
  if (showSeverity && severity) {
    context.font = `500 ${fontSize - 2}px ${font}`;
    const [badgeBg, badgeFg] = SEVERITY_BADGE[severity] ?? ["rgba(255,255,255,0.08)", "#aaa"];
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

    context.fillStyle = "rgba(245,158,11,0.20)";
    roundedRect(context, textX, nextRowY, qW, badgeH, 3);
    context.fill();

    context.fillStyle    = "#f59e0b";
    context.textBaseline = "top";
    context.fillText(qText, textX + 15, nextRowY + 1);

    // Small lock glyph before the text
    const lx = textX + 7, ly = nextRowY + badgeH / 2;
    const lr = badgeH * 0.28;
    context.strokeStyle = "#f59e0b";
    context.lineWidth   = lr * 0.7;
    context.lineCap     = "round";
    context.beginPath();
    context.arc(lx, ly - lr * 0.5, lr * 0.6, Math.PI, 0);
    context.stroke();
    context.fillStyle = "#f59e0b";
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

/** Draws a small amber circle-slash icon centred at (cx, cy) with radius r. */
function drawLockBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();

  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth   = r * 0.28;
  ctx.lineCap     = "round";

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  const d = r * 0.707;
  ctx.beginPath();
  ctx.moveTo(cx + d, cy - d);
  ctx.lineTo(cx - d, cy + d);
  ctx.stroke();

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
