import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(scriptDir, "..");
const packageRoot = resolve(moduleRoot, "package", "dicewatcher");

await rm(packageRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });

await cp(resolve(moduleRoot, "module.json"), resolve(packageRoot, "module.json"));
await cp(resolve(moduleRoot, "dist"), resolve(packageRoot, "dist"), {
  recursive: true
});

console.log(`Packaged Foundry module at ${packageRoot}`);
