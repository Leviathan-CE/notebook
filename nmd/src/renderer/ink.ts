import type { ActivationFunction } from "vscode-notebook-renderer";
import {
  clampInkAspect,
  inkContentMaxY,
  NMD_INK_MIN_ASPECT,
  NMD_INK_MIN_HEIGHT_PX,
  remapInkStrokesY,
} from "../format";
import { isInkUndoMessage, type NmdInkSource, type NmdPoint, type NmdStroke, type NmdTool } from "../types";

type ActiveTool = NmdTool | "select";
type SelectMode = "idle" | "marquee" | "move";

interface NormalizedRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface SelectionView {
  selectedIndices: ReadonlySet<number>;
  marquee: NormalizedRect | null;
}

interface InkPayload extends NmdInkSource {
  id: string;
}

const PRESET_COLORS = [
  { label: "Ink", value: "theme" },
  { label: "White", value: "#f2f2f2" },
  { label: "Red", value: "#e03131" },
  { label: "Blue", value: "#1c7ed6" },
  { label: "Green", value: "#2f9e44" },
] as const;

const PEN_SIZE_MIN = 1;
const PEN_SIZE_MAX = 48;
const ERASER_SIZE_MIN = 4;
const ERASER_SIZE_MAX = 80;
const MARQUEE_MIN_SIZE = 0.006;

export const activate: ActivationFunction = (context) => {
  const undoByCell = new Map<string, () => void>();

  context.onDidReceiveMessage?.((message) => {
    if (!isInkUndoMessage(message)) {
      return;
    }
    undoByCell.get(message.cellId)?.();
  });

  return {
    renderOutputItem(outputItem, element) {
      let payload: InkPayload;
      try {
        payload = readPayload(outputItem);
      } catch (error) {
        renderInkError(element, error);
        return;
      }

      if (!payload?.id) {
        element.textContent = "Ink cell is missing an id.";
        return;
      }

      try {
        const undo = mountCanvas(element, payload, (source) => {
          context.postMessage?.({
            type: "ink-update",
            cellId: payload.id,
            source,
          });
        });
        undoByCell.set(payload.id, undo);
      } catch (error) {
        renderInkFallback(element, payload, error);
      }
    },
  };
};

function readPayload(outputItem: { json: () => unknown; text: () => string }): InkPayload {
  try {
    return outputItem.json() as InkPayload;
  } catch {
    return JSON.parse(outputItem.text()) as InkPayload;
  }
}

function renderInkError(element: HTMLElement, error: unknown): void {
  element.innerHTML = "";
  const root = document.createElement("div");
  root.className = "nmd-ink-error";
  const title = document.createElement("p");
  title.textContent = "NMD ink could not read this cell.";
  const detail = document.createElement("pre");
  detail.textContent = error instanceof Error ? error.message : String(error);
  root.append(title, detail);
  element.append(styleTag(), root);
}

function renderInkFallback(element: HTMLElement, payload: InkPayload, error: unknown): void {
  element.innerHTML = "";
  const root = document.createElement("div");
  root.className = "nmd-ink-fallback";

  const banner = document.createElement("div");
  banner.className = "nmd-ink-fallback-banner";
  banner.textContent = "Interactive ink failed to load. Showing a read-only preview.";
  const detail = document.createElement("pre");
  detail.textContent = error instanceof Error ? error.message : String(error);

  const canvas = document.createElement("canvas");
  canvas.className = "nmd-ink-fallback-canvas";

  root.append(banner, detail, canvas);
  element.append(styleTag(), root);

  const aspect = clampInkAspect(payload.aspect > 0 ? payload.aspect : 1.6);
  const strokes = structuredClone(payload.strokes ?? []);
  const draw = () => {
    const width = Math.max(root.clientWidth, 1);
    const height = Math.max(width / aspect, 1);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw(ctx, strokes, width, height, { selectedIndices: new Set(), marquee: null });
  };

  const observer = new ResizeObserver(() => draw());
  observer.observe(root);
  draw();
}

