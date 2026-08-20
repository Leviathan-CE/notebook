#!/usr/bin/env bash
# Compile, package, and install the NMD extension into Cursor (falls back to VS Code).
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Installing npm dependencies"
npm install


echo "==> Compiling TypeScript + bundling the ink renderer"
npm run compile

echo "==> Packaging .vsix"
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository --no-rewrite-relative-links

NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
VSIX="${NAME}-${VERSION}.vsix"

if [[ ! -f "$VSIX" ]]; then
  echo "Expected $VSIX but it was not created." >&2
  exit 1
fi

install_vsix() {
  local cli="$1"
  echo "==> Installing $VSIX with $cli"
  "$cli" --install-extension "$VSIX" --force
}

if command -v cursor >/dev/null 2>&1; then
  install_vsix cursor
elif command -v code >/dev/null 2>&1; then
  echo "cursor CLI not found; installing into VS Code instead"
  install_vsix code
else
  echo "Neither cursor nor code is on PATH." >&2
  echo "Install from the Command Palette: Extensions: Install from VSIX…" >&2
  echo "File: $(pwd)/$VSIX" >&2
  exit 1
fi

echo "==> Done. Reload the window (Ctrl+Shift+P → Developer: Reload Window) if NMD is already loaded."
echo "    Then open a .imd file or run: NMD: New Notebook"
