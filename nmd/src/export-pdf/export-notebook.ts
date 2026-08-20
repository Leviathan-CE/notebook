import * as path from "path";
import * as vscode from "vscode";
import { exportNotebookToPdf } from "./export-pdf.js";
import { parseNotebook } from "../format.js";
import { resolveNmdEditor } from "../resolve-nmd-editor.js";
import { fromNotebookCell } from "../serializer.js";
import { NMD_VERSION, type NmdNotebook } from "../types.js";

export async function exportActiveNotebookToPdf(): Promise<void> {
  const editor = await resolveNmdEditor(false);
  if (!editor) {
    await vscode.window.showWarningMessage("Open an NMD notebook first.");
    return;
  }

  const notebook = notebookFromDocument(editor.notebook);
  const baseName = path.basename(editor.notebook.uri.fsPath, path.extname(editor.notebook.uri.fsPath));
  const defaultUri = vscode.Uri.file(editor.notebook.uri.fsPath.replace(/\.nmd$/i, ".pdf"));

  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { PDF: ["pdf"] },
    saveLabel: "Export PDF",
  });
  if (!target) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Exporting NMD notebook to PDF…",
      cancellable: false,
    },
    async () => {
      await exportNotebookToPdf(notebook, target.fsPath, baseName || "Notebook");
    },
  );

  const open = await vscode.window.showInformationMessage(
    `Exported PDF to ${path.basename(target.fsPath)}`,
    "Open PDF",
    "Reveal in Explorer",
  );
  if (open === "Open PDF") {
    await vscode.commands.executeCommand("vscode.open", target);
  } else if (open === "Reveal in Explorer") {
    await vscode.commands.executeCommand("revealFileInOS", target);
  }
}

function notebookFromDocument(notebook: vscode.NotebookDocument): NmdNotebook {
  return {
    nbformat: 1,
    nbformat_minor: 0,
    metadata: {
      nmd: {
        version: (notebook.metadata?.nmd?.version as string | undefined) ?? NMD_VERSION,
      },
    },
    cells: notebook.getCells().map((cell) => {
      const data = new vscode.NotebookCellData(cell.kind, cell.document.getText(), cell.document.languageId);
      data.metadata = cell.metadata;
      data.outputs = [...cell.outputs];
      return fromNotebookCell(data);
    }),
  };
}

export async function exportNotebookFileToPdf(uri: vscode.Uri): Promise<void> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const notebook = parseNotebook(bytes);
  const baseName = path.basename(uri.fsPath, path.extname(uri.fsPath));
  const target = vscode.Uri.file(uri.fsPath.replace(/\.nmd$/i, ".pdf"));
  await exportNotebookToPdf(notebook, target.fsPath, baseName || "Notebook");
  await vscode.window.showInformationMessage(`Exported PDF to ${target.fsPath}`);
}
