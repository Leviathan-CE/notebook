import * as vscode from "vscode";
import { insertInkCell, registerInkRuntime } from "./controller";
import { exportActiveNotebookToPdf } from "./export-pdf/export-notebook.js";
import { emptyNotebook } from "./format";
import { resolveNmdEditor } from "./resolve-nmd-editor.js";
import { NmdSerializer, toNotebookCell } from "./serializer";
import { NMD_NOTEBOOK_TYPE } from "./types";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(NMD_NOTEBOOK_TYPE, new NmdSerializer(), {
      transientOutputs: true,
    }),
    vscode.commands.registerCommand("nmd.newNotebook", async () => {
      const notebook = emptyNotebook();
      const data = new vscode.NotebookData(notebook.cells.map(toNotebookCell));
      data.metadata = notebook.metadata;
      const document = await vscode.workspace.openNotebookDocument(NMD_NOTEBOOK_TYPE, data);
      await vscode.window.showNotebookDocument(document);
    }),
    vscode.commands.registerCommand("nmd.insertInkCell", async () => {
      const editor = await requireNmdEditor();
      if (editor) {
        await insertInkCell(editor);
      }
    }),
    vscode.commands.registerCommand("nmd.insertInkCellAtTop", async () => {
      const editor = await requireNmdEditor();
      if (editor) {
        await insertInkCell(editor, 0);
      }
    }),
    vscode.commands.registerCommand("nmd.insertInkCellInline", async () => {
      const editor = await requireNmdEditor();
      if (editor) {
        await insertInkCell(editor);
      }
    }),
    vscode.commands.registerCommand("nmd.exportPdf", async () => {
      try {
        await exportActiveNotebookToPdf();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`PDF export failed: ${message}`);
      }
    }),
  );

  registerInkRuntime(context);
}

async function requireNmdEditor(): Promise<vscode.NotebookEditor | undefined> {
  const editor = await resolveNmdEditor(true);
  if (!editor) {
    await vscode.window.showWarningMessage("Open an NMD notebook first.");
  }
  return editor;
}

export function deactivate(): void {
  // Nothing to dispose beyond subscriptions.
}
