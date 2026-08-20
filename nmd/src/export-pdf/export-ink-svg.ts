import { clampInkAspect } from "../format.js";
import type { NmdInkSource, NmdPoint, NmdStroke } from "../types.js";

const SVG_WIDTH = 800;

export function inkToSvg(source: NmdInkSource): string {
  const aspect = clampInkAspect(source.aspect > 0 ? source.aspect : 1.6);
  const width = SVG_WIDTH;
  const height = Math.max(width / aspect, 1);
  const strokes = source.strokes ?? [];

  const body = strokes
    .map((stroke) => {
      if (stroke.points.length === 0) {
        return "";
      }
      if (stroke.tool === "eraser") {
        return `<g fill="#ffffff">${strokeToCircles(stroke, width, height, "#ffffff")}</g>`;
      }
      if (stroke.color === "theme") {
        return `<g fill="currentColor" style="color: var(--fg)">${strokeToCircles(stroke, width, height, "currentColor")}</g>`;
      }
      return `<g fill="${escapeXml(stroke.color)}">${strokeToCircles(stroke, width, height, stroke.color)}</g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Ink drawing"><rect width="100%" height="100%" fill="transparent"/>${body}</svg>`;
}

function strokeToCircles(stroke: NmdStroke, width: number, height: number, color: string): string {
  const circles: string[] = [];
  const points = stroke.points;
  stampDot(circles, points[0], stroke.width, width, height, color);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const x0 = from.x * width;
    const y0 = from.y * height;
    const x1 = to.x * width;
    const y1 = to.y * height;
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const spacing = Math.max(0.8, stampRadius(stroke.width, pointPressure(from)) * 0.25);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      stampDot(
        circles,
        {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          p: lerp(pointPressure(from), pointPressure(to), t),
        },
        stroke.width,
        width,
        height,
        color,
      );
    }
  }
  return circles.join("");
}

function stampDot(
  circles: string[],
  point: NmdPoint,
  baseWidth: number,
  width: number,
  height: number,
  color: string,
): void {
  const radius = stampRadius(baseWidth, pointPressure(point));
  const cx = point.x * width;
  const cy = point.y * height;
  circles.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" fill="${escapeXml(color)}"/>`);
}

function stampRadius(baseWidth: number, pressure: number): number {
  return Math.max(0.5, (baseWidth / 2) * pressure);
}

function pointPressure(point: NmdPoint): number {
  return typeof point.p === "number" ? clamp(point.p, 0.05, 1) : 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
