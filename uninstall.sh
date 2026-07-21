#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Uninstalling pi-opt..."

# Remove global bin symlink
NPM_BIN=$(npm prefix -g 2>/dev/null)/bin
rm -f "$NPM_BIN/pi-opt"
echo "✓ Removed global 'pi-opt' command"

# Remove node_modules symlink
rm -rf "$SCRIPT_DIR/node_modules"
echo "✓ Removed node_modules symlink"

# Optionally remove timing data
if [ -d "$HOME/.pi-opt" ]; then
  if [ -t 0 ]; then
    read -p "Remove timing data (~/.pi-opt)? [y/N] " -n 1 -r
    echo
  else
    REPLY=n
  fi
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$HOME/.pi-opt"
    echo "✓ Removed ~/.pi-opt"
  else
    echo "  Kept ~/.pi-opt"
  fi
fi

echo ""
echo "Done. pi is unaffected — just use 'pi' as before."
