import * as vscode from "vscode";
import { insertInkCell, registerInkRuntime } from "./controller";
import { emptyNotebook } from "./format";
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
      const editor = vscode.window.activeNotebookEditor;
      if (!editor || editor.notebook.notebookType !== NMD_NOTEBOOK_TYPE) {
        await vscode.window.showWarningMessage("Open an NMD notebook first.");
        return;
      }
      await insertInkCell(editor);
    }),
  );

  registerInkRuntime(context);
}

export function deactivate(): void {
  // Nothing to dispose beyond subscriptions.
}
