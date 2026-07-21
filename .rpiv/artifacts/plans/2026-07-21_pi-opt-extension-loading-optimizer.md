---
date: 2026-07-21T17:30:00+0800
author: fliu56
branch: main
repository: pi-opt
topic: "pi-opt — pi extension loading optimizer"
tags: [plan, pi, extension-loading, performance, optimization]
status: in-progress
---

# Plan: pi-opt — pi extension loading optimizer

## Overview

pi-opt is a thin CLI wrapper around pi that optimizes extension loading by parallelizing I/O-bound extensions (e.g. pi-lean-ctx MCP handshake) while loading CPU-bound extensions serially. It monkey-patches `DefaultResourceLoader.prototype.loadFinalExtensionSet` at runtime — pi itself is never modified.

**Verified 33% startup speedup**: serial 4661ms → optimized 3125ms.

## Architecture Decisions

1. **Monkey-patch, not fork**: Patch `DefaultResourceLoader.prototype.loadFinalExtensionSet` at runtime. Pi upgrades are transparent (symlink to global install).
2. **Targeted parallel, not full parallel**: Only I/O-bound extensions (EMA > 1000ms) run in background. CPU-bound extensions load serially (jiti transpilation is single-threaded, full parallel is 26% SLOWER).
3. **EMA-based profiling**: Per-extension timing persisted to `~/.pi-opt/per-ext-timings.json`. First run profiles, subsequent runs optimize.
4. **Manual symlinks, NOT npm link**: `npm link` follows node_modules symlinks and deletes global packages. Install uses manual `ln -s` for both node_modules and global bin.

## Current State (What Works)

- ✅ `pi-opt` launches pi with optimized extension loading (20 extensions load correctly)
- ✅ `pi-opt --status` shows per-extension EMA timing table
- ✅ `PI_OPT_SERIAL=1 pi-opt` disables optimization (A/B baseline)
- ✅ `install.sh` / `uninstall.sh` work correctly
- ✅ pi v0.80.10 unaffected (runtime-only patch)
- ✅ Timing data persists across runs (`~/.pi-opt/per-ext-timings.json`)

## File Map

```
~/github/pi-opt/
├── bin/pi-opt.js              # CLI entry: --status flag, initPiEnv, applyPatch, main()
├── src/
│   ├── patch.js               # Monkey-patch DefaultResourceLoader.loadFinalExtensionSet
│   ├── targeted-loader.js     # Core algorithm: profile → classify → bg parallel + serial
│   ├── timing.js              # EMA recorder, loadTimings/saveTimings
│   └── config.js              # PI_OPT_DIR, PER_EXT_TIMINGS_FILE, EMA_ALPHA
├── install.sh                 # Manual symlinks (NO npm link!)
├── uninstall.sh               # Remove symlinks + optionally ~/.pi-opt
├── README.md                  # Usage docs
├── .gitignore                 # node_modules/, *.log
├── package.json               # ESM, bin: pi-opt
└── test/                      # A/B test scripts (ab-targeted.mjs, smoke.mjs, etc.)
```

## Phases

### Phase 1: Fix Code Review Concerns (5 items)
**Goal**: Address all 5 concerns from code review.

**Files**:
- `src/targeted-loader.js` — Concern #1: wrap bg promises with `.catch()` to prevent unhandled rejection if serial loop throws
- `src/patch.js` — Concern #2: add try/catch around `targetedLoadExtensions`, fallback to original method on error
- `install.sh` — Concern #3: guard `npm prefix -g` with `|| true`; Concern #4: handle existing directory at LINK_TARGET (use `-e` not just `-L`)
- `uninstall.sh` — Concern #5: guard `read -p` for non-interactive mode (`|| true` or check `$-` for interactive)

**Success Criteria**:
- [ ] `targeted-loader.js`: bg promises have `.catch()` handlers
- [ ] `patch.js`: `targetedLoadExtensions` wrapped in try/catch with fallback
- [ ] `install.sh`: `npm prefix -g || true`, LINK_TARGET handles dirs
- [ ] `uninstall.sh`: `read -p` doesn't crash in non-interactive mode
- [ ] `pi-opt --print "test"` still works after changes

### Phase 2: Clean Up Suggestions (5 items)
**Goal**: Address all 5 suggestions from code review.

**Files**:
- `src/targeted-loader.js` — Suggestion #1: remove duplicate `PER_EXT_FILE`, import from config.js; Suggestion #4: clamp `saved` to >= 0
- `src/timing.js` — Suggestion #2: remove dead `setBaseline` function
- `src/config.js` — Suggestion #3: remove unused `DEFAULT_CONCURRENCY`
- `install.sh` — Suggestion #5: add Node.js version check (>= 22.19.0)

**Success Criteria**:
- [ ] No duplicate constants
- [ ] No dead code
- [ ] `install.sh` rejects Node < 22.19.0
- [ ] `pi-opt --print "test"` still works

### Phase 3: Git Init + Final Verification
**Goal**: Initialize git repo and run final A/B test.

**Implementation**:
1. `git init` in `~/github/pi-opt/`
2. Initial commit with all files
3. Run A/B test: `PI_OPT_SERIAL=1 pi-opt` vs `pi-opt` — verify speedup
4. Verify `pi --version` still works (pi unaffected)

**Success Criteria**:
- [ ] Git repo initialized with clean commit
- [ ] A/B test shows measurable speedup
- [ ] pi unaffected

## Key Technical Details (for next session)

### How the patch works
```
pi-opt.js → initPiEnv() → applyPatch() → import pi main()
                              ↓
              DefaultResourceLoader.prototype.loadFinalExtensionSet
              is replaced with targetedLoadExtensions()
                              ↓
              1. Load per-ext EMA timings from ~/.pi-opt/per-ext-timings.json
              2. Classify: EMA > 1000ms → I/O-bound (background), else → serial
              3. Promise.all(bgExtensions) + for...of(serialExtensions)
              4. total = max(bgTime, serialTime) instead of bgTime + serialTime
              5. Save updated EMA timings
```

### Critical gotchas
- **jiti transpilation is CPU-bound**: Full `Promise.all` parallel is 26% SLOWER (4507ms vs 3567ms). Only I/O-bound extensions benefit from parallelism.
- **npm link is DANGEROUS**: It follows node_modules symlinks and deletes global packages. NEVER use `npm link` in pi-opt. Use manual `ln -s`.
- **pi-lean-ctx is the bottleneck**: ~2330ms EMA (MCP handshake). It's the only extension above the 1000ms threshold.
- **Symlink resolution**: `node_modules/@earendil-works/pi-coding-agent` must point to the package ROOT (containing package.json), not the parent directory.

### Test commands
```bash
# A/B test
PI_OPT_SERIAL=1 pi-opt --print "Reply OK" --model sonnet 2>&1 | grep '\[pi-opt\]'  # baseline
pi-opt --print "Reply OK" --model sonnet 2>&1 | grep '\[pi-opt\]'                   # optimized

# Status
pi-opt --status

# Install/uninstall
cd ~/github/pi-opt && bash install.sh
cd ~/github/pi-opt && bash uninstall.sh
```

### Per-extension timing (latest EMA)
| Extension | EMA (ms) | Type |
|---|---|---|
| pi-lean-ctx (extensions/index.ts) | 2330 | I/O-bound (bg) |
| dist/index.js | 393 | serial |
| rpiv-core/index.ts | 359 | serial |
| src/goal.ts | 355 | serial |
| src/index.ts | 279 | serial |
| extension-manager.ts | 243 | serial |
| (14 more) | < 211 | serial |
