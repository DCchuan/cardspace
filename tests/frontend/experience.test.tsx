import { test } from "node:test";
import assert from "node:assert/strict";
import { validBridge } from "../../apps/web/src/experiences/bridge";
const message = (type: string, payload: any = {}) => ({
  protocol: "experience-bridge.v1",
  instance_id: "frame-a",
  nonce: "nonce-a",
  type,
  payload,
});
test("bridge authenticates instances and restricts source IDs", () => {
  assert.ok(validBridge(message("READY"), "frame-a", "nonce-a", ["s1"]));
  assert.ok(
    validBridge(
      message("OPEN_SOURCE", { ref_id: "s1" }),
      "frame-a",
      "nonce-a",
      ["s1"],
    ),
  );
  for (const m of [
    message("OPEN_SOURCE", { ref_id: "missing" }),
    message("OPEN_SOURCE", { ref_id: "s1", url: "/api/v1/settings" }),
    message("FETCH", { url: "/api" }),
    { ...message("READY"), nonce: "other" },
    message("RESIZE", { height: 99999 }),
    message("RUNTIME_ERROR", { code: "x".repeat(301) }),
  ])
    assert.equal(validBridge(m, "frame-a", "nonce-a", ["s1"]), false);
});
test("bridge rejects cyclic/oversize values without granting host capabilities", () => {
  const cyclic: any = message("READY");
  cyclic.payload.loop = cyclic;
  assert.equal(validBridge(cyclic, "frame-a", "nonce-a", []), false);
  assert.equal(
    validBridge(
      message("SAVE_STATE", { snapshot: { text: "x".repeat(70000) } }),
      "frame-a",
      "nonce-a",
      [],
    ),
    false,
  );
  assert.equal(
    validBridge(
      { ...message("READY"), api_path: "/api/settings" },
      "frame-a",
      "nonce-a",
      [],
    ),
    false,
  );
});
