import {
  emptyInkSource,
  generateCellId,
  NMD_VERSION,
  type NmdCell,
  type NmdInkSource,
  type NmdNotebook,
  type NmdPoint,
  type NmdPythonCell,
  type NmdPythonOutput,
  type NmdStroke,
  type NmdTool,
} from "./types";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function emptyNotebook(): NmdNotebook {
  return {
    nbformat: 1,
    nbformat_minor: 0,
    metadata: {
      nmd: {
        version: NMD_VERSION,
      },
    },
    cells: [
      {
        id: generateCellId(),
        type: "markdown",
        source: "",
      },
    ],
  };
}

export function parseNotebook(content: Uint8Array): NmdNotebook {
  if (content.byteLength === 0) {
    return emptyNotebook();
  }

  const text = decoder.decode(content).trim();
  if (text.length === 0) {
    return emptyNotebook();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyNotebook();
  }

  if (!raw || typeof raw !== "object" || !("cells" in raw) || !Array.isArray((raw as NmdNotebook).cells)) {
    return emptyNotebook();
  }

  const parsed = raw as Partial<NmdNotebook>;
  return {
    nbformat: 1,
    nbformat_minor: 0,
    metadata: {
      nmd: {
        version: parsed.metadata?.nmd?.version ?? NMD_VERSION,
      },
    },
    cells: (parsed.cells ?? []).map(normalizeCell),
  };
}

export function stringifyNotebook(notebook: NmdNotebook): Uint8Array {
  const normalized: NmdNotebook = {
    nbformat: 1,
    nbformat_minor: 0,
    metadata: {
      nmd: {
        version: notebook.metadata?.nmd?.version ?? NMD_VERSION,
      },
    },
    cells: notebook.cells.map(normalizeCell),
  };
  return encoder.encode(`${JSON.stringify(normalized, null, 2)}\n`);
}

export function parseInkSource(text: string): NmdInkSource {
  try {
    return coerceInkSource(JSON.parse(text));
  } catch {
    return emptyInkSource();
  }
}

export function coerceInkSource(source: unknown): NmdInkSource {
  return normalizeInkSource(source);
}

export const NMD_INK_MIN_ASPECT = 0.25;
export const NMD_INK_MAX_ASPECT = 4;
export const NMD_INK_MIN_HEIGHT_PX = 80;

export function clampInkAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return 1.6;
  }
  return Math.min(NMD_INK_MAX_ASPECT, Math.max(NMD_INK_MIN_ASPECT, aspect));
}

export function inkContentMaxY(strokes: NmdStroke[]): number {
  let maxY = 0;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      maxY = Math.max(maxY, point.y);
    }
  }
  return maxY;
}

export function remapInkStrokesY(strokes: NmdStroke[], scale: number): NmdStroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({
      ...point,
      y: clamp01(point.y * scale),
    })),
  }));
}

function normalizeCell(cell: unknown): NmdCell {
  if (!cell || typeof cell !== "object") {
    return {
      id: generateCellId(),
      type: "markdown",
      source: "",
    };
  }

  const value = cell as Partial<NmdCell> & { source?: unknown };
  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : generateCellId();

  if (value.type === "ink") {
    return {
      id,
      type: "ink",
      source: coerceInkSource(value.source),
    };
  }

  if (value.type === "python") {
    const python = value as Partial<NmdPythonCell>;
    return {
      id,
      type: "python",
      source: sourceToString(value.source),
      outputs: normalizePythonOutput(python.outputs),
    };
  }

  return {
    id,
    type: "markdown",
    source: sourceToString(value.source),
  };
}

function sourceToString(source: unknown): string {
  if (typeof source === "string") {
    return source;
  }
  if (Array.isArray(source)) {
    return source.map((line) => (typeof line === "string" ? line : "")).join("\n");
  }
  return "";
}

function normalizePythonOutput(output: unknown): NmdPythonOutput | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }
  const value = output as NmdPythonOutput;
  const next: NmdPythonOutput = {};
  if (typeof value.stdout === "string" && value.stdout.length > 0) {
    next.stdout = value.stdout;
  }
  if (typeof value.stderr === "string" && value.stderr.length > 0) {
    next.stderr = value.stderr;
  }
  if (typeof value.result === "string" && value.result.length > 0) {
    next.result = value.result;
  }
  if (typeof value.error === "string" && value.error.length > 0) {
    next.error = value.error;
  }
  if (Array.isArray(value.images)) {
    const images = value.images.filter((item): item is string => typeof item === "string" && item.length > 0);
    if (images.length > 0) {
      next.images = images;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeInkSource(source: unknown): NmdInkSource {
  if (!source || typeof source !== "object") {
    return emptyInkSource();
  }

  const value = source as Partial<NmdInkSource>;
  const aspect = clampInkAspect(typeof value.aspect === "number" && value.aspect > 0 ? value.aspect : 1.6);
  const strokes = Array.isArray(value.strokes) ? value.strokes.map(normalizeStroke).filter((stroke): stroke is NmdStroke => stroke !== undefined) : [];

  return { aspect, strokes };
}

function normalizeStroke(stroke: unknown): NmdStroke | undefined {
  if (!stroke || typeof stroke !== "object") {
    return undefined;
  }

  const value = stroke as Partial<NmdStroke>;
  const tool: NmdTool = value.tool === "eraser" ? "eraser" : "pen";
  const color = typeof value.color === "string" && value.color.length > 0 ? value.color : "#cccccc";
  const width = typeof value.width === "number" && value.width > 0 ? value.width : 2;
  const points = Array.isArray(value.points)
    ? value.points.map(normalizePoint).filter((point): point is NmdPoint => point !== undefined)
    : [];

  return { tool, color, width, points };
}

function normalizePoint(point: unknown): NmdPoint | undefined {
  if (!point || typeof point !== "object") {
    return undefined;
  }

  const value = point as Partial<NmdPoint>;
  if (typeof value.x !== "number" || typeof value.y !== "number") {
    return undefined;
  }

  const normalized: NmdPoint = {
    x: clamp01(value.x),
    y: clamp01(value.y),
  };
  if (typeof value.t === "number") {
    normalized.t = value.t;
  }
  if (typeof value.p === "number") {
    normalized.p = value.p;
  }
  return normalized;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
