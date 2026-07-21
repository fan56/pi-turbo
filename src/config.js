import path from "node:path";
import os from "node:os";

export const PI_OPT_DIR = path.join(os.homedir(), ".pi-opt");
export const TIMINGS_FILE = path.join(PI_OPT_DIR, "timings.json");
export const PER_EXT_TIMINGS_FILE = path.join(PI_OPT_DIR, "per-ext-timings.json");


/** EMA smoothing factor (0–1). Higher = more weight on recent runs. */
export const EMA_ALPHA = 0.3;

/** Max timing history entries kept on disk */
export const MAX_HISTORY = 100;
