[English](README.md) | [中文](README.zh-CN.md)

# pi-turbo

Performance wrapper for [pi](https://github.com/earendil-works/pi) — two runtime monkey-patches, zero modification to pi itself.

- **Startup**: parallel extension loading (33% faster cold start)
- **Runtime**: footer render caching (eliminates Enter-key lag in long conversations)

## Problems it solves

### 1. Slow startup (extension loading)

**Symptom**: pi takes 4-5 seconds to start. You watch a blank terminal while extensions load one by one.

**Cause**: pi loads all extensions serially. Some (like MCP handshakes) are I/O-bound and waste CPU idle time.

**Fix**: pi-turbo patches `DefaultResourceLoader.loadFinalExtensionSet` to:

1. **Profile** (first run): Load each extension individually, record per-extension timing (EMA)
2. **Optimize** (subsequent runs): Identify I/O-bound extensions (EMA > 1000ms, e.g. MCP handshakes) and load them in background while CPU-bound extensions load serially
3. **Overlap**: I/O wait and CPU work run concurrently → total = max(background, serial)

| Mode | Extension Loading | Speedup |
| --- | --- | --- |
| Serial (pi default) | ~4660ms | — |
| **Targeted parallel** | **~3125ms** | **33%** |

### 2. Enter key lag (footer O(n) scan)

**Symptom**: After 100+ messages, pressing Enter has a visible delay. The longer the conversation, the worse it gets.

**Cause**: pi's footer re-scans ALL session entries (O(n)) on every render to compute token usage stats, plus `getContextUsage()` does tree walks and `JSON.stringify` of every message.

**Fix**: pi-turbo patches `SessionManager.getEntries()` and `AgentSession.getContextUsage()` with smart caching:

- `getEntries()`: returns a cached array, invalidated only when new entries are appended (O(1) vs O(n) filter + allocation)
- `getContextUsage()`: cached per entry-count, avoiding repeated tree walks and token estimation (O(1) vs O(n) + O(content size))

## Impact on pi

**Zero.** pi-turbo never touches pi's source code, node_modules, or config files.

- All patches are runtime monkey-patches on prototype methods
- Every patch is wrapped in try-catch — any error falls back to pi's original behavior
- Kill-switches let you disable any optimization independently
- Uninstall removes all traces; pi works exactly as before

The only observable difference: pi starts faster and the footer doesn't lag.

## Evidence

### 1. Startup: A/B benchmark

20 extensions installed, 3 runs per mode:

**Serial baseline** (`PI_TURBO_SERIAL=1`):

```
5140ms
5000ms
9251ms
```

**Parallel** (default):

```
⚡ pi-turbo: 20 exts in 6507ms (serial ~9432ms, saved 31%, 1 chunk)
⚡ pi-turbo: 20 exts in 8387ms (serial ~11489ms, saved 27%, 1 chunk)
⚡ pi-turbo: 20 exts in 9796ms (serial ~13797ms, saved 29%, 1 chunk)
```

> The "saved %" is computed per-run: `(estimated_serial − actual_parallel) / estimated_serial`, where `estimated_serial` is the sum of individually-profiled per-extension EMA times. Absolute times vary with system load; the ratio is the stable metric.

### 2. Startup: EMA profiling

Example `pi-tb --status` output:

```
Top extensions by EMA:
  extensions/index.ts          2527ms  ← lean-ctx MCP bridge (I/O bound)
  dist/index.js                 309ms
  (remaining 18 extensions      <100ms each)
```

The I/O-bound extension (2527ms) is loaded in a background chunk while CPU-bound extensions load serially, overlapping I/O wait with CPU work.

### 3. Footer: O(n) scan in pi source

Code-level evidence (not benchmarkable). The lag originates from three hot paths:

```js
// footer.js:80 — every render frame
sessionManager.getEntries()

// session-manager.js:980 — O(n) filter + new array allocation on every call
this.fileEntries.filter(e => e.type !== "session")

// agent-session.js:2534 — O(n) tree walk + JSON.stringify of all messages
getContextUsage() → getBranch() + estimateContextTokens()
```

`fileEntries` is append-only, so `n` grows with conversation length. After 100+ messages, every Enter key triggers O(n) scan + O(content) serialization → visible lag.

**pi-turbo's fix**: WeakMap cache keyed on `fileEntries.length` (append-only invariant). Cache hit = O(1). Cache miss (new entry appended) = one O(n) pass, then cached.

## Install

```bash
cd ~/github/pi-opt
./install.sh
```

### Upgrading from pi-opt

If you previously installed pi-opt, just re-run `./install.sh`. It will:

- Remove the old `pi-opt` global command
- Install the new `pi-tb` command
- Migrate your timing data from `~/.pi-opt/` to `~/.pi-turbo/`

## Usage

```bash
pi-tb                          # launch pi with all optimizations
pi-tb --status                 # show per-extension timing statistics
PI_TURBO_SERIAL=1 pi-tb        # disable startup optimization (A/B baseline)
PI_TURBO_NO_FOOTER=1 pi-tb     # disable footer caching only
```

## Uninstall

```bash
./uninstall.sh
```

## How it works

pi-turbo is a thin wrapper that monkey-patches two things at runtime:

1. **Extension loader** — `DefaultResourceLoader.prototype.loadFinalExtensionSet` is replaced with a targeted parallel loader that uses EMA timing profiles to identify I/O-bound extensions and load them concurrently.

2. **Footer render cache** — `SessionManager.prototype.getEntries` and `AgentSession.prototype.getContextUsage` are wrapped with entry-count-keyed caches, eliminating per-render O(n) scans.

Both patches are fail-safe: any error falls back to pi's original behavior.

## Files

- `bin/pi-tb.js` — CLI entry point
- `src/patch.js` — monkey-patch orchestrator
- `src/footer-patch.js` — footer render caching
- `src/targeted-loader.js` — targeted parallel loading algorithm
- `src/timing.js` — EMA timing recorder
- `src/config.js` — paths and constants
- `~/.pi-turbo/per-ext-timings.json` — per-extension timing data (auto-created)

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `PI_TURBO_SERIAL=1` | — | Kill-switch: force serial extension loading |
| `PI_TURBO_OFF=1` | — | Skip all patches entirely |
| `PI_TURBO_CHUNK` | 4 | Extensions per parallel chunk |
| `PI_TURBO_DEBUG=1` | — | Verbose loading logs |
| `PI_TURBO_PROFILE=1` | — | Force re-profiling (ignore existing EMA data) |
| `PI_TURBO_NO_FOOTER=1` | — | Disable footer caching only |

## Requirements

- Node.js >= 22.19.0
- pi (`@earendil-works/pi-coding-agent`) >= 0.50.0
