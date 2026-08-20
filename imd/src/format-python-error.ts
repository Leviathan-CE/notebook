import type { NmdPythonOutput } from "./types";

const WARNING_COLOR = "var(--vscode-editorWarning-foreground, #cca700)";
const EXCEPTION_LINE = /^([A-Z_][A-Za-z0-9_]*(?:Error|Exception))(:?\s*)(.*)$/;
const WARNING_LINE = /^(.+?:\d+: )?([A-Z][A-Za-z0-9_]*Warning)(:\s?)(.*)$/;
const FILE_LINE = /^(\s*File ")([^"]+)(".*)$/;
const CARET_LINE = /^\s+\^+/;

export function colorizeStderrAnsi(text: string): string {
  const ORANGE = "\u001b[38;5;214m";
  const RESET = "\u001b[0m";
  const body = text.trimEnd();
  return body.length > 0 ? `${ORANGE}${body}${RESET}\n` : "";
}

export function isWarningRepr(text: string): boolean {
  return /Warning\s*\(/.test(text.trim());
}

export function formatPythonStderrHtml(text: string): string {
  const body = text
    .trimEnd()
    .split("\n")
    .map((line) => styleStderrLine(line))
    .join("\n");
  return wrap(body);
}

function styleStderrLine(line: string): string {
  const warningMatch = line.match(WARNING_LINE);
  if (warningMatch) {
    const [, location, category, sep, message] = warningMatch;
    const prefix = location ? span(location, WARNING_COLOR) : "";
    const categoryHtml = `<span style="color:${WARNING_COLOR};font-weight:600;">${escapeHtml(category ?? "")}</span>`;
    const rest = `${escapeHtml(sep ?? "")}${escapeHtml(message ?? "")}`;
    return `${prefix}${categoryHtml}${rest}`;
  }

  return span(line, WARNING_COLOR);
}

export function formatPythonTracebackHtml(output: Pick<NmdPythonOutput, "error" | "errorName" | "errorMessage">): string {
  const text = output.error?.trimEnd() ?? "";
  if (!text) {
    const name = escapeHtml(output.errorName || "Error");
    const message = escapeHtml(output.errorMessage || "");
    return wrap(`<span style="color:var(--vscode-errorForeground);font-weight:600;">${name}</span>${message ? `: ${message}` : ""}`);
  }

  const lines = text.split("\n").map((line) => styleTracebackLine(line)).join("\n");
  return wrap(lines);
}

function styleTracebackLine(line: string): string {
  if (line.startsWith("Traceback")) {
    return span(line, "var(--vscode-errorForeground)");
  }

  const fileMatch = line.match(FILE_LINE);
  if (fileMatch) {
    const [, prefix, path, suffix] = fileMatch;
    return `${escapeHtml(prefix ?? "")}<span style="color:var(--vscode-textLink-foreground);">${escapeHtml(path ?? "")}</span>${escapeHtml(suffix ?? "")}`;
  }

  if (CARET_LINE.test(line)) {
    return span(line, "var(--vscode-errorForeground)");
  }

  const exceptionMatch = line.match(EXCEPTION_LINE);
  if (exceptionMatch) {
    const [, name, sep, rest] = exceptionMatch;
    return `<span style="color:var(--vscode-errorForeground);font-weight:600;">${escapeHtml(name ?? "")}${escapeHtml(sep ?? "")}${escapeHtml(rest ?? "")}</span>`;
  }

  if (/^\s{4}\S/.test(line)) {
    return span(line, "var(--vscode-editor-foreground)");
  }

  return escapeHtml(line);
}

function span(text: string, color: string): string {
  return `<span style="color:${color};">${escapeHtml(text)}</span>`;
}

function wrap(body: string): string {
  return `<div style="font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.45;white-space:pre-wrap;word-break:break-word;margin:0;padding:0;">${body}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
