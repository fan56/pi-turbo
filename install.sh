#!/usr/bin/env bash
set -euo pipefail

# Node.js version check (requires >= 22.19.0)
NODE_VERSION=$(node -v 2>/dev/null | sed 's/^v//')
if [ -z "$NODE_VERSION" ]; then
	echo "Error: Node.js not found. pi-turbo requires Node >= 22.19.0"
	exit 1
fi
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
NODE_MINOR=$(echo "$NODE_VERSION" | cut -d. -f2)
NODE_PATCH=$(echo "$NODE_VERSION" | cut -d. -f3)
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
	echo "Error: Node >= 22.19.0 required, found $NODE_VERSION"
	exit 1
fi

# pi-turbo installer
# Creates a global `pi-tb` command via manual symlinks (NO npm link — it deletes global packages!)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_PKG="@earendil-works/pi-coding-agent"

# 1. Find pi's package root directory
PI_DIR=""
NPM_GLOBAL=$(npm root -g 2>/dev/null || true)
if [ -n "$NPM_GLOBAL" ] && [ -d "$NPM_GLOBAL/$PI_PKG" ]; then
	PI_DIR="$NPM_GLOBAL/$PI_PKG"
elif [ -d "/opt/homebrew/lib/node_modules/$PI_PKG" ]; then
	PI_DIR="/opt/homebrew/lib/node_modules/$PI_PKG"
fi
if [ -z "$PI_DIR" ]; then
	echo "Error: pi ($PI_PKG) not found. Install it first: npm i -g $PI_PKG"
	exit 1
fi
# Safety: verify it's a real package
if [ ! -f "$PI_DIR/package.json" ]; then
	echo "Error: $PI_DIR/package.json not found — pi installation is broken"
	exit 1
fi
echo "✓ Found pi at: $PI_DIR"

# 2. Create node_modules symlink (for ESM import resolution)
mkdir -p "$SCRIPT_DIR/node_modules/@earendil-works"
LINK_TARGET="$SCRIPT_DIR/node_modules/$PI_PKG"
if [ -e "$LINK_TARGET" ] || [ -L "$LINK_TARGET" ]; then
	rm "$LINK_TARGET"
fi
ln -s "$PI_DIR" "$LINK_TARGET"
echo "✓ Symlinked: $LINK_TARGET → $PI_DIR"

# 3. Create global bin symlink (NO npm link — it deletes global packages!)
NPM_BIN=$(npm prefix -g 2>/dev/null || true)/bin
if [ "$NPM_BIN" = "/bin" ]; then
	echo "Error: could not determine npm global prefix (npm prefix -g failed)"
	exit 1
fi
mkdir -p "$NPM_BIN"

# Upgrade handling: remove stale `pi-opt` command from the previous name
LEGACY_LINK="$NPM_BIN/pi-opt"
if [ -L "$LEGACY_LINK" ] || [ -f "$LEGACY_LINK" ]; then
	rm -f "$LEGACY_LINK"
	echo "✓ Removed legacy 'pi-opt' command (renamed to 'pi-tb')"
fi

BIN_LINK="$NPM_BIN/pi-tb"
if [ -L "$BIN_LINK" ] || [ -f "$BIN_LINK" ]; then
	rm -f "$BIN_LINK"
fi
ln -s "$SCRIPT_DIR/bin/pi-tb.js" "$BIN_LINK"
chmod +x "$SCRIPT_DIR/bin/pi-tb.js"
echo "✓ Global command: $BIN_LINK → $SCRIPT_DIR/bin/pi-tb.js"

# 4. Migrate timing data from the old ~/.pi-opt directory
OLD_DATA="$HOME/.pi-opt"
NEW_DATA="$HOME/.pi-turbo"
if [ -d "$OLD_DATA" ]; then
	if [ ! -d "$NEW_DATA" ]; then
		mv "$OLD_DATA" "$NEW_DATA"
		echo "✓ Migrated timing data: ~/.pi-opt → ~/.pi-turbo"
	else
		echo "⚠ Both ~/.pi-opt and ~/.pi-turbo exist — keeping both."
		echo "  Remove ~/.pi-opt manually if it is no longer needed."
	fi
fi

# 5. Verify
if command -v pi-tb &>/dev/null; then
	echo ""
	echo "Done! Usage:"
	echo "  pi-tb              # launch pi with optimized extension loading"
	echo "  pi-tb --status     # show timing statistics"
	echo ""
	echo "To revert: rm $BIN_LINK && rm -rf $SCRIPT_DIR/node_modules"
else
	echo ""
	echo "Warning: 'pi-tb' not in PATH. Add npm global bin to PATH:"
	echo "  export PATH=\"$NPM_BIN:\$PATH\""
fi
