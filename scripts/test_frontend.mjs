import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const esbuild = require("esbuild");
const outputDir = fileURLToPath(
  new URL("../apps/web/node_modules/.cache/cardspace-tests/", import.meta.url),
);
const cases = ["autosave", "connection", "navigation", "experience"];
await mkdir(outputDir, { recursive: true });
await esbuild.build({
  entryPoints: cases.map((name) =>
    fileURLToPath(
      new URL(`../tests/frontend/${name}.test.tsx`, import.meta.url),
    ),
  ),
  outdir: outputDir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  jsx: "automatic",
  logLevel: "error",
});
const result = spawnSync(
  process.execPath,
  ["--test", ...cases.map((name) => `${outputDir}${name}.test.mjs`)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
