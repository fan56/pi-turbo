/**
 * A/B test: targeted parallel vs serial extension loading.
 *
 * Run: node test/ab-targeted.mjs
 *
 * Phase 1: Serial baseline (PI_OPT_SERIAL=1)
 * Phase 2: Profiling run (first targeted run, no timing data)
 * Phase 3: Optimized run (targeted with timing data)
 * Phase 4: Second optimized run (EMA updated)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PI_OPT_DIR = path.join(os.homedir(), ".pi-opt");
const PER_EXT_FILE = path.join(PI_OPT_DIR, "per-ext-timings.json");
const INTEGRATION = path.join(import.meta.dirname, "integration.mjs");

function run(label, env = {}) {
  const t0 = performance.now();
  const proc = spawnSync("node", [INTEGRATION], {
    env: { ...process.env, ...env },
    timeout: 120_000,
    encoding: "utf-8",
  });
  const elapsed = Math.round(performance.now() - t0);
  const stderr = proc.stderr || "";
  const optLines = stderr.split("\n").filter((l) => l.includes("[pi-opt]")).map((l) => l.trim());
  console.log(`${label}: ${elapsed}ms (wall)`);
  for (const l of optLines) console.log(`   ${l}`);
  return elapsed;
}

// Clean per-ext timings to force profiling
try { fs.unlinkSync(PER_EXT_FILE); } catch {}

console.log("=== Targeted Parallel A/B Test ===\n");

// Phase 1: Serial baseline
const serial = run("1. Serial baseline     ", { PI_OPT_SERIAL: "1" });

// Phase 2: Profiling run (first targeted run)
const profiling = run("2. Profiling run       ");

// Phase 3: Optimized run (with timing data)
const optimized = run("3. Optimized (targeted)");

// Phase 4: Second optimized run (EMA updated)
const optimized2 = run("4. Optimized (2nd run) ");

console.log("\n=== Results ===");
console.log(`Serial baseline:  ${serial}ms`);
console.log(`Profiling run:    ${profiling}ms`);
console.log(`Optimized:        ${optimized}ms`);
console.log(`Optimized (2nd):  ${optimized2}ms`);
if (optimized > 0 && serial > 0) {
  console.log(`\nSpeedup: ${(serial / optimized).toFixed(2)}x  (${Math.round((1 - optimized / serial) * 100)}% faster)`);
}

// Show per-ext timings
try {
  const data = JSON.parse(fs.readFileSync(PER_EXT_FILE, "utf-8"));
  console.log("\n=== Per-extension EMA ===");
  const sorted = Object.entries(data).sort((a, b) => b[1].ema - a[1].ema);
  for (const [p, t] of sorted) {
    const name = p.split("/").slice(-2).join("/");
    const flag = t.ema > 500 ? " ← I/O-bound" : "";
    console.log(`  ${name}: ${t.ema}ms${flag}`);
  }
} catch {}
