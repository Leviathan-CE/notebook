import * as vscode from "vscode";
import { coerceInkSource, parseInkSource, parseNotebook, stringifyNotebook } from "./format";
import {
  NMD_INK_CELL_STUB,
  NMD_INK_LANGUAGE,
  NMD_INK_MIME,
  NMD_PYTHON_LANGUAGE,
  NMD_VERSION,
  type NmdCell,
  type NmdCellMetadata,
  type NmdInkCell,
  type NmdInkSource,
  type NmdNotebook,
  type NmdPythonCell,
  type NmdPythonOutput,
} from "./types";

export class NmdSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(content: Uint8Array, _token: vscode.CancellationToken): Promise<vscode.NotebookData> {
    const notebook = parseNotebook(content);
    const data = new vscode.NotebookData(notebook.cells.map(toNotebookCell));
    data.metadata = {
      nmd: {
        version: notebook.metadata.nmd.version,
      },
    };
    return data;
  }

  async serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Promise<Uint8Array> {
    const notebook: NmdNotebook = {
      nbformat: 1,
      nbformat_minor: 0,
      metadata: {
        nmd: {
          version: (data.metadata?.nmd?.version as string | undefined) ?? NMD_VERSION,
        },
      },
      cells: data.cells.map(fromNotebookCell),
    };
    return stringifyNotebook(notebook);
  }
}

export function toNotebookCell(cell: NmdCell): vscode.NotebookCellData {
  if (cell.type === "ink") {
    return toInkNotebookCell(cell);
  }
  if (cell.type === "python") {
    return toPythonNotebookCell(cell);
  }

  const data = new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, cell.source, "markdown");
  data.metadata = {
    nmd: {
      id: cell.id,
      type: "markdown",
    },
  } satisfies NmdCellMetadata;
  return data;
}

export function fromNotebookCell(cell: vscode.NotebookCellData): NmdCell {
  const metadata = cell.metadata as NmdCellMetadata | undefined;
  const id = metadata?.nmd?.id ?? crypto.randomUUID();

  if (cell.languageId === NMD_INK_LANGUAGE || metadata?.nmd?.type === "ink") {
    return {
      id,
      type: "ink",
      source: inkSourceFromMetadata(metadata) ?? parseInkSource(cell.value),
    };
  }

  if (cell.kind === vscode.NotebookCellKind.Code) {
    return {
      id,
      type: "python",
      source: cell.value,
      outputs: metadata?.nmd?.pythonOutput,
    };
  }

  return {
    id,
    type: "markdown",
    source: cell.value,
  };
}

export function inkOutput(cellId: string, source: NmdInkCell["source"]): vscode.NotebookCellOutput {
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.json(
      {
        id: cellId,
        ...source,
      },
      NMD_INK_MIME,
    ),
  ]);
}

export function inkMetadata(cellId: string, source: NmdInkSource): NmdCellMetadata {
  return {
    inputCollapsed: true,
    outputCollapsed: false,
    nmd: {
      id: cellId,
      type: "ink",
      source,
    },
  };
}

export function inkSourceFromCell(cell: vscode.NotebookCell | vscode.NotebookCellData): NmdInkSource {
  const metadata = cell.metadata as NmdCellMetadata | undefined;
  return inkSourceFromMetadata(metadata) ?? parseInkSource("document" in cell ? cell.document.getText() : cell.value);
}

function inkSourceFromMetadata(metadata: NmdCellMetadata | undefined): NmdInkSource | undefined {
  if (metadata?.nmd?.type !== "ink" || metadata.nmd.source === undefined) {
    return undefined;
  }
  return coerceInkSource(metadata.nmd.source);
}

function toInkNotebookCell(cell: NmdInkCell): vscode.NotebookCellData {
  const data = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, NMD_INK_CELL_STUB, NMD_INK_LANGUAGE);
  data.metadata = inkMetadata(cell.id, cell.source);
  data.outputs = [inkOutput(cell.id, cell.source)];
  return data;
}

function toPythonNotebookCell(cell: NmdPythonCell): vscode.NotebookCellData {
  const data = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, cell.source, NMD_PYTHON_LANGUAGE);
  data.metadata = pythonMetadata(cell.id, cell.outputs);
  data.outputs = pythonOutputs(cell.outputs);
  return data;
}

export function pythonMetadata(cellId: string, pythonOutput?: NmdPythonOutput): NmdCellMetadata {
  return {
    nmd: {
      id: cellId,
      type: "python",
      pythonOutput,
    },
  };
}

export function pythonOutputs(output?: NmdPythonOutput): vscode.NotebookCellOutput[] {
  if (!output) {
    return [];
  }

  const items: vscode.NotebookCellOutputItem[] = [];
  if (output.stdout) {
    items.push(vscode.NotebookCellOutputItem.stdout(output.stdout));
  }
  if (output.stderr) {
    items.push(vscode.NotebookCellOutputItem.stderr(output.stderr));
  }
  if (output.result) {
    items.push(vscode.NotebookCellOutputItem.text(output.result, "text/plain"));
  }
  if (output.error) {
    items.push(vscode.NotebookCellOutputItem.error({ name: "PythonError", message: output.error }));
  }
  for (const image of output.images ?? []) {
    items.push(new vscode.NotebookCellOutputItem(Buffer.from(image, "base64"), "image/png"));
  }
  return items.length > 0 ? [new vscode.NotebookCellOutput(items)] : [];
}
