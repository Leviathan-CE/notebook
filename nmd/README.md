# NMD Notebook

A Cursor / VS Code extension for `.imd` notebooks with:

- **Markdown** cells (including LaTeX)
- **Python** cells
- **Ink** cells (pen, eraser, marquee select, move strokes)

Notebooks are plain JSON files with the `.imd` extension.

## Requirements

- [Node.js](https://nodejs.org/) 18+ (for building the extension)
- [Cursor](https://cursor.com/) or [VS Code](https://code.visualstudio.com/) 1.85+
- **Python** on your PATH for code cells (`python`, `py`, or the Python extension interpreter)

Optional but recommended:

- [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) for completions and interpreter selection

## Install the extension

All commands below are run from the `nmd` folder.

### Option A — install script (recommended)

This compiles the extension, packages a `.vsix`, and installs it into Cursor (or VS Code if `cursor` is not on your PATH).

```bash
cd nmd
bash install.sh
```

Or:

```bash
cd nmd
npm run install-extension
```

After it finishes, reload the editor:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Developer: Reload Window**

### Option B — manual install

```bash
cd nmd
npm install
npm run compile
npx @vscode/vsce package --no-dependencies --allow-missing-repository --no-rewrite-relative-links
```

Then install the generated file `nmd-0.1.0.vsix`:

- **Command Palette** → **Extensions: Install from VSIX…** → pick `nmd-0.1.0.vsix`

Or from a terminal:

```bash
cursor --install-extension nmd-0.1.0.vsix --force
```

Use `code` instead of `cursor` if you are on VS Code.

Reload the window when prompted.

## Develop without installing

Use this while you are changing the extension code.

1. Open the **`nmd`** folder in Cursor (not the parent repo root).
2. Run **Terminal → Run Build Task** once, or `npm run compile`.
3. Press **F5** (or **Run → Start Debugging → Run Extension**).

A second **Extension Development Host** window opens with NMD loaded and the `examples` folder open.

Changes to TypeScript require recompiling (`npm run compile`) or using the watch task before they appear in the debug window.

## Getting started

1. **New notebook:** Command Palette → **NMD: New Notebook**
2. **Open existing:** open any `.imd` file (for example `examples/hello.imd`)
3. **Add cells:** use the top-row **Code**, **Markdown**, and **Add Ink** buttons

### Ink cells

- **Pen / Eraser** — draw on the canvas
- **Select** — drag a box to select strokes; drag inside the selection to move them together
- **Shift + click** — add or remove a stroke from the selection
- **Ctrl+Z / Cmd+Z** — undo the last ink stroke (while the ink canvas is focused)

### Python cells

Run a cell with the notebook run control. To restart the kernel:

- Command Palette → **NMD: Restart Python Kernel**

### Export to PDF

Export the open notebook (including unsaved edits) as a PDF:

- Command Palette → **NMD: Export to PDF**
- Or click **Export to PDF** on the notebook toolbar

Pick a save location. The export uses headless **Chrome** or **Edge** on your machine to print a generated HTML version of the notebook (markdown with LaTeX, Python output, and ink drawings).

**Requirements for PDF export**

- Google Chrome or Microsoft Edge installed
- Network access on first export (loads KaTeX/Marked from CDN for math and markdown rendering)

If no browser is found, the extension saves an `.html` file next to your chosen PDF path instead. Open that file in a browser and use **Print → Save as PDF**.

## Settings

| Setting | Description |
|--------|-------------|
| `nmd.pythonPath` | Python executable for notebook cells. Leave empty to use the Python extension interpreter, then `python3` / `py` on PATH. |

## Troubleshooting

**Extension does not appear after install**

- Run **Developer: Reload Window**
- Confirm the VSIX installed: Extensions view → search `@installed nmd`

**`.imd` opens as raw JSON**

- The extension is not active. Reinstall and reload.

**Ink cell shows an error or read-only preview**

- Rebuild and reinstall: `bash install.sh`
- Reload the window

**`bash install.sh` fails on Windows**

- Use Git Bash or WSL, or run the manual steps in Option B from a shell that has `npm` and `cursor` on PATH.

**Python cells fail**

- Set `nmd.pythonPath` to your Python executable
- Ensure Python is installed and on PATH

## Project layout

```
nmd/
  src/           TypeScript source
  out/           Compiled extension (generated)
  examples/      Sample .imd notebooks
  resources/     Python REPL used by code cells
  install.sh     Build + install script
```

## License

See the `LICENSE` file in this folder.