function mountCanvas(element: HTMLElement, payload: InkPayload, persist: (source: NmdInkSource) => void): () => void {
  element.innerHTML = "";

  const root = document.createElement("div");
  root.className = "nmd-ink";

  const toolbar = document.createElement("div");
  toolbar.className = "nmd-ink-toolbar";

  const penButton = toolButton("Pen");
  const eraserButton = toolButton("Eraser");
  const selectButton = toolButton("Select");
  const undoButton = toolButton("Undo");
  const clearButton = toolButton("Clear");

  const colors = document.createElement("div");
  colors.className = "nmd-ink-colors";
  const swatches = PRESET_COLORS.map((preset) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "nmd-ink-swatch";
    swatch.title = preset.label;
    swatch.style.background = preset.value === "theme" ? "var(--vscode-editor-foreground)" : preset.value;
    colors.append(swatch);
    return { preset, swatch };
  });

  const penSlider = sizeSlider("P", "Pen size", PEN_SIZE_MIN, PEN_SIZE_MAX, 8);
  const eraserSlider = sizeSlider("E", "Eraser size", ERASER_SIZE_MIN, ERASER_SIZE_MAX, 24);

  const pickerWrap = document.createElement("label");
  pickerWrap.className = "nmd-ink-picker-wrap";
  pickerWrap.title = "Custom color";
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = "#ff9f1c";
  pickerWrap.append(picker);
  colors.append(pickerWrap);

  toolbar.append(penButton, eraserButton, selectButton, colors, penSlider.row, eraserSlider.row, undoButton, clearButton);

  const stage = document.createElement("div");
  stage.className = "nmd-ink-stage";
  stage.tabIndex = 0;
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  const cursor = document.createElement("div");
  cursor.className = "nmd-ink-cursor";
  stage.append(canvas, cursor);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "nmd-ink-resize";
  resizeHandle.title = "Drag to change drawing height";
  root.append(toolbar, stage, resizeHandle);
  element.append(styleTag(), root);

  let tool: ActiveTool = "pen";
  let colorKey = "theme";
  let penSize = 8;
  let eraserSize = 24;
  let strokes: NmdStroke[] = structuredClone(payload.strokes ?? []);
  let current: NmdStroke | undefined;
  let selectedIndices = new Set<number>();
  let selectMode: SelectMode = "idle";
  let marqueeStart: NmdPoint | undefined;
  let marqueeCurrent: NmdPoint | undefined;
  let selectDragPoint: NmdPoint | undefined;
  let pointerDownHit: number | null = null;
  let pointerDownShift = false;
  let aspect = clampInkAspect(payload.aspect > 0 ? payload.aspect : 1.6);
  let resizing = false;
  let resizeStartY = 0;
  let resizeStartHeight = 0;
  let resizeStartStrokes: NmdStroke[] = [];
  let stopSelectTracking: () => void = () => {};
  let usingRawUpdates = false;
  let activePointerId: number | undefined;

  const setTool = (next: ActiveTool) => {
    tool = next;
    penButton.classList.toggle("active", tool === "pen");
    eraserButton.classList.toggle("active", tool === "eraser");
    selectButton.classList.toggle("active", tool === "select");
    colors.classList.toggle("disabled", tool === "eraser" || tool === "select");
    penSlider.row.classList.toggle("disabled", tool === "select");
    eraserSlider.row.classList.toggle("disabled", tool === "select");
  };

  const canvasSize = () => ({
    width: Math.max(root.clientWidth, 1),
    height: Math.max(Math.max(root.clientWidth, 1) / aspect, 1),
  });

  const findStrokesInRect = (rect: NormalizedRect): Set<number> => {
    const { width, height } = canvasSize();
    const found = new Set<number>();
    for (let index = 0; index < strokes.length; index += 1) {
      const bounds = strokeBounds(strokes[index], width, height);
      if (bounds && rectsIntersect(rect, bounds, width, height)) {
        found.add(index);
      }
    }
    return found;
  };

  const selectionUnionBounds = (): { x: number; y: number; w: number; h: number } | undefined => {
    const { width, height } = canvasSize();
    return unionBounds(selectedIndices, strokes, width, height);
  };

  const isPointInSelection = (point: NmdPoint): boolean => {
    const bounds = selectionUnionBounds();
    if (!bounds) {
      return false;
    }
    const { width, height } = canvasSize();
    const padding = 8;
    const px = point.x * width;
    const py = point.y * height;
    return (
      px >= bounds.x - padding &&
      px <= bounds.x + bounds.w + padding &&
      py >= bounds.y - padding &&
      py <= bounds.y + bounds.h + padding
    );
  };

  const activeMarquee = (): NormalizedRect | null => {
    if (selectMode !== "marquee" || !marqueeStart || !marqueeCurrent) {
      return null;
    }
    return normalizeRect(marqueeStart, marqueeCurrent);
  };

  const resetSelectInteraction = () => {
    stopSelectTracking();
    selectMode = "idle";
    marqueeStart = undefined;
    marqueeCurrent = undefined;
    selectDragPoint = undefined;
    pointerDownHit = null;
    pointerDownShift = false;
    activePointerId = undefined;
  };

  const findStrokeAt = (nx: number, ny: number): number | null => {
    const { width, height } = canvasSize();
    for (let index = strokes.length - 1; index >= 0; index -= 1) {
      if (hitTestStroke(strokes[index], nx, ny, width, height)) {
        return index;
      }
    }
    return null;
  };

  const applySelection = (next: Set<number>, shift: boolean) => {
    if (shift) {
      for (const index of next) {
        if (selectedIndices.has(index)) {
          selectedIndices.delete(index);
        } else {
          selectedIndices.add(index);
        }
      }
      return;
    }
    selectedIndices = next;
  };

  const setColor = (value: string) => {
    colorKey = value;
    const isPreset = PRESET_COLORS.some((preset) => preset.value === colorKey);
    for (const item of swatches) {
      item.swatch.classList.toggle("active", item.preset.value === colorKey);
    }
    pickerWrap.classList.toggle("active", !isPreset);
    if (!isPreset) {
      picker.value = value;
    }
  };

  const currentSize = () => (tool === "eraser" ? eraserSize : penSize);

  const hideCursor = () => {
    cursor.style.display = "none";
  };

  const updateCursor = (event: PointerEvent) => {
    if (resizing) {
      hideCursor();
      return;
    }
    if (tool === "select") {
      hideCursor();
      if (selectMode === "move") {
        canvas.style.cursor = "grabbing";
        return;
      }
      if (selectMode === "marquee") {
        canvas.style.cursor = "crosshair";
        return;
      }
      const point = pointFromEvent(event);
      if (selectedIndices.size > 0 && isPointInSelection(point)) {
        canvas.style.cursor = "grab";
        return;
      }
      canvas.style.cursor = "crosshair";
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const pressure = event.buttons > 0 ? pressureFromEvent(event) : 1;
    const diameter = currentSize() * pressure;
    cursor.style.display = "block";
    cursor.style.left = `${event.clientX - bounds.left}px`;
    cursor.style.top = `${event.clientY - bounds.top}px`;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
  };

  const setToolAndCursor = (next: ActiveTool) => {
    resetSelectInteraction();
    setTool(next);
    if (next === "select") {
      canvas.style.cursor = "crosshair";
      return;
    }
    canvas.style.cursor = "none";
  };

  const size = () => {
    const cssWidth = Math.max(root.clientWidth, 1);
    const cssHeight = Math.max(cssWidth / aspect, 1);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw(ctx, strokes, cssWidth, cssHeight, {
      selectedIndices,
      marquee: activeMarquee(),
    });
  };

  const emit = () => persist({ aspect, strokes: structuredClone(strokes) });

  const pointFromEvent = (event: PointerEvent, parent?: PointerEvent): NmdPoint => {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - bounds.left) / Math.max(bounds.width, 1)),
      y: clamp01((event.clientY - bounds.top) / Math.max(bounds.height, 1)),
      t: event.timeStamp,
      p: pressureFromEvent(event, parent),
    };
  };

  const appendPointerSamples = (event: PointerEvent, useCoalesced: boolean) => {
    if (!current) {
      return;
    }
    const batch =
      useCoalesced && typeof event.getCoalescedEvents === "function" && event.getCoalescedEvents().length > 0
        ? event.getCoalescedEvents()
        : [event];
    for (const sample of batch) {
      current.points.push(pointFromEvent(sample, event));
    }
    size();
  };

  const onPointerSample = (event: PointerEvent, useCoalesced: boolean) => {
    if (!event.isPrimary) {
      return;
    }
    updateCursor(event);
    if (!current) {
      return;
    }
    appendPointerSamples(event, useCoalesced);
  };

  const stopStrokeTracking = () => {
    window.removeEventListener("pointermove", onWindowMove, true);
    window.removeEventListener("pointerup", onWindowEnd, true);
    window.removeEventListener("pointercancel", onWindowEnd, true);
    window.removeEventListener("pointerrawupdate", onWindowRaw, true);
  };

  const onWindowMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    if (usingRawUpdates) {
      updateCursor(event);
      return;
    }
    onPointerSample(event, true);
  };

  const onWindowRaw = ((event: Event) => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerId !== activePointerId || !pointerEvent.isPrimary) {
      return;
    }
    usingRawUpdates = true;
    onPointerSample(pointerEvent, false);
  }) as EventListener;

  const onWindowEnd = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    stopStrokeTracking();
    activePointerId = undefined;
    endStroke(event);
  };

  const stopSelectTrackingImpl = () => {
    window.removeEventListener("pointermove", onSelectMove, true);
    window.removeEventListener("pointerup", onSelectEnd, true);
    window.removeEventListener("pointercancel", onSelectEnd, true);
  };
  stopSelectTracking = stopSelectTrackingImpl;

  const onSelectMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    const point = pointFromEvent(event);
    if (selectMode === "marquee") {
      marqueeCurrent = point;
      size();
      updateCursor(event);
      return;
    }
    if (selectMode !== "move" || !selectDragPoint || selectedIndices.size === 0) {
      return;
    }
    const dx = point.x - selectDragPoint.x;
    const dy = point.y - selectDragPoint.y;
    if (dx === 0 && dy === 0) {
      updateCursor(event);
      return;
    }
    strokes = strokes.map((stroke, index) =>
      selectedIndices.has(index) ? translateStroke(stroke, dx, dy) : stroke,
    );
    selectDragPoint = point;
    size();
    updateCursor(event);
  };

  const onSelectEnd = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    if (selectMode === "marquee" && marqueeStart && marqueeCurrent) {
      const rect = normalizeRect(marqueeStart, marqueeCurrent);
      const isTiny = rect.x2 - rect.x1 < MARQUEE_MIN_SIZE && rect.y2 - rect.y1 < MARQUEE_MIN_SIZE;
      if (isTiny) {
        if (pointerDownHit !== null) {
          applySelection(new Set([pointerDownHit]), pointerDownShift);
        } else if (!pointerDownShift) {
          selectedIndices = new Set();
        }
      } else {
        applySelection(findStrokesInRect(rect), pointerDownShift);
      }
    } else if (selectMode === "move") {
      emit();
    }

    resetSelectInteraction();
    size();
    updateCursor(event);
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (resizing || !event.isPrimary) {
      return;
    }
    event.preventDefault();
    canvas.focus({ preventScroll: true });

    if (tool === "select") {
      const point = pointFromEvent(event);
      const hit = findStrokeAt(point.x, point.y);
      pointerDownHit = hit;
      pointerDownShift = event.shiftKey;
      activePointerId = event.pointerId;

      const canMove =
        selectedIndices.size > 0 &&
        ((hit !== null && selectedIndices.has(hit)) || isPointInSelection(point));

      if (canMove) {
        selectMode = "move";
        selectDragPoint = point;
      } else {
        selectMode = "marquee";
        marqueeStart = point;
        marqueeCurrent = point;
        if (!event.shiftKey) {
          selectedIndices = new Set();
        }
      }

      size();
      updateCursor(event);
      window.addEventListener("pointermove", onSelectMove, true);
      window.addEventListener("pointerup", onSelectEnd, true);
      window.addEventListener("pointercancel", onSelectEnd, true);
      return;
    }

    usingRawUpdates = false;
    activePointerId = event.pointerId;
    current = {
      tool,
      color: resolveColor(colorKey),
      width: currentSize(),
      points: [pointFromEvent(event)],
    };
    strokes = [...strokes, current];
    updateCursor(event);
    size();
    window.addEventListener("pointermove", onWindowMove, true);
    window.addEventListener("pointerup", onWindowEnd, true);
    window.addEventListener("pointercancel", onWindowEnd, true);
    window.addEventListener("pointerrawupdate", onWindowRaw, true);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (current) {
      return;
    }
    updateCursor(event);
  });

  const endStroke = (event: PointerEvent) => {
    usingRawUpdates = false;
    updateCursor(event);
    if (!current) {
      return;
    }
    current = undefined;
    emit();
  };

  canvas.addEventListener("pointerenter", updateCursor);
  canvas.addEventListener("pointerleave", hideCursor);

  resizeHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resizing = true;
    current = undefined;
    hideCursor();
    resizeHandle.setPointerCapture(event.pointerId);
    resizeStartY = event.clientY;
    resizeStartHeight = canvas.getBoundingClientRect().height;
    resizeStartStrokes = structuredClone(strokes);
  });

  resizeHandle.addEventListener("pointermove", (event) => {
    if (!resizing) {
      return;
    }
    const width = Math.max(root.clientWidth, 1);
    const minHeight = Math.max(NMD_INK_MIN_HEIGHT_PX, inkContentMaxY(resizeStartStrokes) * resizeStartHeight);
    const maxHeight = Math.max(minHeight, width / NMD_INK_MIN_ASPECT);
    const newHeight = clamp(resizeStartHeight + (event.clientY - resizeStartY), minHeight, maxHeight);
    const scale = resizeStartHeight / newHeight;
    aspect = clampInkAspect(width / newHeight);
    strokes = remapInkStrokesY(resizeStartStrokes, scale);
    size();
  });

  const endResize = () => {
    if (!resizing) {
      return;
    }
    resizing = false;
    emit();
  };

  resizeHandle.addEventListener("pointerup", endResize);
  resizeHandle.addEventListener("pointercancel", endResize);

  const undoLast = () => {
    if (strokes.length === 0) {
      return;
    }
    if (current) {
      current = undefined;
      activePointerId = undefined;
      stopStrokeTracking();
    }
    if (selectMode !== "idle") {
      resetSelectInteraction();
    }
    strokes = strokes.slice(0, -1);
    selectedIndices = new Set([...selectedIndices].filter((index) => index < strokes.length));
    size();
    emit();
  };

  const onUndoKey = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
      return;
    }
    if (event.key.toLowerCase() !== "z") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    undoLast();
  };

  canvas.addEventListener("keydown", onUndoKey);
  stage.addEventListener("keydown", onUndoKey);

  penButton.addEventListener("click", () => setToolAndCursor("pen"));
  eraserButton.addEventListener("click", () => setToolAndCursor("eraser"));
  selectButton.addEventListener("click", () => setToolAndCursor("select"));
  undoButton.addEventListener("click", () => undoLast());
  clearButton.addEventListener("click", () => {
    strokes = [];
    selectedIndices = new Set();
    resetSelectInteraction();
    size();
    emit();
  });

  for (const item of swatches) {
    item.swatch.addEventListener("click", () => {
      setToolAndCursor("pen");
      setColor(item.preset.value);
    });
  }

  picker.addEventListener("input", () => {
    setToolAndCursor("pen");
    setColor(picker.value);
  });

  penSlider.input.addEventListener("input", () => {
    penSize = Number(penSlider.input.value);
    penSlider.value.textContent = String(penSize);
    setToolAndCursor("pen");
  });
  eraserSlider.input.addEventListener("input", () => {
    eraserSize = Number(eraserSlider.input.value);
    eraserSlider.value.textContent = String(eraserSize);
    setToolAndCursor("eraser");
  });

  const observer = new ResizeObserver(() => size());
  observer.observe(root);
  setToolAndCursor("pen");
  setColor("theme");
  size();
  return undoLast;
}

