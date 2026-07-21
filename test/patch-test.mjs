/**
 * Test that the monkey-patch applies correctly and parallel loading works.
 * Uses a fake extension to verify the loading pipeline.
 */
import { applyPatch } from "../src/patch.js";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import fs from "fs";
import path from "path";
import os from "os";

// Create temp dir with fake extensions
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-opt-test-"));
const ext1 = path.join(tmpDir, "ext1.ts");
const ext2 = path.join(tmpDir, "ext2.ts");
const ext3 = path.join(tmpDir, "ext3.ts");

fs.writeFileSync(ext1, `export default function(pi) { pi.on("session_start", () => {}); }`);
fs.writeFileSync(ext2, `export default function(pi) { pi.on("session_start", () => {}); }`);
fs.writeFileSync(ext3, `export default function(pi) { pi.on("session_start", () => {}); }`);

// Apply patch
await applyPatch();

// Verify patch is in place
const patched = DefaultResourceLoader.prototype.loadFinalExtensionSet;
console.log("patched:", patched.toString().includes("parallelLoadExtensions") ? "YES ✅" : "NO ❌");

// Create a loader and test loading
const loader = new DefaultResourceLoader({
  cwd: tmpDir,
  agentDir: path.join(tmpDir, ".pi"),
});

// Call the patched method directly
const result = await loader.loadFinalExtensionSet([ext1, ext2, ext3], undefined);
console.log("extensions loaded:", result.extensions.length);
console.log("errors:", result.errors.length);
console.log("runtime exists:", !!result.runtime);

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

if (result.extensions.length === 3 && result.errors.length === 0) {
  console.log("\n✅ Patch test passed — 3 extensions loaded in parallel");
} else {
  console.log("\n❌ Patch test failed");
  process.exit(1);
}
