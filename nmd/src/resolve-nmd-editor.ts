import * as vscode from "vscode";
import { NMD_NOTEBOOK_TYPE } from "./types.js";

export async function resolveNmdEditor(focus = true): Promise<vscode.NotebookEditor | undefined> {
  let editor = pickNmdEditor();
  if (!editor) {
    editor = await openVisibleNmdNotebook();
  }
  if (!editor) {
    return undefined;
  }

  if (!focus) {
    return editor;
  }

  if (vscode.window.activeNotebookEditor?.notebook.uri.toString() !== editor.notebook.uri.toString()) {
    return vscode.window.showNotebookDocument(editor.notebook);
  }

  return editor;
}

function pickNmdEditor(): vscode.NotebookEditor | undefined {
  const active = vscode.window.activeNotebookEditor;
  if (active?.notebook.notebookType === NMD_NOTEBOOK_TYPE) {
    return active;
  }

  const visible = vscode.window.visibleNotebookEditors.filter(
    (candidate) => candidate.notebook.notebookType === NMD_NOTEBOOK_TYPE,
  );
  if (visible.length === 1) {
    return visible[0];
  }
  if (active && visible.length > 0) {
    const match = visible.find((candidate) => candidate.notebook.uri.toString() === active.notebook.uri.toString());
    if (match) {
      return match;
    }
  }
  return visible[0];
}

async function openVisibleNmdNotebook(): Promise<vscode.NotebookEditor | undefined> {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.fsPath.toLowerCase().endsWith(".nmd")) {
    const existing = vscode.workspace.notebookDocuments.find(
      (document) =>
        document.notebookType === NMD_NOTEBOOK_TYPE && document.uri.toString() === activeUri.toString(),
    );
    if (existing) {
      return vscode.window.showNotebookDocument(existing);
    }
    const document = await vscode.workspace.openNotebookDocument(activeUri);
    if (document.notebookType === NMD_NOTEBOOK_TYPE) {
      return vscode.window.showNotebookDocument(document);
    }
  }

  const document = vscode.workspace.notebookDocuments.find((candidate) => candidate.notebookType === NMD_NOTEBOOK_TYPE);
  if (!document) {
    return undefined;
  }
  return vscode.window.showNotebookDocument(document);
}
