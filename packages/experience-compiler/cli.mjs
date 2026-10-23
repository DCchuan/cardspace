import { compile } from "./compile.mjs";
import { validateSpec } from "../experience-runtime/semantics.mjs";
let text = "";
for await (const chunk of process.stdin) {
  text += chunk;
  if (Buffer.byteLength(text) > 524288) throw Error("INPUT_SIZE");
}
try {
  const input = JSON.parse(text);
  if (input.operation === "validate") {
    validateSpec(input.spec, input.source_ref_allowlist || []);
    process.stdout.write(JSON.stringify({ valid: true }));
  } else process.stdout.write(JSON.stringify(compile(input)));
} catch (e) {
  process.stdout.write(
    JSON.stringify({
      spec: null,
      diagnostics: [
        { code: String(e.message).slice(0, 300), line: 1, column: 0 },
      ],
    }),
  );
}
