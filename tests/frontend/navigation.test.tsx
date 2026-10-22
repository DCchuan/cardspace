import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { WorkspaceSearch, NewMemoryButton } =
  await import("../../apps/web/src/navigation");

test("搜索按钮与 Enter 只提交搜索，新建按钮独立打开录入", async () => {
  let searches = 0,
    creates = 0;
  const inputRef = React.createRef<HTMLInputElement>();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <WorkspaceSearch
          inputRef={inputRef}
          value="问题关键词"
          onChange={() => {}}
          onSearch={() => searches++}
        />
        <NewMemoryButton onClick={() => creates++} />
      </>,
    ),
  );
  const form = container.querySelector("form")!;
  const search = container.querySelector(
    "button[type=submit]",
  ) as HTMLButtonElement;
  assert.equal(search.textContent, "搜索");
  assert.equal(container.querySelector("input")!.value, "问题关键词");
  await act(async () => search.click());
  assert.equal(searches, 1);
  assert.equal(creates, 0);
  await act(async () =>
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  assert.equal(searches, 2);
  const create = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "新建记忆",
  )!;
  assert.ok(!form.contains(create));
  await act(async () => create.click());
  assert.equal(creates, 1);
  assert.equal(searches, 2);
  await act(async () => {
    inputRef.current!.dispatchEvent(
      new dom.window.CompositionEvent("compositionstart", { bubbles: true }),
    );
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  assert.equal(searches, 2);
  await act(async () => root.unmount());
  container.remove();
});
