#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Uninstalling pi-turbo..."

# Remove global bin symlink (primary `pi-tb` + legacy `pi-opt`)
NPM_BIN=$(npm prefix -g 2>/dev/null)/bin
rm -f "$NPM_BIN/pi-tb"
echo "✓ Removed global 'pi-tb' command"
if [ -L "$NPM_BIN/pi-opt" ] || [ -f "$NPM_BIN/pi-opt" ]; then
	rm -f "$NPM_BIN/pi-opt"
	echo "✓ Removed legacy 'pi-opt' command"
fi

# Remove node_modules symlink
rm -rf "$SCRIPT_DIR/node_modules"
echo "✓ Removed node_modules symlink"

# Optionally remove timing data (~/.pi-turbo, plus legacy ~/.pi-opt if it still exists)
for DATA_DIR in "$HOME/.pi-turbo" "$HOME/.pi-opt"; do
	if [ -d "$DATA_DIR" ]; then
		if [ -t 0 ]; then
			read -p "Remove timing data ($DATA_DIR)? [y/N] " -n 1 -r
			echo
		else
			REPLY=n
		fi
		if [[ $REPLY =~ ^[Yy]$ ]]; then
			rm -rf "$DATA_DIR"
			echo "✓ Removed $DATA_DIR"
		else
			echo "  Kept $DATA_DIR"
		fi
	fi
done

echo ""
echo "Done. pi is unaffected — just use 'pi' as before."
