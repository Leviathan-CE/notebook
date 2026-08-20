import * as path from "path";
import * as vscode from "vscode";
import { registerPythonCompletions } from "./completions";
import { PythonSession } from "./python-session";
import { inkMetadata, inkOutput, inkSourceFromCell, pythonMetadata, pythonOutputs } from "./serializer";
import {
  emptyInkSource,
  isInkUpdateMessage,
  NMD_INK_CELL_STUB,
  NMD_INK_LANGUAGE,
  NMD_INK_RENDERER_ID,
  NMD_NOTEBOOK_TYPE,
  NMD_PYTHON_LANGUAGE,
  type NmdCellMetadata,
  type NmdInkSource,
  type NmdPythonOutput,
} from "./types";

const sessions = new Map<string, PythonSession>();

export function registerInkRuntime(context: vscode.ExtensionContext): vscode.NotebookController {
  const controller = vscode.notebooks.createNotebookController("nmd-ink-controller", NMD_NOTEBOOK_TYPE, "NMD");
  controller.supportedLanguages = [NMD_PYTHON_LANGUAGE, NMD_INK_LANGUAGE];
  controller.supportsExecutionOrder = true;
  controller.executeHandler = async (cells, notebook) => {
    for (const cell of cells) {
      if (cell.document.languageId === NMD_INK_LANGUAGE) {
        await renderInkOutput(controller, cell);
      } else if (cell.document.languageId === NMD_PYTHON_LANGUAGE) {
        await executePythonCell(context, controller, notebook, cell);
      }
    }
  };

  const messaging = vscode.notebooks.createRendererMessaging(NMD_INK_RENDERER_ID);

  context.subscriptions.push(
    controller,
    messaging.onDidReceiveMessage(async (event) => {
      if (!isInkUpdateMessage(event.message)) {
        return;
      }
      await persistInkUpdate(controller, event.editor.notebook, event.message.cellId, event.message.source);
    }),
    vscode.commands.registerCommand("nmd.undoInk", async () => {
      const editor = vscode.window.activeNotebookEditor;
      if (!editor || editor.notebook.notebookType !== NMD_NOTEBOOK_TYPE) {
        return;
      }
      const cell = editor.notebook.cellAt(editor.selection.start);
      if (cell.document.languageId !== NMD_INK_LANGUAGE) {
        return;
      }
      const cellId = cellNmdId(cell);
      if (!cellId) {
        return;
      }
      await messaging.postMessage({ type: "ink-undo", cellId }, editor);
    }),
    registerPythonCompletions((notebook) => sessionFor(context, notebook)),
    vscode.commands.registerCommand("nmd.restartPython", async () => {
      const editor = vscode.window.activeNotebookEditor;
      if (!editor || editor.notebook.notebookType !== NMD_NOTEBOOK_TYPE) {
        return;
      }
      disposeSession(editor.notebook.uri.toString());
      await vscode.window.showInformationMessage("NMD Python kernel restarted.");
    }),
    vscode.workspace.onDidCloseNotebookDocument((notebook) => {
      if (notebook.notebookType === NMD_NOTEBOOK_TYPE) {
        disposeSession(notebook.uri.toString());
      }
    }),
    vscode.workspace.onDidChangeNotebookDocument(async (event) => {
      if (event.notebook.notebookType !== NMD_NOTEBOOK_TYPE) {
        return;
      }
      for (const change of event.contentChanges) {
        for (const cell of change.addedCells) {
          if (cell.kind !== vscode.NotebookCellKind.Code) {
            continue;
          }
          if (cell.document.languageId === NMD_INK_LANGUAGE) {
            await ensureInkCell(controller, cell);
            continue;
          }
          if (cell.document.languageId !== NMD_PYTHON_LANGUAGE) {
            await vscode.languages.setTextDocumentLanguage(cell.document, NMD_PYTHON_LANGUAGE);
          }
          await ensurePythonCell(cell);
        }
      }
    }),
    new vscode.Disposable(() => {
      for (const key of [...sessions.keys()]) {
        disposeSession(key);
      }
    }),
  );

  return controller;
}

