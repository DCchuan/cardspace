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
  CompositionEvent: dom.window.CompositionEvent,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { InlineEditable } = await import("../../apps/web/src/minimal");
let current: any;
let writes: any[] = [];
function base() {
  return {
    id: "test-card",
    title: "原始标题",
    summary: "摘要",
    content: "原始正文",
    tags: [],
    card_type: "note",
    current_revision_id: "rev-1",
  };
}
globalThis.fetch = async (url: any, options: any = {}) => {
  if (String(url).endsWith("/session")) return new Response("{}");
  if (options.method === "PATCH") {
    const data = JSON.parse(options.body);
    writes.push(data);
    if (data.expected_revision_id !== current.current_revision_id)
      return new Response(JSON.stringify({ detail: "卡片版本已变化" }), {
        status: 409,
      });
    current = {
      ...current,
      ...data,
      current_revision_id: "rev-" + (writes.length + 1),
    };
  }
  return new Response(JSON.stringify(current));
};
async function render(field = "content", initial = base()) {
  current = initial;
  writes = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <InlineEditable
          card={initial}
          field={field}
          body={field === "content"}
        />
      </QueryClientProvider>,
    );
  });
  return {
    container,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
      localStorage.clear();
    },
  };
}
async function edit(container: any, text: string) {
  const input = container.querySelector("textarea");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  return input;
}
async function click(button: any) {
  await act(async () => button.click());
}
async function wait(ms = 1100) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

test("输入法组合期间不保存，组合完成后自动保存完整中文", async () => {
  const view = await render();
  await click(view.container.querySelector("button"));
  const input = view.container.querySelector("textarea");
  await act(async () =>
    input.dispatchEvent(
      new dom.window.CompositionEvent("compositionstart", { bubbles: true }),
    ),
  );
  await edit(view.container, "尚未结束的组合");
  await wait();
  assert.equal(writes.length, 0);
  await act(async () =>
    input.dispatchEvent(
      new dom.window.CompositionEvent("compositionend", {
        bubbles: true,
        data: "已完成",
      }),
    ),
  );
  await edit(view.container, "中文输入已完成");
  await wait();
  assert.equal(writes.length, 1);
  assert.equal(current.content, "中文输入已完成");
  assert.match(view.container.textContent, /已保存/);
  await view.close();
});

test("恢复的旧草稿遇到同字段新版本时保留草稿，不静默覆盖", async () => {
  localStorage.setItem(
    "cardspace-draft:test-card:content",
    JSON.stringify({ value: "旧草稿", saved: "原始正文", base: "rev-old" }),
  );
  const view = await render("content", {
    ...base(),
    content: "另一窗口的新正文",
  });
  const input = view.container.querySelector("textarea");
  await act(async () => {
    input.dispatchEvent(
      new dom.window.FocusEvent("focusout", { bubbles: true }),
    );
  });
  await wait(50);
  assert.equal(current.content, "另一窗口的新正文");
  assert.equal(input.value, "旧草稿");
  assert.match(view.container.textContent, /草稿已保留/);
  const saved = JSON.parse(
    localStorage.getItem("cardspace-draft:test-card:content")!,
  );
  assert.equal(saved.saved, "原始正文");
  // Explicitly abandoning the draft prevents an unmount retry.
  await click(
    [...view.container.querySelectorAll("button")].find(
      (button: any) => button.textContent === "放弃草稿",
    ),
  );
  await view.close();
});

test("另一字段变化时只合并当前字段，不把旧标题写回", async () => {
  const view = await render();
  await click(view.container.querySelector("button"));
  current = {
    ...current,
    title: "另一窗口的新标题",
    current_revision_id: "rev-external",
  };
  await edit(view.container, "本窗口的新正文");
  await wait();
  assert.equal(current.title, "另一窗口的新标题");
  assert.equal(current.content, "本窗口的新正文");
  assert.equal(writes[0].expected_revision_id, "rev-external");
  assert.equal("title" in writes[0], false);
  await view.close();
});

test("撤销只恢复此次编辑前的字段值", async () => {
  const view = await render("title");
  await click(view.container.querySelector("button"));
  await edit(view.container, "修改后的标题");
  await wait();
  assert.equal(current.title, "修改后的标题");
  // App consumes this event; invoking its undo callback uses the accepted revision guard.
  let undo: any;
  const listener = (event: any) => {
    undo = event.detail.undo;
  };
  window.addEventListener("cardspace-undo", listener);
  await edit(view.container, "再改一次");
  await wait();
  assert.ok(undo);
  await act(async () => undo());
  assert.equal(current.title, "修改后的标题");
  window.removeEventListener("cardspace-undo", listener);
  await view.close();
});
