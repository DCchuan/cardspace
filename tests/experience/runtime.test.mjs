import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compile } from "../../packages/experience-compiler/compile.mjs";
import {
  initial,
  reduce,
  project,
  evaluate,
  start,
} from "../../packages/experience-runtime/engine.mjs";
const spec = (name) =>
  JSON.parse(
    fs.readFileSync(`packages/experience-examples/${name}.experience.json`),
  );
for (const name of ["flow", "prototype"])
  test(name + " static golden", () => {
    const result = compile({
      sdk_version: "experience-sdk.v1",
      files: [
        {
          path: "experience.tsx",
          content: fs.readFileSync(
            `packages/experience-examples/${name}.experience.tsx`,
            "utf8",
          ),
        },
      ],
      source_ref_allowlist: ["s1"],
    });
    assert.deepEqual(JSON.parse(JSON.stringify(result.spec)), spec(name));
    start(result.spec, ["s1"]);
  });
test("ranking oracle values and reversal at 0.8 -> 0.2", () => {
  const s = spec("recommendation");
  let st = initial(s);
  const a = project(s, st).data.ranking;
  assert.deepEqual(
    a.map((r) => r.id),
    ["A", "B", "C"],
  );
  a.forEach((r, i) =>
    assert.ok(Math.abs(r.score - [0.78, 0.56, 0.28][i]) < 1e-9),
  );
  st = reduce(s, st, { type: "INPUT", node_id: "weight", value: 0.2 });
  const b = project(s, st).data.ranking;
  assert.deepEqual(
    b.map((r) => r.id),
    ["B", "C", "A"],
  );
  b.forEach((r, i) =>
    assert.ok(Math.abs(r.score - [0.74, 0.52, 0.42][i]) < 1e-9),
  );
  assert.equal(initial(s).values.alpha, 0.8);
});
test("flow guard and terminal state", () => {
  const s = spec("flow");
  let st = initial(s);
  const next = () =>
    (st = reduce(s, st, { type: "ACTION", action_id: "next" }));
  next();
  assert.equal(st.values.stage, "created");
  st = reduce(s, st, { type: "INPUT", node_id: "valid", value: true });
  for (const expected of ["checked", "paid", "done", "done"]) {
    next();
    assert.equal(st.values.stage, expected);
  }
});
test("prototype append sequence/remove and reset", () => {
  const s = spec("prototype");
  let st = initial(s);
  st = reduce(s, st, { type: "ACTION", action_id: "submit" });
  assert.deepEqual(st.data.tasks, [{ label: "阅读原文", id: "row_1" }]);
  assert.equal(st.values.task, "");
  st = reduce(s, st, { type: "ACTION", action_id: "remove" });
  assert.equal(st.data.tasks.length, 0);
  assert.deepEqual(reduce(s, st, { type: "RESET" }), initial(s));
});
test("runtime rejects invalid events and division/resource limits", () => {
  const s = spec("recommendation"),
    st = initial(s);
  assert.throws(() =>
    reduce(s, st, { type: "INPUT", node_id: "chart", value: 0.2 }),
  );
  assert.throws(() =>
    reduce(s, st, { type: "INPUT", node_id: "weight", value: 2 }),
  );
  assert.throws(() =>
    reduce(s, st, { type: "ACTION", action_id: "constructor" }),
  );
  assert.throws(() =>
    evaluate({ op: "div", args: [{ literal: 1 }, { literal: 0 }] }, st),
  );
  assert.throws(() => evaluate({ literal: 1 }, st, { left: 0 }));
  assert.equal(st.values.alpha, 0.8);
});
test("conditional expressions short-circuit unreachable division", () => {
  const st = initial(spec("recommendation"));
  assert.equal(
    evaluate(
      {
        op: "if",
        args: [
          { literal: true },
          { literal: 2 },
          { op: "div", args: [{ literal: 1 }, { literal: 0 }] },
        ],
      },
      st,
    ),
    2,
  );
});
test("snapshots roundtrip local prototype state and reject unsafe values", async () => {
  const { restore } =
    await import("../../packages/experience-runtime/engine.mjs");
  const s = spec("prototype");
  const st = reduce(s, initial(s), { type: "ACTION", action_id: "submit" });
  assert.deepEqual(restore(s, st), st);
  assert.throws(() => restore(s, { ...st, serial: -1 }));
  assert.throws(() =>
    restore(s, { ...st, values: { ...st.values, constructor: "bad" } }),
  );
  assert.throws(() =>
    restore(s, {
      ...st,
      data: { tasks: Array(501).fill({ label: "too many" }) },
    }),
  );
});