export async function insertInkCell(editor: vscode.NotebookEditor, index?: number): Promise<void> {
  const cellId = crypto.randomUUID();
  const source = emptyInkSource();
  const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, NMD_INK_CELL_STUB, NMD_INK_LANGUAGE);
  cell.metadata = inkMetadata(cellId, source);
  cell.outputs = [inkOutput(cellId, source)];

  const insertAt =
    index ??
    (editor.selection.start === editor.selection.end
      ? Math.min(editor.selection.end + 1, editor.notebook.cellCount)
      : editor.selection.end);

  const edit = new vscode.WorkspaceEdit();
  edit.set(editor.notebook.uri, [vscode.NotebookEdit.insertCells(insertAt, [cell])]);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied || insertAt >= editor.notebook.cellCount) {
    return;
  }

  const range = new vscode.NotebookRange(insertAt, insertAt + 1);
  editor.selection = range;
  editor.revealRange(range, vscode.NotebookEditorRevealType.Default);

  // Execute so the custom renderer actually mounts, then hide the empty source editor.
  await vscode.commands.executeCommand("notebook.cell.execute", {
    ranges: [{ start: insertAt, end: insertAt + 1 }],
    document: editor.notebook.uri,
  });
  await vscode.commands.executeCommand("notebook.cell.collapseCellInput", {
    ranges: [{ start: insertAt, end: insertAt + 1 }],
    document: editor.notebook.uri,
  });
}

async function persistInkUpdate(
  _controller: vscode.NotebookController,
  notebook: vscode.NotebookDocument,
  cellId: string,
  source: NmdInkSource,
): Promise<void> {
  const cell = notebook.getCells().find((candidate) => cellNmdId(candidate) === cellId);
  if (!cell) {
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.set(notebook.uri, [vscode.NotebookEdit.updateCellMetadata(cell.index, inkMetadata(cellId, source))]);
  await vscode.workspace.applyEdit(edit);
}

async function ensureInkCell(controller: vscode.NotebookController, cell: vscode.NotebookCell): Promise<void> {
  const cellId = cellNmdId(cell) ?? crypto.randomUUID();
  const source = inkSourceFromCell(cell);
  if (!cellNmdId(cell) || !cell.metadata?.inputCollapsed) {
    const edit = new vscode.WorkspaceEdit();
    edit.set(cell.notebook.uri, [vscode.NotebookEdit.updateCellMetadata(cell.index, inkMetadata(cellId, source))]);
    await vscode.workspace.applyEdit(edit);
  }

  await renderInkOutput(controller, cell, cellId, source);
}

async function renderInkOutput(
  controller: vscode.NotebookController,
  cell: vscode.NotebookCell,
  cellId = cellNmdId(cell) ?? crypto.randomUUID(),
  source = inkSourceFromCell(cell),
): Promise<void> {
  if (cell.document.languageId !== NMD_INK_LANGUAGE) {
    return;
  }

  const execution = controller.createNotebookCellExecution(cell);
  execution.start(Date.now());
  await execution.replaceOutput([inkOutput(cellId, source)]);
  execution.end(true);
}

async function ensurePythonCell(cell: vscode.NotebookCell): Promise<void> {
  const metadata = cell.metadata as NmdCellMetadata | undefined;
  if (metadata?.nmd?.id && metadata.nmd.type === "python") {
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.set(cell.notebook.uri, [
    vscode.NotebookEdit.updateCellMetadata(cell.index, pythonMetadata(metadata?.nmd?.id ?? crypto.randomUUID(), metadata?.nmd?.pythonOutput)),
  ]);
  await vscode.workspace.applyEdit(edit);
}

async function executePythonCell(
  context: vscode.ExtensionContext,
  controller: vscode.NotebookController,
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
): Promise<void> {
  const execution = controller.createNotebookCellExecution(cell);
  execution.start(Date.now());
  try {
    const session = sessionFor(context, notebook);
    const result = await session.run(cell.document.getText(), execution.token);
    const output: NmdPythonOutput = {
      stdout: result.stdout || undefined,
      stderr: result.stderr || undefined,
      result: result.result || undefined,
      error: result.error || undefined,
      images: result.images && result.images.length > 0 ? result.images : undefined,
    };
    const cellId = cellNmdId(cell) ?? crypto.randomUUID();
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [vscode.NotebookEdit.updateCellMetadata(cell.index, pythonMetadata(cellId, output))]);
    await vscode.workspace.applyEdit(edit);
    await execution.replaceOutput(pythonOutputs(output));
    execution.end(result.ok);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await execution.replaceOutput(pythonOutputs({ error: message }));
    execution.end(false);
  }
}

function sessionFor(context: vscode.ExtensionContext, notebook: vscode.NotebookDocument): PythonSession {
  const key = notebook.uri.toString();
  const existing = sessions.get(key);
  if (existing) {
    return existing;
  }
  const cwd = notebook.uri.scheme === "file" ? path.dirname(notebook.uri.fsPath) : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  const session = new PythonSession(context.asAbsolutePath("resources/repl.py"), cwd);
  sessions.set(key, session);
  return session;
}

function disposeSession(key: string): void {
  sessions.get(key)?.dispose();
  sessions.delete(key);
}

function cellNmdId(cell: vscode.NotebookCell): string | undefined {
  const metadata = cell.metadata as NmdCellMetadata | undefined;
  return metadata?.nmd?.id;
}
