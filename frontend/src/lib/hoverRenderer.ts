/**
 * Custom node hover renderer: draws a dark, rounded label background with
 * light text instead of Sigma's default white-on-white pill (which is
 * unreadable against our light label color).
 */
import type { Settings } from "sigma/settings";
import type { NodeDisplayData } from "sigma/types";

export function drawDarkNodeHover(
  context: CanvasRenderingContext2D,
  data: NodeDisplayData & { label?: string | null },
  settings: Settings,
): void {
  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;
  const label = data.label;

  context.font = `${weight} ${size}px ${font}`;

  // Compute pill dimensions
  const PADDING_X = 8;
  const PADDING_Y = 5;
  const textWidth = label ? context.measureText(label).width : 0;
  const boxWidth = Math.round(textWidth + PADDING_X * 2);
  const boxHeight = Math.round(size + PADDING_Y * 2);
  const radius = Math.min(8, boxHeight / 2);

  const x = data.x + data.size + 4;
  const y = data.y - boxHeight / 2;

  // Dark rounded background
  context.fillStyle = "rgba(20, 22, 28, 0.95)";
  context.strokeStyle = "rgba(255, 255, 255, 0.08)";
  context.lineWidth = 1;
  roundedRect(context, x, y, boxWidth, boxHeight, radius);
  context.fill();
  context.stroke();

  if (label) {
    context.fillStyle = "#f4f4f5";
    context.textBaseline = "middle";
    context.fillText(label, x + PADDING_X, y + boxHeight / 2);
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
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
