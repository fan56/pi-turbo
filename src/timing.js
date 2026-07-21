import fs from "node:fs";
import { PI_OPT_DIR, TIMINGS_FILE, EMA_ALPHA, MAX_HISTORY } from "./config.js";

/**
 * Record a single extension-loading run and print a summary line to stderr.
 * Best-effort — never throws into the caller.
 */
export function recordTiming(extensionCount, elapsedMs) {
  try {
    fs.mkdirSync(PI_OPT_DIR, { recursive: true });

    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(TIMINGS_FILE, "utf-8"));
    } catch { /* first run */ }

    if (!Array.isArray(data.history)) data.history = [];

    data.history.push({
      ts: new Date().toISOString(),
      n: extensionCount,
      ms: Math.round(elapsedMs),
    });

    // Trim old entries
    if (data.history.length > MAX_HISTORY) {
      data.history = data.history.slice(-MAX_HISTORY);
    }

    // Exponential moving average
    const prev = typeof data.ema === "number" ? data.ema : elapsedMs;
    data.ema = Math.round(EMA_ALPHA * elapsedMs + (1 - EMA_ALPHA) * prev);

    fs.writeFileSync(TIMINGS_FILE, JSON.stringify(data, null, 2));

    // Summary line
    const ratio = data.baseline ? ` | ${(data.baseline / elapsedMs).toFixed(2)}x vs baseline` : "";
    process.stderr.write(
      `[pi-opt] ${extensionCount} extensions in ${Math.round(elapsedMs)}ms (EMA ${data.ema}ms${ratio})\n`,
    );
  } catch (err) {
    process.stderr.write(`[pi-opt] timing error: ${err.message}\n`);
  }
}

