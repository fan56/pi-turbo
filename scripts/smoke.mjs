// Smoke test: syntax-check every shipped JS file (bin + src) with
// node --check. The deeper A/B tests in test/ need a live pi install and
// are run locally, not in CI.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targets = [];
for (const dir of ["bin", "src"]) {
	const abs = path.join(root, dir);
	for (const name of readdirSync(abs)) {
		const p = path.join(abs, name);
		if (statSync(p).isFile() && name.endsWith(".js")) targets.push(p);
	}
}
if (targets.length === 0) {
	console.error("SMOKE FAIL: no .js files found under bin/ or src/");
	process.exit(1);
}
for (const t of targets) {
	execFileSync(process.execPath, ["--check", t], { stdio: "pipe" });
	console.log(`OK: ${path.relative(root, t)}`);
}
console.log(`SMOKE OK: ${targets.length} files pass node --check`);
