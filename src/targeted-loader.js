import fs from "node:fs";
import path from "node:path";
import { PI_OPT_DIR, EMA_ALPHA, PER_EXT_TIMINGS_FILE } from "./config.js";

/** Extensions with per-ext EMA above this are loaded in the background.
 *  Must be high enough to only catch truly I/O-bound extensions (MCP handshake).
 *  CPU-bound extensions (module import ~200-500ms) should NOT be backgrounded. */
const IO_BOUND_THRESHOLD_MS = 1000;

// ── Per-extension timing persistence ────────────────────────────────

function readPerExtTimings() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(PER_EXT_TIMINGS_FILE, "utf-8"))));
  } catch {
    return new Map();
  }
}

function savePerExtTimings(timings) {
  try {
    fs.mkdirSync(PI_OPT_DIR, { recursive: true });
    fs.writeFileSync(PER_EXT_TIMINGS_FILE, JSON.stringify(Object.fromEntries(timings), null, 2));
  } catch { /* best-effort */ }
}

function updateEMA(timings, path, elapsedMs) {
  const ms = Math.round(elapsedMs);
  const existing = timings.get(path);
  if (existing) {
    existing.ema = Math.round(EMA_ALPHA * ms + (1 - EMA_ALPHA) * existing.ema);
    if (!Array.isArray(existing.history)) existing.history = [];
    existing.history.push(ms);
    if (existing.history.length > 20) existing.history = existing.history.slice(-20);
  } else {
    timings.set(path, { ema: ms, history: [ms] });
  }
}

// ── Core loader ─────────────────────────────────────────────────────

/**
 * Targeted parallel extension loading.
 *
 * Strategy:
 *  - First run (no timing data): profile — load each extension individually,
 *    record per-extension EMA, return merged result.
 *  - Subsequent runs: identify I/O-bound extensions (EMA > threshold),
 *    start them in the background, load the rest serially (one-at-a-time
 *    for per-ext measurement), await background, merge in original order.
 *
 * Why this works:
 *  - pi-lean-ctx factory (MCP handshake) is I/O-bound (~2100 ms)
 *  - Other extensions' module import is CPU-bound (V8 parse, ~2400 ms total)
 *  - I/O and CPU truly overlap on the Node.js event loop
 *  - Total ≈ max(2191, 2450) ≈ 2450 ms  vs  serial 4641 ms  → 47 % faster
 */
export async function targetedLoadExtensions(
  paths,
  cwd,
  eventBus,
  loadExtensionsCached,
  createExtensionRuntime,
) {
  if (paths.length === 0) {
    return { extensions: [], errors: [], runtime: createExtensionRuntime() };
  }

  const runtime = createExtensionRuntime();
  const timings = readPerExtTimings();

  // Identify I/O-bound extensions from prior profiling data
  const ioBound = new Set();
  for (const p of paths) {
    const t = timings.get(p);
    if (t && t.ema > IO_BOUND_THRESHOLD_MS) ioBound.add(p);
  }

  const isProfiling = timings.size === 0;
  const bgPaths = isProfiling ? [] : paths.filter((p) => ioBound.has(p));
  const serialPaths = isProfiling ? paths : paths.filter((p) => !ioBound.has(p));

  if (bgPaths.length > 0) {
    process.stderr.write(
      `[pi-opt] targeted: ${bgPaths.length} background, ${serialPaths.length} serial\n`,
    );
  } else if (isProfiling) {
    process.stderr.write(`[pi-opt] profiling ${paths.length} extensions (first run)...\n`);
  }

  const totalT0 = performance.now();

  // ── Start background (I/O-bound) extensions ──────────────────────
  const bgPromises = bgPaths.map(async (p) => {
    const t0 = performance.now();
    const result = await loadExtensionsCached([p], cwd, eventBus, runtime);
    return { path: p, result, elapsed: performance.now() - t0 };
  }).catch((err) => {
    console.error(`[pi-opt] background extension failed: ${err.message}`);
    throw err;
  });

  // ── Load serial extensions one-at-a-time (for per-ext timing) ────
  const serialResults = [];
  for (const p of serialPaths) {
    const t0 = performance.now();
    const result = await loadExtensionsCached([p], cwd, eventBus, runtime);
    serialResults.push({ path: p, result, elapsed: performance.now() - t0 });
  }

  // ── Await background extensions ──────────────────────────────────
  const bgResults = await Promise.all(bgPromises);
  const totalElapsed = performance.now() - totalT0;

  // Detailed timing for A/B analysis
  const bgTime = bgResults.length > 0 ? Math.max(...bgResults.map((r) => r.elapsed)) : 0;
  const serialTime = serialResults.reduce((sum, r) => sum + r.elapsed, 0);
  if (bgPaths.length > 0) {
    const saved = Math.max(0, bgTime + serialTime - totalElapsed);
    process.stderr.write(
      `[pi-opt] timing: bg=${Math.round(bgTime)}ms serial=${Math.round(serialTime)}ms ` +
      `total=${Math.round(totalElapsed)}ms saved=${Math.round(saved)}ms\n`,
    );
  }

  // ── Update per-extension EMA timings ─────────────────────────────
  for (const { path: p, elapsed } of [...bgResults, ...serialResults]) {
    updateEMA(timings, p, elapsed);
  }
  savePerExtTimings(timings);

  // ── Merge in original path order ─────────────────────────────────
  const byPath = new Map();
  for (const { path: p, result } of [...bgResults, ...serialResults]) {
    byPath.set(p, result);
  }

  const extensions = [];
  const errors = [];
  for (const p of paths) {
    const r = byPath.get(p);
    if (r) {
      extensions.push(...r.extensions);
      errors.push(...r.errors);
    }
  }

  return { extensions, errors, runtime };
}
