import "./experience_types.mjs";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const Ajv = require("ajv/dist/2020").default,
  standalone = require("ajv/dist/standalone").default;
const schema = JSON.parse(
  await readFile(
    new URL(
      "../packages/experience-contracts/experience.v1.schema.json",
      import.meta.url,
    ),
  ),
);
const ajv = new Ajv({ code: { source: true }, strict: true, allErrors: false });
const esbuild = require("esbuild");
const validator = await esbuild.build({
  stdin: {
    contents: standalone(ajv, ajv.compile(schema)),
    resolveDir: "apps/web",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  minify: true,
});
await writeFile(
  "packages/experience-contracts/validate.cjs",
  validator.outputFiles[0].text,
);
const worker = await esbuild.build({
  entryPoints: ["packages/experience-runtime/worker.mjs"],
  bundle: true,
  write: false,
  format: "iife",
  minify: true,
  platform: "browser",
  logLevel: "error",
});
const built = await esbuild.build({
  entryPoints: ["packages/experience-runtime/view.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  minify: true,
  platform: "browser",
  jsx: "automatic",
  nodePaths: ["apps/web/node_modules"],
  define: {
    "process.env.NODE_ENV": '"production"',
    __WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text),
  },
  logLevel: "error",
});
await writeFile(
  "packages/experience-runtime/trusted.js",
  built.outputFiles[0].text,
);