function redraw(
  ctx: CanvasRenderingContext2D,
  strokes: NmdStroke[],
  width: number,
  height: number,
  selection: SelectionView,
): void {
  const focusColor =
    getComputedStyle(document.documentElement).getPropertyValue("--vscode-focusBorder").trim() || "#007fd4";

  ctx.clearRect(0, 0, width, height);
  for (let index = 0; index < strokes.length; index += 1) {
    const stroke = strokes[index];
    if (stroke.points.length === 0) {
      continue;
    }
    ctx.save();
    if (stroke.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = stroke.color;
    }
    stampStroke(ctx, stroke, width, height);
    ctx.restore();
  }

  const previewIndices = selection.marquee ? findStrokesInRectStatic(strokes, selection.marquee, width, height) : null;

  for (const index of selection.selectedIndices) {
    const stroke = strokes[index];
    if (!stroke) {
      continue;
    }
    drawStrokeHighlight(ctx, stroke, width, height, focusColor);
  }

  if (previewIndices) {
    for (const index of previewIndices) {
      if (selection.selectedIndices.has(index)) {
        continue;
      }
      const stroke = strokes[index];
      if (!stroke) {
        continue;
      }
      drawStrokeHighlight(ctx, stroke, width, height, focusColor, 0.12);
    }
  }

  const union = unionBounds(selection.selectedIndices, strokes, width, height);
  if (union) {
    drawBoundsBox(ctx, union, focusColor, 6, false);
  }

  if (selection.marquee) {
    drawMarquee(ctx, selection.marquee, width, height, focusColor);
  }
}

