import fs from "node:fs";
import path from "node:path";
import { PI_TURBO_DIR } from "./config.js";

/** Last-run startup stats, read by the footer patch at render time. */
export const LAST_RUN_FILE = path.join(PI_TURBO_DIR, "last-run.json");

/**
 * Persist the most recent startup's acceleration stats.
 * Atomic write (temp + rename) per project rule.
 */
export function writeLastRun(data) {
	try {
		fs.mkdirSync(PI_TURBO_DIR, { recursive: true });
		const tmp = LAST_RUN_FILE + ".tmp";
		fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
		fs.renameSync(tmp, LAST_RUN_FILE);
	} catch {
		/* best-effort — footer line is optional */
	}
}

/** Read last-run stats; null if absent or corrupt. */
export function readLastRun() {
	try {
		return JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf-8"));
	} catch {
		return null;
	}
}
