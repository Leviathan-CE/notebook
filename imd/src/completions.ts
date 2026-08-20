import * as vscode from "vscode";
import type { PythonSession } from "./python-session";
import { NMD_NOTEBOOK_TYPE, NMD_PYTHON_LANGUAGE } from "./types";

export function registerPythonCompletions(
  sessionFor: (notebook: vscode.NotebookDocument) => PythonSession,
): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    [
      { language: NMD_PYTHON_LANGUAGE, notebookType: NMD_NOTEBOOK_TYPE },
      { scheme: "vscode-notebook-cell", language: NMD_PYTHON_LANGUAGE },
    ],
    {
      async provideCompletionItems(document, position, token) {
        const notebook = notebookForCell(document);
        if (!notebook) {
          return undefined;
        }

        try {
          const completions = await sessionFor(notebook).complete(
            document.getText(),
            position.line + 1,
            position.character,
            token,
          );
          return completions.map((item, index) => toCompletionItem(item, index));
        } catch {
          return undefined;
        }
      },
    },
    ".",
  );
}

function notebookForCell(document: vscode.TextDocument): vscode.NotebookDocument | undefined {
  return vscode.workspace.notebookDocuments.find(
    (notebook) =>
      notebook.notebookType === NMD_NOTEBOOK_TYPE &&
      notebook.getCells().some((cell) => cell.document.uri.toString() === document.uri.toString()),
  );
}

function toCompletionItem(
  item: { label: string; kind?: string; detail?: string },
  index: number,
): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(item.label, kindFromJedi(item.kind));
  completion.detail = item.detail;
  completion.sortText = String(index).padStart(4, "0");
  return completion;
}

function kindFromJedi(type: string | undefined): vscode.CompletionItemKind {
  switch (type) {
    case "module":
      return vscode.CompletionItemKind.Module;
    case "class":
      return vscode.CompletionItemKind.Class;
    case "function":
      return vscode.CompletionItemKind.Function;
    case "instance":
      return vscode.CompletionItemKind.Variable;
    case "keyword":
      return vscode.CompletionItemKind.Keyword;
    case "param":
      return vscode.CompletionItemKind.Variable;
    case "path":
      return vscode.CompletionItemKind.File;
    case "property":
      return vscode.CompletionItemKind.Property;
    case "statement":
      return vscode.CompletionItemKind.Variable;
    default:
      return vscode.CompletionItemKind.Text;
  }
}