function stampStroke(ctx: CanvasRenderingContext2D, stroke: NmdStroke, width: number, height: number): void {
  const points = stroke.points;
  stampDot(ctx, points[0], stroke.width, width, height);
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
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
        ctx,
        {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          p: lerp(pointPressure(from), pointPressure(to), t),
        },
        stroke.width,
        width,
        height,
      );
    }
  }
}

function stampDot(ctx: CanvasRenderingContext2D, point: NmdPoint, baseWidth: number, width: number, height: number): void {
  const radius = stampRadius(baseWidth, pointPressure(point));
  ctx.beginPath();
  ctx.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
  ctx.fill();
}

function stampRadius(baseWidth: number, pressure: number): number {
  return Math.max(0.5, (baseWidth / 2) * pressure);
}

function pointPressure(point: NmdPoint): number {
  return typeof point.p === "number" ? clamp(point.p, 0.05, 1) : 1;
}

function pressureFromEvent(event: PointerEvent, parent?: PointerEvent): number {
  const type = event.pointerType || parent?.pointerType || "";
  const raw = readPressure(event) ?? readPressure(parent);

  // Huion without Windows Ink (and real mice) show up as mouse + dummy 0 or 0.5.
  if (isDummyPressure(type, raw)) {
    return 1;
  }

  if (raw === undefined || raw === 0) {
    const buttons = event.buttons || parent?.buttons || 0;
    return buttons > 0 ? 0.5 : 0.05;
  }

  return clamp(raw, 0.05, 1);
}

