/**
 * Glass-style node hover renderer: layered canvas card with gradient body,
 * top sheen, severity accent bar, and an inline severity badge.
 */
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
  const label     = (data.label as string | null | undefined) ?? "";
  const severity  = data.severity  as string | undefined;
  const nodeType  = data.nodeType  as string | undefined;

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

  const accentW   = SEVERITY_COLORS[severity ?? ""] ? ACCENT_W : 0;
  const boxWidth  = Math.round(contentW + PAD_X * 2 + accentW);
  const boxHeight = Math.round(fontSize + PAD_Y * 2 + (showSeverity ? fontSize + INNER_GAP : 0));

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
  if (showSeverity && severity) {
    context.font = `500 ${fontSize - 2}px ${font}`;
    const [badgeBg, badgeFg] = SEVERITY_BADGE[severity] ?? ["rgba(255,255,255,0.08)", "#aaa"];
    const sevW    = context.measureText(severity).width + 14;
    const badgeH  = Math.round(fontSize - 1);
    const badgeY  = y + PAD_Y + fontSize + INNER_GAP;

    context.fillStyle = badgeBg;
    roundedRect(context, textX, badgeY, sevW, badgeH, 3);
    context.fill();

    context.fillStyle    = badgeFg;
    context.textBaseline = "top";
    context.fillText(severity, textX + 7, badgeY + 1);
  }
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
