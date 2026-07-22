#!/usr/bin/env node
/**
 * pi-turbo — optimized pi launcher
 *
 * Applies a targeted parallel extension-loading patch to DefaultResourceLoader,
 * then delegates to pi's own main().
 *
 * I/O-bound extensions (e.g. pi-lean-ctx MCP handshake) run in background
 * while CPU-bound extensions load serially. Verified 33% startup speedup.
 *
 * Usage:
 *   pi-tb [pi args...]    Launch pi with optimized extension loading
 *   pi-tb --status        Show per-extension timing statistics
 *   PI_TURBO_SERIAL=1 pi-tb Launch without optimization (A/B baseline)
 */

import { readFileSync } from "node:fs";
import { initPiEnv, applyPatch } from "../src/patch.js";
import { PER_EXT_TIMINGS_FILE } from "../src/config.js";

// --status: show timing statistics and exit
if (process.argv.includes("--status")) {
	try {
		const data = JSON.parse(readFileSync(PER_EXT_TIMINGS_FILE, "utf-8"));
		const entries = Object.entries(data).sort((a, b) => b[1].ema - a[1].ema);
		console.log("\npi-turbo per-extension timing (EMA ms):\n");
		console.log(
			"  Extension".padEnd(50) + "EMA(ms)".padStart(8) + "  Runs".padStart(6),
		);
		console.log("  " + "─".repeat(64));
		for (const [name, info] of entries) {
			const short = name.split("/").slice(-2).join("/");
			const runs = info.history ? info.history.length : 0;
			console.log(
				"  " +
					short.padEnd(50) +
					String(Math.round(info.ema)).padStart(6) +
					"ms" +
					String(runs).padStart(6),
			);
		}
		console.log("");
	} catch {
		console.log("No timing data yet. Run pi-tb once to collect data.");
	}
	process.exit(0);
}

// 1. Replicate pi's cli.js bootstrap (process.title, env, HTTP dispatcher)
await initPiEnv();

// 2. Apply the targeted parallel loading patch
await applyPatch();

// 3. Launch pi
const { main } = await import("@earendil-works/pi-coding-agent");
main(process.argv.slice(2));