function isDummyPressure(type: string, raw: number | undefined): boolean {
  if (type === "pen" || type === "touch") {
    return false;
  }
  return raw === undefined || raw === 0 || raw === 0.5;
}

function readPressure(event?: PointerEvent): number | undefined {
  if (!event) {
    return undefined;
  }
  const candidate = event as PointerEvent & { force?: number };
  if (typeof candidate.pressure === "number" && !Number.isNaN(candidate.pressure)) {
    return candidate.pressure;
  }
  if (typeof candidate.force === "number" && !Number.isNaN(candidate.force)) {
    return candidate.force;
  }
  return undefined;
}

function resolveColor(colorKey: string): string {
  if (colorKey !== "theme") {
    return colorKey;
  }
  return getComputedStyle(document.documentElement).getPropertyValue("--vscode-editor-foreground").trim() || "#cccccc";
}

function toolButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  return button;
}

function sizeSlider(
  label: string,
  title: string,
  min: number,
  max: number,
  value: number,
): { row: HTMLElement; input: HTMLInputElement; value: HTMLSpanElement } {
  const sliderRow = document.createElement("label");
  sliderRow.className = "nmd-ink-slider";
  sliderRow.title = title;
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  const readout = document.createElement("span");
  readout.textContent = String(value);
  sliderRow.append(caption, input, readout);
  return { row: sliderRow, input, value: readout };
}

