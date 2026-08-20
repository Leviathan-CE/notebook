import { inkToSvg } from "./export-ink-svg.js";
import type { NmdCell, NmdNotebook, NmdPythonOutput } from "../types.js";

export function notebookToHtml(notebook: NmdNotebook, title: string): string {
  const cells = notebook.cells.map((cell) => renderCell(cell)).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
  <style>
    :root {
      color-scheme: light dark;
      --bg: #ffffff;
      --fg: #1e1e1e;
      --muted: #666;
      --border: #d4d4d4;
      --code-bg: #f5f5f5;
      --output-bg: #fafafa;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1e1e1e;
        --fg: #d4d4d4;
        --muted: #aaa;
        --border: #444;
        --code-bg: #2d2d2d;
        --output-bg: #252526;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--fg);
      background: var(--bg);
    }
    h1.doc-title {
      margin: 0 0 24px;
      font-size: 28px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }
    section.cell {
      margin: 0 0 28px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .markdown-body :is(h1,h2,h3,h4) { margin: 1.2em 0 0.5em; line-height: 1.25; }
    .markdown-body p { margin: 0.75em 0; }
    .markdown-body ul, .markdown-body ol { margin: 0.75em 0; padding-left: 1.4em; }
    .markdown-body pre, .markdown-body code {
      font-family: Consolas, "Courier New", monospace;
    }
    .markdown-body pre {
      background: var(--code-bg);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
    }
    .markdown-body code {
      background: var(--code-bg);
      padding: 0.1em 0.35em;
      border-radius: 4px;
    }
    .python-source, .python-output {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      white-space: pre-wrap;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
    }
    .python-output {
      background: var(--output-bg);
      margin-top: 8px;
    }
    .python-output.error { color: #c62828; }
    .python-images {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .python-images img {
      max-width: 100%;
      border: 1px solid var(--border);
      border-radius: 4px;
    }
    .ink-wrap {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px;
      background: var(--bg);
    }
  </style>
</head>
<body>
  <h1 class="doc-title">${escapeHtml(title)}</h1>
  ${cells}
  <script src="https://cdn.jsdelivr.net/npm/marked@15.0.6/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
  <script>
    for (const block of document.querySelectorAll("[data-markdown]")) {
      block.innerHTML = marked.parse(block.textContent || "", { breaks: true });
    }
    renderMathInElement(document.body, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\\\[", right: "\\\\]", display: true },
        { left: "\\\\(", right: "\\\\)", display: false }
      ],
      throwOnError: false
    });
  </script>
</body>
</html>`;
}

function renderCell(cell: NmdCell): string {
  if (cell.type === "markdown") {
    return `<section class="cell"><div class="markdown-body" data-markdown>${escapeHtml(cell.source)}</div></section>`;
  }
  if (cell.type === "python") {
    return `<section class="cell">${renderPython(cell.source, cell.outputs)}</section>`;
  }
  return `<section class="cell"><div class="ink-wrap">${inkToSvg(cell.source)}</div></section>`;
}

function renderPython(source: string, output?: NmdPythonOutput): string {
  const parts = [`<pre class="python-source">${escapeHtml(source)}</pre>`];
  if (!output) {
    return parts.join("");
  }
  if (output.stdout) {
    parts.push(`<pre class="python-output">${escapeHtml(output.stdout)}</pre>`);
  }
  if (output.stderr) {
    parts.push(`<pre class="python-output error">${escapeHtml(output.stderr)}</pre>`);
  }
  if (output.result) {
    parts.push(`<pre class="python-output">${escapeHtml(output.result)}</pre>`);
  }
  if (output.error) {
    parts.push(`<pre class="python-output error">${escapeHtml(output.error)}</pre>`);
  }
  if (output.images && output.images.length > 0) {
    const imgs = output.images
      .map((image) => `<img alt="Python plot output" src="data:image/png;base64,${image}" />`)
      .join("");
    parts.push(`<div class="python-images">${imgs}</div>`);
  }
  return parts.join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
