# pi-opt

Optimized launcher for [pi](https://github.com/earendil-works/pi) — speeds up startup by parallelizing extension loading.

## How it works

pi loads extensions serially. pi-opt patches `DefaultResourceLoader.loadFinalExtensionSet` to:

1. **Profile** (first run): Load each extension individually, record per-extension timing (EMA)
2. **Optimize** (subsequent runs): Identify I/O-bound extensions (EMA > 1000ms, e.g. pi-lean-ctx MCP handshake) and load them in background while CPU-bound extensions load serially
3. **Overlap**: I/O wait and CPU work run concurrently → total = max(background, serial)

### Results

| Mode | Extension Loading | Speedup |
|---|---|---|
| Serial (pi default) | ~4660ms | — |
| **Targeted parallel** | **~3125ms** | **33%** |

## Install

```bash
cd ~/github/pi-opt
./install.sh
```

## Usage

```bash
pi-opt                    # launch pi with optimized loading
pi-opt --status           # show per-extension timing statistics
PI_OPT_SERIAL=1 pi-opt    # launch without optimization (A/B baseline)
```

## Uninstall

```bash
./uninstall.sh
```

pi is never modified — pi-opt only monkey-patches at runtime.

## Files

- `bin/pi-opt.js` — CLI entry point
- `src/patch.js` — monkey-patch for DefaultResourceLoader
- `src/targeted-loader.js` — targeted parallel loading algorithm
- `src/timing.js` — EMA timing recorder
- `src/config.js` — paths and constants
- `~/.pi-opt/per-ext-timings.json` — per-extension timing data (auto-created)

## Requirements

- Node.js >= 22.19.0
- pi (`@earendil-works/pi-coding-agent`) >= 0.50.0
