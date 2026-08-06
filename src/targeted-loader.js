import fs from "node:fs";
import path from "node:path";
import {
	PI_TURBO_DIR,
	EMA_ALPHA,
	PER_EXT_TIMINGS_FILE,
	TIMINGS_FILE,
	STATS_ENABLED,
	STATS_SUMMARY,
} from "./config.js";
import { writeLastRun } from "./last-run.js";

/** Extensions with per-ext EMA above this are loaded in the background.
 *  Must be high enough to only catch truly I/O-bound extensions (MCP handshake).
 *  CPU-bound extensions (module import ~200-500ms) should NOT be backgrounded. */
const IO_BOUND_THRESHOLD_MS = 1000;

// ── Per-extension timing persistence ────────────────────────────────

function readPerExtTimings() {
	try {
		return new Map(
			Object.entries(
				JSON.parse(fs.readFileSync(PER_EXT_TIMINGS_FILE, "utf-8")),
			),
		);
	} catch {
		return new Map();
	}
}

function savePerExtTimings(timings) {
	try {
		fs.mkdirSync(PI_TURBO_DIR, { recursive: true });
		fs.writeFileSync(
			PER_EXT_TIMINGS_FILE,
			JSON.stringify(Object.fromEntries(timings), null, 2),
		);
	} catch {
		/* best-effort */
	}
}

function updateEMA(timings, path, elapsedMs) {
	const ms = Math.round(elapsedMs);
	const existing = timings.get(path);
	if (existing) {
		existing.ema = Math.round(EMA_ALPHA * ms + (1 - EMA_ALPHA) * existing.ema);
		if (!Array.isArray(existing.history)) existing.history = [];
		existing.history.push(ms);
		if (existing.history.length > 20)
			existing.history = existing.history.slice(-20);
	} else {
		timings.set(path, { ema: ms, history: [ms] });
	}
}

// ── Live progress bar (count-based %, EMA-based ETA) ────────────────

/** Read the overall run EMA (ms) from timings.json, or null if none. */
function readOverallEma() {
	try {
		const data = JSON.parse(fs.readFileSync(TIMINGS_FILE, "utf-8"));
		return typeof data.ema === "number" ? data.ema : null;
	} catch {
		return null;
	}
}

/** Compact duration: >=1s shown as seconds, otherwise ms. */
function formatDur(ms) {
	const rounded = Math.round(ms);
	return rounded >= 1000 ? `${(rounded / 1000).toFixed(1)}s` : `${rounded}ms`;
}

/** 16-cell ASCII bar: █ filled, · empty, framed by ▕ ▏. */
function renderBar(done, total) {
	const cells = 16;
	const filled =
		total > 0 ? Math.min(cells, Math.round((done / total) * cells)) : 0;
	return "█".repeat(filled) + "·".repeat(cells - filled);
}

/** In-progress line: bar + count/pct + EMA-based remaining time. */
function renderProgress(done, total, elapsedMs, emaTotalMs) {
	const pct = total > 0 ? Math.round((done / total) * 100) : 0;
	let suffix = "";
	if (emaTotalMs) {
		const remaining = Math.max(0, emaTotalMs - elapsedMs);
		suffix = ` · ~${formatDur(remaining)} left (EMA ${formatDur(emaTotalMs)})`;
	}
	return `⚡ pi-turbo: ▕${renderBar(done, total)}▏ ${done}/${total} (${pct}%)${suffix}`;
}

