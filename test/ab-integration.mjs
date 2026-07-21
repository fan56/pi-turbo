/**
 * A/B integration test: runs the full pi-opt pipeline twice —
 * once serial (PI_OPT_SERIAL=1) and once parallel — comparing timings.
 * Uses --print mode; model error is expected and harmless (extensions
 * are loaded before model resolution).
 */
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const integrationScript = path.join(__dirname, "integration.mjs");

function run(label, env) {
  console.log(`\n--- ${label} ---`);
  try {
    const out = execFileSync("node", [integrationScript], {
      env: { ...process.env, ...env },
      timeout: 60_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    console.log(out);
  } catch (err) {
    // Expected: model not found error. stderr has our timing.
    const stderr = err.stderr || "";
    const stdout = err.stdout || "";
    // Extract pi-opt timing lines
    for (const line of (stderr + stdout).split("\n")) {
      if (line.includes("[pi-opt]")) console.log(line);
    }
    if (!stderr.includes("[pi-opt]")) {
      console.log("stderr:", stderr.slice(0, 300));
    }
  }
}

// A: Serial baseline
run("A: Serial (PI_OPT_SERIAL=1)", { PI_OPT_SERIAL: "1" });

// B: Parallel (default)
run("B: Parallel (default)", {});

console.log("\n✅ Done. Compare [pi-opt] timing lines above.");
