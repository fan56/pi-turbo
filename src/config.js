import path from "node:path";
import os from "node:os";

export const PI_TURBO_DIR = path.join(os.homedir(), ".pi-turbo");
export const TIMINGS_FILE = path.join(PI_TURBO_DIR, "timings.json");
export const PER_EXT_TIMINGS_FILE = path.join(
	PI_TURBO_DIR,
	"per-ext-timings.json",
);

/** EMA smoothing factor (0–1). Higher = more weight on recent runs. */
export const EMA_ALPHA = 0.3;

/** Max timing history entries kept on disk */
export const MAX_HISTORY = 100;

/** Enable detailed stats output (PI_TURBO_STATS=1) */
export const STATS_ENABLED = process.env.PI_TURBO_STATS === "1";

/** Enable one-line startup summary (default on, PI_TURBO_STATS=0 to disable) */
export const STATS_SUMMARY = process.env.PI_TURBO_STATS !== "0";
