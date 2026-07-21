import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { targetedLoadExtensions } from "./targeted-loader.js";
import { recordTiming } from "./timing.js";

// Resolve pi's dist directory (bypasses exports map for internal modules)
const piEntryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
const piDistDir = path.dirname(fileURLToPath(piEntryUrl));

/**
 * Replicate pi's cli.js bootstrap: process.title, env, warning suppression,
 * and HTTP dispatcher configuration.
 */
export async function initPiEnv() {
  const configUrl = pathToFileURL(path.join(piDistDir, "config.js")).href;
  const { APP_NAME } = await import(configUrl);
  process.title = APP_NAME;
  process.env.PI_CODING_AGENT = "true";
  process.emitWarning = () => {};

  const httpUrl = pathToFileURL(path.join(piDistDir, "core/http-dispatcher.js")).href;
  const { configureHttpDispatcher } = await import(httpUrl);
  configureHttpDispatcher();
}

/**
 * Monkey-patch DefaultResourceLoader.prototype.loadFinalExtensionSet
 * to load extensions in parallel chunks instead of serially.
 *
 * Falls back to the original method for the preTrust code path
 * (first-run trust dialog) and on any unexpected error.
 */
export async function applyPatch() {
  try {
    const loaderUrl = pathToFileURL(
      path.join(piDistDir, "core/extensions/loader.js"),
    ).href;
    const { loadExtensionsCached, createExtensionRuntime } = await import(loaderUrl);

    const original = DefaultResourceLoader.prototype.loadFinalExtensionSet;
    if (typeof original !== "function") {
      process.stderr.write("[pi-opt] loadFinalExtensionSet not found — skipping patch\n");
      return;
    }

    DefaultResourceLoader.prototype.loadFinalExtensionSet = async function (
      extensionPaths,
      preTrustExtensions,
    ) {
      // Pre-trust path: keep original behavior (trust dialog + filtered load)
      if (preTrustExtensions) {
        return original.call(this, extensionPaths, preTrustExtensions);
      }

      // PI_OPT_SERIAL=1 → bypass parallel loading (for A/B baseline)
      if (process.env.PI_OPT_SERIAL === "1") {
        const t0 = performance.now();
        const result = await original.call(this, extensionPaths, preTrustExtensions);
        recordTiming(extensionPaths.length, performance.now() - t0);
        return result;
      }

      // --- Optimized path: targeted parallel loading ---
      // I/O-bound extensions (e.g. pi-lean-ctx MCP handshake) run in
      // background while CPU-bound extensions load serially.
      const t0 = performance.now();

      let extensionsResult;
      try {
        extensionsResult = await targetedLoadExtensions(
          extensionPaths,
          this.cwd,
          this.eventBus,
          loadExtensionsCached,
          createExtensionRuntime,
        );
      } catch (err) {
        process.stderr.write(
          `[pi-opt] targeted loader failed, falling back to serial: ${err.message}\n`,
        );
        return original.call(this, extensionPaths, preTrustExtensions);
      }

      const elapsed = performance.now() - t0;
      recordTiming(extensionPaths.length, elapsed);

      // Inline extension factories (same as original)
      const inlineExtensions = await this.loadExtensionFactories(extensionsResult.runtime);
      extensionsResult.extensions.push(...inlineExtensions.extensions);
      extensionsResult.errors.push(...inlineExtensions.errors);

      // Conflict diagnostics (same as original)
      this.addExtensionConflictDiagnostics(extensionsResult);

      return extensionsResult;
    };

    process.stderr.write("[pi-opt] targeted parallel extension loading enabled\n");
  } catch (err) {
    process.stderr.write(`[pi-opt] patch failed, using default loader: ${err.message}\n`);
  }
}