function styleTag(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    .nmd-ink {
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 6px;
      background: var(--vscode-editor-background, transparent);
    }
    .nmd-ink-toolbar {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      overflow-x: auto;
      border-bottom: 1px solid var(--vscode-widget-border, #444);
    }
    .nmd-ink-colors {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 4px;
    }
    .nmd-ink-colors.disabled {
      opacity: 0.45;
      pointer-events: none;
    }
    .nmd-ink-toolbar button {
      flex: 0 0 auto;
      background: var(--vscode-button-secondaryBackground, #3a3a3a);
      color: var(--vscode-button-secondaryForeground, #fff);
      border: none;
      border-radius: 4px;
      padding: 3px 8px;
      cursor: pointer;
      white-space: nowrap;
    }
    .nmd-ink-toolbar button.active {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
    }
    .nmd-ink-swatch {
      width: 16px;
      height: 16px;
      padding: 0;
      border-radius: 50%;
      border: 2px solid var(--vscode-widget-border, #666) !important;
    }
    .nmd-ink-swatch.active {
      border-color: var(--vscode-focusBorder, #007fd4) !important;
    }
    .nmd-ink-picker-wrap {
      box-sizing: border-box;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      overflow: hidden;
      border: 2px solid var(--vscode-widget-border, #666);
      cursor: pointer;
      flex: 0 0 auto;
    }
    .nmd-ink-picker-wrap.active {
      border-color: var(--vscode-focusBorder, #007fd4);
    }
    .nmd-ink-picker-wrap input {
      display: block;
      width: 32px;
      height: 32px;
      margin: -8px;
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
    }
    .nmd-ink-slider {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--vscode-foreground);
      white-space: nowrap;
    }
    .nmd-ink-slider input {
      width: 72px;
    }
    .nmd-ink-slider.disabled {
      opacity: 0.45;
      pointer-events: none;
    }
    .nmd-ink-stage {
      position: relative;
      touch-action: none;
      outline: none;
    }
    .nmd-ink canvas {
      display: block;
      width: 100%;
      touch-action: none;
      cursor: none;
      outline: none;
    }
    .nmd-ink-cursor {
      position: absolute;
      box-sizing: border-box;
      border: 1px solid #fff;
      box-shadow: 0 0 0 1px #000;
      border-radius: 50%;
      pointer-events: none;
      transform: translate(-50%, -50%);
      display: none;
    }
    .nmd-ink-resize {
      height: 10px;
      cursor: ns-resize;
      background: var(--vscode-widget-border, #444);
      touch-action: none;
    }
    .nmd-ink-resize:hover {
      background: var(--vscode-focusBorder, #007fd4);
    }
    .nmd-ink-error,
    .nmd-ink-fallback {
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      border-radius: 6px;
      background: var(--vscode-editor-background, transparent);
      padding: 8px 10px;
      color: var(--vscode-foreground);
    }
    .nmd-ink-error pre,
    .nmd-ink-fallback pre {
      margin: 6px 0 0;
      font-size: 12px;
      white-space: pre-wrap;
      color: var(--vscode-descriptionForeground, #aaa);
    }
    .nmd-ink-fallback-banner {
      font-size: 12px;
      color: var(--vscode-inputValidation-warningForeground, #cca700);
    }
    .nmd-ink-fallback-canvas {
      display: block;
      width: 100%;
      margin-top: 8px;
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 4px;
    }
  `;
  return style;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function translateStroke(stroke: NmdStroke, dx: number, dy: number): NmdStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({
      ...point,
      x: clamp01(point.x + dx),
      y: clamp01(point.y + dy),
    })),
  };
}

function hitTestStroke(stroke: NmdStroke, nx: number, ny: number, width: number, height: number): boolean {
  if (stroke.points.length === 0) {
    return false;
  }
  const px = nx * width;
  const py = ny * height;
  const hitRadius = Math.max(stroke.width / 2, 4) + 8;
  const first = stroke.points[0];
  if (Math.hypot(px - first.x * width, py - first.y * height) <= hitRadius) {
    return true;
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    const from = stroke.points[index - 1];
    const to = stroke.points[index];
    if (
      distanceToSegment(px, py, from.x * width, from.y * height, to.x * width, to.y * height) <= hitRadius
    ) {
      return true;
    }
  }
  return false;
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

function strokeBounds(
  stroke: NmdStroke,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | undefined {
  if (stroke.points.length === 0) {
    return undefined;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of stroke.points) {
    const radius = stampRadius(stroke.width, pointPressure(point));
    const x = point.x * width;
    const y = point.y * height;
    minX = Math.min(minX, x - radius);
    minY = Math.min(minY, y - radius);
    maxX = Math.max(maxX, x + radius);
    maxY = Math.max(maxY, y + radius);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function normalizeRect(a: NmdPoint, b: NmdPoint): NormalizedRect {
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
  };
}

function rectsIntersect(
  rect: NormalizedRect,
  bounds: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): boolean {
  const bx1 = bounds.x / width;
  const by1 = bounds.y / height;
  const bx2 = (bounds.x + bounds.w) / width;
  const by2 = (bounds.y + bounds.h) / height;
  return !(rect.x2 < bx1 || rect.x1 > bx2 || rect.y2 < by1 || rect.y1 > by2);
}

function findStrokesInRectStatic(
  strokes: NmdStroke[],
  rect: NormalizedRect,
  width: number,
  height: number,
): Set<number> {
  const found = new Set<number>();
  for (let index = 0; index < strokes.length; index += 1) {
    const bounds = strokeBounds(strokes[index], width, height);
    if (bounds && rectsIntersect(rect, bounds, width, height)) {
      found.add(index);
    }
  }
  return found;
}

function unionBounds(
  indices: ReadonlySet<number>,
  strokes: NmdStroke[],
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const index of indices) {
    const bounds = strokeBounds(strokes[index], width, height);
    if (!bounds) {
      continue;
    }
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }
  if (!Number.isFinite(minX)) {
    return undefined;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function drawBoundsBox(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  color: string,
  padding: number,
  dashed: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(dashed ? [4, 4] : []);
  ctx.strokeRect(bounds.x - padding, bounds.y - padding, bounds.w + padding * 2, bounds.h + padding * 2);
  ctx.restore();
}

function drawStrokeHighlight(
  ctx: CanvasRenderingContext2D,
  stroke: NmdStroke,
  width: number,
  height: number,
  color: string,
  alpha = 0.22,
): void {
  const bounds = strokeBounds(stroke, width, height);
  if (!bounds) {
    return;
  }
  const padding = 4;
  ctx.save();
  ctx.fillStyle = withAlpha(color, alpha);
  ctx.fillRect(bounds.x - padding, bounds.y - padding, bounds.w + padding * 2, bounds.h + padding * 2);
  ctx.strokeStyle = withAlpha(color, Math.min(1, alpha + 0.35));
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(bounds.x - padding, bounds.y - padding, bounds.w + padding * 2, bounds.h + padding * 2);
  ctx.restore();
}

function drawMarquee(
  ctx: CanvasRenderingContext2D,
  rect: NormalizedRect,
  width: number,
  height: number,
  color: string,
): void {
  const x = rect.x1 * width;
  const y = rect.y1 * height;
  const w = (rect.x2 - rect.x1) * width;
  const h = (rect.y2 - rect.y1) * height;
  ctx.save();
  ctx.fillStyle = withAlpha(color, 0.12);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(0, 127, 212, ${alpha})`;
}
