import { test } from "node:test";
import assert from "node:assert/strict";
import { api, reconnect, ApiError } from "../../apps/web/src/api";
function response(status = 200, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

test("过期会话只重新建立一次，并在重试时保留写入请求", async () => {
  let sessions = 0,
    writes = 0,
    expired = false;
  const bodies: string[] = [];
  globalThis.fetch = async (url: any, options: any = {}) => {
    assert.equal(options.credentials, "same-origin");
    if (String(url).endsWith("/session")) {
      sessions++;
      expired = false;
      return response();
    }
    writes++;
    bodies.push(options.body);
    return expired ? response(401) : response(200, { saved: true });
  };
  await reconnect();
  expired = true;
  const body = JSON.stringify({ content: "尚未保存的输入" });
  assert.deepEqual(await api("/notes", { method: "POST", body }), {
    saved: true,
  });
  assert.equal(sessions, 2);
  assert.equal(writes, 2);
  assert.deepEqual(bodies, [body, body]);
});

test("并发的过期请求共享一次会话续期", async () => {
  let sessions = 0,
    expired = false;
  let finished = 0;
  let release: () => void;
  const bothExpired = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (url: any) => {
    if (String(url).endsWith("/session")) {
      sessions++;
      expired = false;
      return response();
    }
    if (expired) {
      finished++;
      if (finished === 2) release();
      await bothExpired;
      return response(401);
    }
    return response(200, { items: [] });
  };
  await reconnect();
  expired = true;
  await Promise.all([api("/cards"), api("/settings")]);
  assert.equal(sessions, 2);
});

test("握手 HTTP 失败不能当作已连接，下一次可以重新建立", async () => {
  let sessions = 0,
    reads = 0;
  globalThis.fetch = async (url: any) => {
    if (String(url).endsWith("/session")) {
      sessions++;
      return response(sessions === 1 ? 503 : 200);
    }
    reads++;
    return response();
  };
  await assert.rejects(
    reconnect(),
    (error: any) => error instanceof ApiError && error.status === 503,
  );
  await api("/cards");
  assert.equal(sessions, 2);
  assert.equal(reads, 1);
});

test("续期后仍未授权时停止重试，手动重新连接能恢复", async () => {
  let sessions = 0,
    reads = 0;
  let rejected = true;
  globalThis.fetch = async (url: any) => {
    if (String(url).endsWith("/session")) {
      sessions++;
      return response();
    }
    reads++;
    return response(rejected ? 401 : 200, { items: [] });
  };
  await reconnect();
  await assert.rejects(
    api("/cards"),
    (error: any) => error.status === 401 && !error.message.includes("Bearer"),
  );
  assert.equal(sessions, 2);
  assert.equal(reads, 2);
  rejected = false;
  await reconnect();
  assert.deepEqual(await api("/cards"), { items: [] });
  assert.equal(sessions, 3);
});

test("403 权限错误不重复提交，取消的请求不触发续期", async () => {
  let sessions = 0,
    reads = 0;
  globalThis.fetch = async (url: any) => {
    if (String(url).endsWith("/session")) {
      sessions++;
      return response();
    }
    reads++;
    return response(403, { detail: "需要用户操作" });
  };
  await reconnect();
  await assert.rejects(api("/cards"), (error: any) => error.status === 403);
  assert.equal(reads, 1);
  assert.equal(sessions, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    api("/cards", { signal: controller.signal }),
    (error: any) => error.name === "AbortError",
  );
  assert.equal(reads, 1);
  assert.equal(sessions, 1);
});
