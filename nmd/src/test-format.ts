import { parseInkSource, parseNotebook, remapInkStrokesY, stringifyNotebook } from "./format";
import { emptyInkSource, type NmdNotebook } from "./types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const sample: NmdNotebook = {
  nbformat: 1,
  nbformat_minor: 0,
  metadata: {
    nmd: {
      version: "0.1.0",
    },
  },
  cells: [
    {
      id: "hello-md",
      type: "markdown",
      source: "Inline $E=mc^2$\n\n$$\\int_0^1 x^2\\,dx$$",
    },
    {
      id: "hello-ink",
      type: "ink",
      source: {
        aspect: 1.6,
        strokes: [
          {
            tool: "pen",
            color: "#ffffff",
            width: 2,
            points: [
              { x: 0.1, y: 0.2 },
              { x: 0.3, y: 0.4 },
            ],
          },
        ],
      },
    },
    {
      id: "hello-py",
      type: "python",
      source: "x = 2 + 2\nx",
    },
  ],
};

const roundTrip = parseNotebook(stringifyNotebook(sample));
assert(roundTrip.cells.length === 3, "expected three cells");
assert(roundTrip.cells[0]?.type === "markdown", "first cell should stay markdown");
assert(roundTrip.cells[0]?.id === "hello-md", "markdown id should be stable");
assert(roundTrip.cells[0]?.type === "markdown" && roundTrip.cells[0].source.includes("$E=mc^2$"), "math source should survive");
const roundTripInk = roundTrip.cells[1];
assert(roundTripInk?.type === "ink", "second cell should stay ink");
assert(roundTripInk?.type === "ink" && roundTripInk.id === "hello-ink", "ink id should be stable");
assert(roundTripInk?.type === "ink" && roundTripInk.source.strokes.length === 1, "ink strokes should round-trip");
assert(roundTripInk?.type === "ink" && roundTripInk.source.aspect === 1.6, "ink aspect should round-trip");
const roundTripPy = roundTrip.cells[2];
assert(roundTripPy?.type === "python", "third cell should be python");
assert(roundTripPy?.type === "python" && roundTripPy.source.includes("x = 2 + 2"), "python source should round-trip");

const emptyFile = parseNotebook(new Uint8Array());
assert(emptyFile.cells[0]?.type === "markdown", "empty files become one markdown cell");

const recoveredInk = parseInkSource("not json");
assert(recoveredInk.aspect === emptyInkSource().aspect, "invalid ink JSON should fall back");
assert(recoveredInk.strokes.length === 0, "invalid ink JSON should have no strokes");

const outOfRange = parseInkSource(
  JSON.stringify({
    aspect: 2,
    strokes: [{ tool: "pen", color: "#fff", width: 2, points: [{ x: 1.5, y: -0.2 }] }],
  }),
);
assert(outOfRange.strokes[0]?.points[0]?.x === 1, "x should clamp to 1");
assert(outOfRange.strokes[0]?.points[0]?.y === 0, "y should clamp to 0");

const tall = parseInkSource(JSON.stringify({ aspect: 0.01, strokes: [] }));
assert(tall.aspect === 0.25, "too-tall aspect should clamp");

const remapped = remapInkStrokesY(
  [{ tool: "pen", color: "#fff", width: 2, points: [{ x: 0.2, y: 1 }] }],
  0.5,
);
assert(remapped[0]?.points[0]?.y === 0.5, "height remap should keep ink at the same pixels");

console.log("format tests passed");

