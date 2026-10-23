export type Card = {
  experience_summary?: {
    experience_id: string;
    artifact_id: string | null;
    run_id: string | null;
    status: string;
    freshness: string;
  } | null;
  id: string;
  title: string;
  source_label?: string;
  field_ownership?: Record<
    string,
    {
      owner: string;
      strategy: string;
      basis_revision_id: string;
      updated_at: string;
      rejected: string[];
    }
  >;
  summary: string;
  content?: string;
  tags: string[];
  card_type: string;
  color: string;
  favorite: boolean;
  archived: boolean;
  source_type: string;
  source_uri?: string;
  conversation_id?: string;
  current_revision_id: string;
  knowledge_status: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  related_cards?: { id: string; title: string }[];
  evidence?: any[];
  snapshots?: any[];
  matched_memories?: any[];
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
let ready: Promise<void> | null = null;
async function responseError(res: Response): Promise<ApiError> {
  if (res.status === 401)
    return new ApiError("本地连接已失效，请重新连接。", 401);
  let detail;
  try {
    detail = (await res.json()).detail;
  } catch {
    /* Non-JSON service errors. */
  }
  return new ApiError(
    typeof detail === "string" ? detail : `服务暂不可用 (${res.status})`,
    res.status,
  );
}
async function localFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch("/api/v1" + path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("无法连接本地服务，请确认应用已启动后重试。", 0);
  }
}
function session(): Promise<void> {
  if (!ready) {
    const attempt = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await localFetch("/session", {
          method: "POST",
          headers: { "X-CardSpace-Client": "web" },
          signal: controller.signal,
        });
        if (!res.ok) throw await responseError(res);
      } catch (error) {
        if ((error as Error).name === "AbortError")
          throw new ApiError("连接本地服务超时，请重试。", 0);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    })();
    ready = attempt;
    void attempt.catch(() => {
      if (ready === attempt) ready = null;
    });
  }
  return ready;
}
export async function reconnect(): Promise<void> {
  ready = null;
  await session();
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  options.signal?.throwIfAborted();
  let established = session();
  await established;
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const send = () => {
    options.signal?.throwIfAborted();
    return localFetch(path, { ...options, headers });
  };
  let res = await send();
  // A 401 is rejected by the authentication dependency before any mutation.
  // Renew once; concurrent expired requests share the same renewal attempt.
  if (res.status === 401) {
    if (ready === established) ready = null;
    options.signal?.throwIfAborted();
    established = session();
    await established;
    res = await send();
    if (res.status === 401 && ready === established) ready = null;
  }
  if (!res.ok) throw await responseError(res);
  return res.status === 204 ? (null as T) : res.json();
}
export const post = (path: string, body: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export const date = (value: string) =>
  new Date(value).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
  });
export const typeName: Record<string, string> = {
  note: "个人思考",
  conversation: "AI 对话",
  knowledge: "知识卡片",
  project: "项目主题",
};
export const sourceName: Record<string, string> = {
  note: "手动记录",
  pasted_chat: "粘贴对话",
  chatgpt: "ChatGPT",
  deepseek: "DeepSeek",
  document: "参考资料",
};

export async function apiBlob(
  path: string,
  options: RequestInit = {},
): Promise<Blob> {
  await session();
  let res = await localFetch(path, options);
  if (res.status === 401) {
    await reconnect();
    res = await localFetch(path, options);
  }
  if (!res.ok) throw await responseError(res);
  return res.blob();
}
