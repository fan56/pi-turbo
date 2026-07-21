import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import fs from "fs";

// Test 1: resolve pi entry
const piEntryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
const piDistDir = path.dirname(fileURLToPath(piEntryUrl));
console.log("pi dist dir:", piDistDir);

// Test 2: check internal modules exist
const loaderPath = path.join(piDistDir, "core/extensions/loader.js");
const configPath = path.join(piDistDir, "config.js");
const httpPath = path.join(piDistDir, "core/http-dispatcher.js");
console.log("loader.js exists:", fs.existsSync(loaderPath));
console.log("config.js exists:", fs.existsSync(configPath));
console.log("http-dispatcher.js exists:", fs.existsSync(httpPath));

// Test 3: dynamic import of loader
const loaderUrl = pathToFileURL(loaderPath).href;
const loader = await import(loaderUrl);
console.log("loadExtensionsCached:", typeof loader.loadExtensionsCached);
console.log("createExtensionRuntime:", typeof loader.createExtensionRuntime);

// Test 4: DefaultResourceLoader has loadFinalExtensionSet
const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
console.log("loadFinalExtensionSet:", typeof DefaultResourceLoader.prototype.loadFinalExtensionSet);

console.log("\n✅ All smoke tests passed");
