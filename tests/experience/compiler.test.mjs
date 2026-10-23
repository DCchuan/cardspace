import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compile } from "../../packages/experience-compiler/compile.mjs";
import { validateSpec } from "../../packages/experience-runtime/semantics.mjs";
const source = fs.readFileSync(
  "packages/experience-examples/recommendation.experience.tsx",
  "utf8",
);
const run = (s = source, extras = {}) =>
  compile({
    sdk_version: "experience-sdk.v1",
    files: [{ path: "experience.tsx", content: s }],
    source_ref_allowlist: ["s1"],
    ...extras,
  });
test("golden TSX compiles to exactly the frozen JSON", () =>
  assert.deepEqual(
    JSON.parse(JSON.stringify(run().spec)),
    JSON.parse(
      fs.readFileSync(
        "packages/experience-examples/recommendation.experience.json",
      ),
    ),
  ));
const attacks = {
  fs: source.replace("@cardspace/experience", "node:fs"),
  alias: source.replace("defineExperience,", "defineExperience as d,"),
  sideEffect: 'fetch("https://evil.example");\n' + source,
  spread: source.replace("version:", "...globalThis,version:"),
  getter: source.replace(
    'version: "experience.v1",',
    'get version(){return "experience.v1"},',
  ),
  computed: source.replace("version:", '["version"]:'),
  prototype: source.replace("actions: {},", "actions: {__proto__: {}},"),
  constructor: source.replace("actions: {},", "actions: {constructor: {}},"),
  functionProp: source.replace(
    '<Stack id="root">',
    '<Stack id="root" onClick={()=>fetch("/")}>',
  ),
  spreadProp: source.replace('<Stack id="root">', '<Stack {...x} id="root">'),
  nativeHTML: source.replace('Heading id="title"', 'iframe id="title"'),
  expression: source.replace("initial: 0.8", "initial: (()=>1)()"),
  duplicate: source.replace("actions: {},", "actions: {},actions: {},"),
  textChild: source.replace('<Stack id="root">', '<Stack id="root">hello'),
  typeCall: source.replace("defineExperience({", "defineExperience<any>({"),
  huge: " ".repeat(131073),
  externalRef: source.replace(
    'source_refs: ["s1"]',
    'source_refs: ["https://evil.example"]',
  ),
};
for (const [name, s] of Object.entries(attacks))
  test("reject " + name, () => {
    const r = run(s);
    assert.equal(r.spec, null);
    assert.ok(r.diagnostics[0].code);
    assert.equal(typeof r.diagnostics[0].line, "number");
  });
test("paths and unsupported SDK are rejected", () => {
  assert.equal(
    run(source, { files: [{ path: "../x.tsx", content: source }] }).spec,
    null,
  );
  assert.equal(run(source, { sdk_version: "latest" }).spec, null);
});
test("semantic state bounds, refs, expression types and action cycles", () => {
  const original = JSON.parse(JSON.stringify(run().spec));
  const invalid = [
    (s) => (s.state.alpha.initial = 2),
    (s) => s.view.children.push({ ...s.view.children[0] }),
    (s) => (s.view.children[2].state_key = "missing"),
    (s) => (s.derivations[0].terms[0].weight = { literal: "x" }),
    (s) => (s.actions = { loop: { kind: "sequence", action_ids: ["loop"] } }),
    (s) => (s.view.children[3].data_key = "missing"),
  ];
  for (const change of invalid) {
    const s = structuredClone(original);
    change(s);
    assert.throws(() => validateSpec(s, ["s1"]));
  }
});
