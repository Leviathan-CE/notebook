export const NMD_NOTEBOOK_TYPE = "nmd-notebook";
export const NMD_INK_LANGUAGE = "nmd-ink";
export const NMD_INK_MIME = "application/x-nmd-ink";
export const NMD_INK_RENDERER_ID = "nmd-ink-renderer";
export const NMD_PYTHON_LANGUAGE = "python";
export const NMD_VERSION = "0.1.0";

export type NmdTool = "pen" | "eraser";

export interface NmdPoint {
  x: number;
  y: number;
  t?: number;
  p?: number;
}

export interface NmdStroke {
  tool: NmdTool;
  color: string;
  width: number;
  points: NmdPoint[];
}

export interface NmdInkSource {
  aspect: number;
  strokes: NmdStroke[];
}

export interface NmdMarkdownCell {
  id: string;
  type: "markdown";
  source: string;
}

export interface NmdPythonOutput {
  stdout?: string;
  stderr?: string;
  result?: string;
  images?: string[];
  error?: string;
}

export interface NmdPythonCell {
  id: string;
  type: "python";
  source: string;
  outputs?: NmdPythonOutput;
}

export interface NmdInkCell {
  id: string;
  type: "ink";
  source: NmdInkSource;
}

export type NmdCell = NmdMarkdownCell | NmdPythonCell | NmdInkCell;

export interface NmdNotebook {
  nbformat: 1;
  nbformat_minor: 0;
  metadata: {
    nmd: {
      version: string;
    };
  };
  cells: NmdCell[];
}

export const NMD_INK_CELL_STUB = "";

export interface NmdCellMetadata {
  inputCollapsed?: boolean;
  outputCollapsed?: boolean;
  nmd?: {
    id: string;
    type: NmdCell["type"];
    source?: NmdInkSource;
    pythonOutput?: NmdPythonOutput;
  };
}

export interface InkUpdateMessage {
  type: "ink-update";
  cellId: string;
  source: NmdInkSource;
}

export interface InkUndoMessage {
  type: "ink-undo";
  cellId: string;
}

export function isInkUpdateMessage(value: unknown): value is InkUpdateMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as InkUpdateMessage;
  return message.type === "ink-update" && typeof message.cellId === "string";
}

export function isInkUndoMessage(value: unknown): value is InkUndoMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as InkUndoMessage;
  return message.type === "ink-undo" && typeof message.cellId === "string";
}

export function emptyInkSource(): NmdInkSource {
  return {
    aspect: 1.6,
    strokes: [],
  };
}

export function generateCellId(): string {
  return crypto.randomUUID();
}
