/**
 * A/B comparison: serial vs parallel extension loading.
 * Uses the FULL extension set (file-based + npm packages) with hardcoded paths.
 */
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const piDistDir = path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const loaderUrl = pathToFileURL(path.join(piDistDir, "core/extensions/loader.js")).href;
const { loadExtensionsCached, createExtensionRuntime, clearExtensionCache } = await import(loaderUrl);
const eventBusUrl = pathToFileURL(path.join(piDistDir, "core/event-bus.js")).href;
const { createEventBus } = await import(eventBusUrl);

const home = os.homedir();
const agentExt = path.join(home, ".pi/agent/extensions");
const npmMod = path.join(home, ".pi/agent/npm/node_modules");
const cwd = process.cwd();

// Full extension path list (matches pi's loading order: file-based first, then npm)
const extPaths = [
  // File-based
  path.join(agentExt, "handoff.ts"),
  path.join(agentExt, "dcp.json"),
  path.join(agentExt, "pi-bailian-token-plan/index.ts"),
  path.join(agentExt, "pi-ext-fan/index.ts"),
  path.join(agentExt, "pi-ext-tts-mimo/index.ts"),
  path.join(agentExt, "pi-powerline-footer/index.ts"),
  path.join(agentExt, "session-cleaner/index.ts"),
  // npm packages
  path.join(npmMod, "pi-lean-ctx/index.js"),
  path.join(npmMod, "@vanillagreen/pi-extension-manager/index.js"),
  path.join(npmMod, "@pi-vault/pi-dcp/index.js"),
  path.join(npmMod, "@tintinweb/pi-subagents/index.js"),
  path.join(npmMod, "@juicesharp/rpiv-advisor/index.js"),
  path.join(npmMod, "@juicesharp/rpiv-args/index.js"),
  path.join(npmMod, "@juicesharp/rpiv-ask-user-question/index.ts"),
  path.join(npmMod, "@juicesharp/rpiv-i18n/i18n.ts"),
  path.join(npmMod, "@juicesharp/rpiv-web-tools/index.js"),
  path.join(npmMod, "@juicesharp/rpiv-workflow/index.ts"),
  path.join(npmMod, "@juicesharp/rpiv-pi/index.js"),
  path.join(npmMod, "@narumitw/pi-goal/index.js"),
  path.join(npmMod, "pi-lens/dist/index.js"),
];

console.log(`Testing ${extPaths.length} extensions\n`);

// --- A: Serial ---
clearExtensionCache();
const busA = createEventBus();
const t0 = performance.now();
const serialResult = await loadExtensionsCached(extPaths, cwd, busA);
const serialMs = performance.now() - t0;
console.log(`[A] Serial:   ${serialResult.extensions.length} loaded, ${serialResult.errors.length} errors, ${Math.round(serialMs)}ms`);
for (const e of serialResult.errors) console.log(`  ⚠ ${path.basename(e.path)}: ${String(e.error).slice(0, 100)}`);

// --- B: Parallel (4 chunks) ---
clearExtensionCache();
const { parallelLoadExtensions } = await import("../src/parallel-loader.js");
const busB = createEventBus();
const t1 = performance.now();
const parallelResult = await parallelLoadExtensions(extPaths, cwd, busB, loadExtensionsCached, createExtensionRuntime);
const parallelMs = performance.now() - t1;
console.log(`[B] Parallel: ${parallelResult.extensions.length} loaded, ${parallelResult.errors.length} errors, ${Math.round(parallelMs)}ms`);
for (const e of parallelResult.errors) console.log(`  ⚠ ${path.basename(e.path)}: ${String(e.error).slice(0, 100)}`);

// --- C: Parallel again (warm cache) ---
const busC = createEventBus();
const t2 = performance.now();
const warmResult = await parallelLoadExtensions(extPaths, cwd, busC, loadExtensionsCached, createExtensionRuntime);
const warmMs = performance.now() - t2;
console.log(`[C] Parallel (warm): ${warmResult.extensions.length} loaded, ${warmResult.errors.length} errors, ${Math.round(warmMs)}ms`);

// --- Summary ---
console.log(`\n${"=".repeat(50)}`);
console.log(`Serial:          ${Math.round(serialMs)}ms`);
console.log(`Parallel (cold): ${Math.round(parallelMs)}ms  (${(serialMs / parallelMs).toFixed(2)}x)`);
console.log(`Parallel (warm): ${Math.round(warmMs)}ms  (${(serialMs / warmMs).toFixed(2)}x)`);
console.log(`Saved (cold):    ${Math.round(serialMs - parallelMs)}ms`);
