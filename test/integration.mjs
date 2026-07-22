/**
 * Integration test: run pi-turbo's full bootstrap + patch, then call main()
 * in --print mode with a trivial prompt. Verifies the full pipeline works.
 */
import { initPiEnv, applyPatch } from "../src/patch.js";

await initPiEnv();
await applyPatch();

const { main } = await import("@earendil-works/pi-coding-agent");

// Use --print mode with a trivial prompt to test the full pipeline
// without entering interactive TUI
await main([
	"--print",
	"Reply with exactly: PI_TURBO_OK",
	"--model",
	"claude-sonnet-4-20250514",
]);