/** Final (100%) line: full bar + actual total time + EMA. */
function renderFinal(total, totalMs, emaTotalMs) {
	const emaStr = emaTotalMs
		? ` (EMA ${Math.round(emaTotalMs)}ms)`
		: " (profiling)";
	return `⚡ pi-turbo: ▕${"█".repeat(16)}▏ ${total}/${total} (100%) · ${Math.round(totalMs)}ms${emaStr}`;
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
	const serialPaths = isProfiling
		? paths
		: paths.filter((p) => !ioBound.has(p));

	if (bgPaths.length > 0) {
		if (STATS_SUMMARY) {
			process.stderr.write(
				`[pi-turbo] targeted: ${bgPaths.length} background, ${serialPaths.length} serial\n`,
			);
		}
	} else if (isProfiling) {
		if (STATS_SUMMARY) {
			process.stderr.write(
				`[pi-turbo] profiling ${paths.length} extensions (first run)...\n`,
			);
		}
	}

	const totalT0 = performance.now();
	const emaTotalMs = readOverallEma();
	const total = paths.length;
	let loaded = 0;
	const ttyProgress = Boolean(process.stderr.isTTY);
	const tickProgress = () => {
		if (!ttyProgress) return;
		process.stderr.write(
			"\r\x1b[2K" +
				renderProgress(loaded, total, performance.now() - totalT0, emaTotalMs),
		);
	};
	tickProgress();

	// ── Start background (I/O-bound) extensions ──────────────────────
	const bgPromises = bgPaths.map(async (p) => {
		const t0 = performance.now();
		try {
			const result = await loadExtensionsCached([p], cwd, eventBus, runtime);
			return { path: p, result, elapsed: performance.now() - t0 };
		} catch (err) {
			console.error(`[pi-turbo] background extension failed: ${err.message}`);
			throw err;
		}
	});
	// Tick the progress bar as each background extension resolves.
	// The rejection handler swallows the fork so the real error still
	// surfaces via `await Promise.all(bgPromises)` below.
	bgPromises.forEach((pr) =>
		pr.then(
			() => {
				loaded++;
				tickProgress();
			},
			() => {},
		),
	);

	// ── Load serial extensions one-at-a-time (for per-ext timing) ────
	const serialResults = [];
	for (const p of serialPaths) {
		const t0 = performance.now();
		const result = await loadExtensionsCached([p], cwd, eventBus, runtime);
		serialResults.push({ path: p, result, elapsed: performance.now() - t0 });
		loaded++;
		tickProgress();
	}

	// ── Await background extensions ──────────────────────────────────
	const bgResults = await Promise.all(bgPromises);
	const totalElapsed = performance.now() - totalT0;

	// Finalize the live progress line (headline summary).
	// Progress is UX output, not a stat: shown regardless of PI_TURBO_STATS.
	// TTY animates the bar in place; non-TTY prints the final line once.
	const line = renderFinal(total, totalElapsed, emaTotalMs);
	if (process.stderr.isTTY) process.stderr.write("\r\x1b[2K" + line + "\n");
	else process.stderr.write(line + "\n");

	// Detailed timing for A/B analysis
	const bgTime =
		bgResults.length > 0 ? Math.max(...bgResults.map((r) => r.elapsed)) : 0;
	const serialTime = serialResults.reduce((sum, r) => sum + r.elapsed, 0);
	const baselineEst = bgTime + serialTime;
	const savedMs = Math.max(0, baselineEst - totalElapsed);
	const savedPct =
		baselineEst > 0 ? Math.round((savedMs / baselineEst) * 100) : 0;
	if (bgPaths.length > 0 && STATS_SUMMARY) {
		process.stderr.write(
			`[pi-turbo] timing: bg=${Math.round(bgTime)}ms serial=${Math.round(serialTime)}ms ` +
				`total=${Math.round(totalElapsed)}ms saved=${Math.round(savedMs)}ms\n`,
		);
	}
	// Persist startup stats for the pi-ext-fan boot banner (saved time + %).
	// Only for real interactive launches — non-TTY invocations (e.g.
	// `pi-tb --version`) would overwrite the last real run with ~30ms noise.
	if (process.stderr.isTTY) {
		writeLastRun({
			ts: new Date().toISOString(),
			n: paths.length,
			totalMs: Math.round(totalElapsed),
			savedMs: Math.round(savedMs),
			pct: savedPct,
			profiling: isProfiling,
		});
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

	// ── Startup stats ──────────────────────────────────────────────────
	if (STATS_ENABLED) {
		const base = (p) => path.basename(p);
		if (bgPaths.length > 0) {
			console.error(`  chunks: [${bgPaths.map(base).join(", ")}]`);
		}
		console.error(`  serial: [${serialPaths.map(base).join(", ")}]`);
		let slowestPath = null;
		let slowestEma = 0;
		for (const p of paths) {
			const t = timings.get(p);
			if (t && t.ema > slowestEma) {
				slowestEma = t.ema;
				slowestPath = p;
			}
		}
		if (slowestPath) {
			console.error(`  slowest: ${base(slowestPath)} (${slowestEma}ms EMA)`);
		}
	}

	return { extensions, errors, runtime };
}
