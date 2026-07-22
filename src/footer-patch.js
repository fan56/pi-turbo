import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Patch SessionManager.getEntries() and AgentSession.getContextUsage()
 * with entry-count-keyed caches to eliminate per-render O(n) scans.
 *
 * Kill-switch: PI_TURBO_NO_FOOTER=1
 * Fail-safe: any error → skip patch, pi works normally.
 */
export async function applyFooterPatch(piDistDir) {
	if (process.env.PI_TURBO_NO_FOOTER === "1") {
		process.stderr.write(
			"[pi-turbo] footer caching disabled (PI_TURBO_NO_FOOTER=1)\n",
		);
		return;
	}

	try {
		// ── Patch 1: SessionManager.getEntries() — cache filtered array ──
		const smUrl = pathToFileURL(
			path.join(piDistDir, "core/session-manager.js"),
		).href;
		const { SessionManager } = await import(smUrl);

		if (typeof SessionManager?.prototype?.getEntries === "function") {
			const origGetEntries = SessionManager.prototype.getEntries;
			const entriesCache = new WeakMap();

			SessionManager.prototype.getEntries = function () {
				const c = entriesCache.get(this);
				// fileEntries is append-only; length change = new entry added
				if (c && c.len === this.fileEntries.length) {
					return c.entries;
				}
				const entries = origGetEntries.call(this);
				entriesCache.set(this, { entries, len: this.fileEntries.length });
				return entries;
			};
		}

		// ── Patch 2: AgentSession.getContextUsage() — cache per entry count ──
		const asUrl = pathToFileURL(
			path.join(piDistDir, "core/agent-session.js"),
		).href;
		const { AgentSession } = await import(asUrl);

		if (typeof AgentSession?.prototype?.getContextUsage === "function") {
			const origGetContextUsage = AgentSession.prototype.getContextUsage;
			const ctxCache = new WeakMap();

			AgentSession.prototype.getContextUsage = function () {
				const sm = this.sessionManager;
				// Use fileEntries.length as cache key — changes on every append
				const key = sm?.fileEntries?.length ?? -1;
				const c = ctxCache.get(this);
				if (c && c.key === key) {
					return c.value;
				}
				const value = origGetContextUsage.call(this);
				ctxCache.set(this, { value, key });
				return value;
			};
		}

		process.stderr.write("[pi-turbo] footer render caching enabled\n");
	} catch (err) {
		process.stderr.write(
			`[pi-turbo] footer patch failed (non-fatal): ${err.message}\n`,
		);
	}
}
