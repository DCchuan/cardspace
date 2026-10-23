import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { api, post, Card, apiBlob } from "../api";
import { validBridge } from "./bridge";
import "./experience.css";
const active = [
  "queued",
  "planning",
  "generating",
  "compiling",
  "validating",
  "repairing",
  "cancel_requested",
];
const pending = [...active, "recovery_required", "usage_unconfirmed"];
const labels: Record<string, string> = {
  queued: "等待生成",
  planning: "整理知识关系",
  generating: "构建交互源码",
  compiling: "检查代码",
  validating: "验证演示",
  repairing: "修复代码",
  ready: "已就绪",
  failed: "生成失败",
  blocked: "资料暂不适用",
  budget_exceeded: "已达到本次预算",
  cancel_requested: "正在停止后续调用",
  cancelled: "已取消",
  recovery_required: "请求结果尚未确认",
  usage_unconfirmed: "服务未返回用量",
};
const errors: Record<string, string> = {
  BUDGET_EXCEEDED: "剩余额度不足，已停止后续请求。",
  USAGE_UNCONFIRMED: "服务未返回用量，预留额度仍保留；继续前需要你确认。",
  UNSUPPORTED_SOURCE: "资料不足以建立互动关系，请补充前提后重试。",
  COMPILE_FAILED: "源码未通过验证，已保留原记忆与已有演示。",
  CONTEXT_CHANGED: "生成期间资料已变化，请重新报价。",
  CONFIG_CHANGED: "模型配置已变化，请重新报价。",
  OUTPUT_TRUNCATED: "模型输出被截断，请调整目标或服务后重新报价。",
};
export function ExperienceButton({ card }: { card: Card }) {
  const s = card.experience_summary;
  const text = s?.artifact_id
    ? "打开演示"
    : s && active.includes(s.status)
      ? "正在生成…"
      : s && pending.includes(s.status)
        ? "查看生成状态"
        : "生成演示";
  return (
    <button
      type="button"
      className="experience-entry"
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("cardspace-experience", { detail: card }),
        );
      }}
    >
      <span aria-hidden="true">◇</span> {text}
      {s?.freshness === "stale" ? " · 来源已更新" : ""}
    </button>
  );
}
export function ExperienceHost({ configure }: { configure: () => void }) {
  const [card, setCard] = useState<Card | null>(null);
  useEffect(() => {
    const open = (e: Event) => setCard((e as CustomEvent).detail);
    window.addEventListener("cardspace-experience", open);
    return () => window.removeEventListener("cardspace-experience", open);
  }, []);
  return card
    ? createPortal(
        <Panel
          key={card.id}
          card={card}
          close={() => setCard(null)}
          configure={() => {
            setCard(null);
            configure();
          }}
        />,
        document.body,
      )
    : null;
}
function Frame({
  manifest,
  onSource,
}: {
  manifest: any;
  onSource: (id: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null),
    port = useRef<MessagePort | null>(null);
  const [error, setError] = useState(""),
    [reset, setReset] = useState(0);
  const runtime = useQuery({
    queryKey: ["experience-runtime"],
    queryFn: () => api("/experience-runtime"),
    staleTime: Infinity,
  });
  useEffect(
    () => () => {
      port.current?.close();
    },
    [],
  );
  function initialize() {
    port.current?.close();
    setError("");
    const channel = new MessageChannel(),
      instance = crypto.randomUUID(),
      nonce = crypto.randomUUID();
    port.current = channel.port1;
    let count = 0,
      windowStart = Date.now();
    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) setError("演示没有响应，请重置后重试。");
    }, 5000);
    channel.port1.onmessage = (e) => {
      if (Date.now() - windowStart > 1000) {
        count = 0;
        windowStart = Date.now();
      }
      if (++count > 120) {
        channel.port1.close();
        setError("演示消息过于频繁，请重置。");
        return;
      }
      if (
        !validBridge(
          e.data,
          instance,
          nonce,
          manifest.refs.map((r: any) => r.ref_id),
        )
      )
        return;
      if (e.data.type === "READY") {
        ready = true;
        clearTimeout(timeout);
      }
      if (e.data.type === "SAVE_STATE") {
        try {
          sessionStorage.setItem(
            "experience-state:" + manifest.artifact_id,
            JSON.stringify(e.data.payload.snapshot),
          );
        } catch {
          /* Browser quota does not affect artifacts. */
        }
      }
      if (e.data.type === "OPEN_SOURCE")
        onSource(e.data.payload.ref_id as string);
      if (e.data.type === "RUNTIME_ERROR")
        setError("演示暂时中断，可重置后继续。");
    };
    let snapshot = null;
    try {
      snapshot = JSON.parse(
        sessionStorage.getItem("experience-state:" + manifest.artifact_id) ||
          "null",
      );
    } catch {
      /* Ignore invalid local state. */
    }
    frame.current?.contentWindow?.postMessage(
      {
        snapshot,
        embedded: true,
        protocol: "experience-bridge.v1",
        type: "INIT",
        instance_id: instance,
        nonce,
        spec: manifest.spec,
        refs: manifest.refs.map((r: any) => r.ref_id),
      },
      "*",
      [channel.port2],
    );
  }
  if (manifest.runtime_compatible === false)
    return (
      <p className="experience-notice">
        演示使用的运行时与本次构建不同。请在「查看与修改源码」中本地重新编译，不消耗模型
        Token。
      </p>
    );
  if (runtime.isError) return <p role="alert">{runtime.error.message}</p>;
  return (
    <>
      {error && (
        <div className="experience-notice" role="alert">
          {error}
          <button
            onClick={() => {
              sessionStorage.removeItem(
                "experience-state:" + manifest.artifact_id,
              );
              setReset((x) => x + 1);
            }}
          >
            重置演示
          </button>
        </div>
      )}
      {runtime.data && (
        <iframe
          key={manifest.artifact_id + ":" + reset}
          ref={frame}
          title={manifest.spec.title + "交互演示"}
          sandbox="allow-scripts"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          referrerPolicy="no-referrer"
          srcDoc={runtime.data.html}
          onLoad={initialize}
        />
      )}
    </>
  );
}
function Panel({
  card,
  close,
  configure,
}: {
  card: Card;
  close: () => void;
  configure: () => void;
}) {
  const client = useQueryClient(),
    root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [quote, setQuote] = useState<any>(null),
    [newVersion, setNewVersion] = useState(false),
    [pane, setPane] = useState(""),
    [source, setSource] = useState(""),
    [selected, setSelected] = useState(""),
    [selectedRef, setSelectedRef] = useState("");
  const [goal, setGoal] = useState(""),
    [mode, setMode] = useState(
      /产品|订单|原型|应用/.test(card.title) ? "prototype" : "explainer",
    ),
    [original, setOriginal] = useState(!!card.conversation_id),
    [evidence, setEvidence] = useState(false),
    [memory, setMemory] = useState("");
  const [maxTokens, setMaxTokens] = useState(30000),
    [calls, setCalls] = useState(4),
    [repairs, setRepairs] = useState(2),
    [advanced, setAdvanced] = useState(false),
    [includeSources, setIncludeSources] = useState(false),
    [confirm, setConfirm] = useState(false);
  const key = useRef(crypto.randomUUID());
  const list = useQuery<any[]>({
    queryKey: ["experiences", card.id],
    queryFn: () => api("/cards/" + card.id + "/experiences"),
    refetchInterval: (q) => {
      const r = q.state.data?.[0]?.latest_run;
      return r && active.includes(r.status) ? 1200 : false;
    },
  });
  const current = list.data?.[0],
    run = current?.latest_run;
  const aid = selected || current?.current_artifact_id;
  const manifest = useQuery({
    queryKey: ["experience-artifact", aid],
    queryFn: () => api("/experience-artifacts/" + aid + "/manifest"),
    enabled: !!aid,
  });
  const memories = useQuery({
    queryKey: ["experience-memories", card.conversation_id],
    queryFn: () => api("/conversations/" + card.conversation_id),
    enabled: advanced && !!card.conversation_id,
  });
  const showingQuote =
    !!quote || newVersion || (!aid && !(run && pending.includes(run.status)));
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    return () => {
      document.body.style.overflow = old;
      if (prior?.isConnected) prior.focus();
    };
  }, []);
  useEffect(() => {
    if (run?.status === "ready") {
      setNewVersion(false);
      setQuote(null);
      setSelected("");
      client.invalidateQueries({ queryKey: ["cards"] });
      client.invalidateQueries({ queryKey: ["card", card.id] });
    }
  }, [run?.status]);
  function trap(e: React.KeyboardEvent) {
    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
      e.stopPropagation();
      close();
    }
    if (e.key === "Tab") {
      const nodes = Array.from(
        root.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input,textarea,select,a[href],iframe,summary",
        ) || [],
      ).filter((n) => n.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === root.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  async function perform(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
      await list.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function invalidateQuote() {
    setQuote(null);
    setConfirm(false);
    key.current = crypto.randomUUID();
  }
  async function prepare() {
    await perform(async () => {
      const latest = await api<Card>("/cards/" + card.id);
      setQuote(
        await post("/cards/" + card.id + "/experience-quotes", {
          expected_revision_id: latest.current_revision_id,
          mode,
          goal,
          scope: {
            selection: "current_card",
            include_original_questions: original,
            include_linked_evidence: evidence,
            memory_id: memory || null,
          },
          budget_policy: {
            max_calls: calls,
            max_repairs: repairs,
            max_total_tokens: maxTokens,
            accounting_mode: "estimated",
          },
        }),
      );
      key.current = crypto.randomUUID();
      setConfirm(false);
    });
  }
  async function generate() {
    await perform(async () => {
      await api("/experience-quotes/" + quote.quote_id + "/generate", {
        method: "POST",
        headers: { "Idempotency-Key": key.current },
        body: JSON.stringify({
          accept_model_fingerprint: quote.model_config_fingerprint,
          accept_context_fingerprint: quote.context_fingerprint,
          accept_budget_mode: quote.accounting_mode,
          base_artifact_id: current?.current_artifact_id || null,
        }),
      });
      setNewVersion(false);
      setQuote(null);
    });
  }
  async function loadSource() {
    await perform(async () => {
      const file = manifest.data.files.find(
        (x: any) => x.path === "experience.tsx",
      );
      const blob = await apiBlob(
        "/experience-artifacts/" + aid + "/files/" + file.id,
      );
      setSource(await blob.text());
      setPane("source");
    });
  }
  async function exportFile() {
    await perform(async () => {
      const blob = await apiBlob("/experience-artifacts/" + aid + "/exports", {
        method: "POST",
        body: JSON.stringify({ include_sources: includeSources }),
        headers: { "Content-Type": "application/json" },
      });
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "cardspace-experience.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  return (
    <div
      className="experience-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="experience-panel"
        role="dialog"
        aria-modal="true"
        aria-label="交互演示"
        tabIndex={-1}
        ref={root}
        onKeyDown={trap}
      >
        <header>
          <div>
            <small>交互演示</small>
            <h2>{manifest.data?.spec.title || card.title}</h2>
          </div>
          <nav>
            {aid && (
              <button
                onClick={() => setPane(pane === "sources" ? "" : "sources")}
              >
                查看依据
              </button>
            )}
            {aid && (
              <details>
                <summary aria-label="演示更多操作">⋯</summary>
                <div className="experience-menu">
                  <button
                    onClick={() => {
                      setNewVersion(true);
                      invalidateQuote();
                      setGoal("");
                      setPane("");
                    }}
                  >
                    修改要求／重新生成
                  </button>
                  <button onClick={loadSource}>查看与修改源码</button>
                  <button onClick={() => setPane("versions")}>版本</button>
                  <button onClick={() => setPane("export")}>导出离线包</button>
                </div>
              </details>
            )}
            <button aria-label="关闭演示" onClick={close}>
              ×
            </button>
          </nav>
        </header>
        {error && (
          <p className="experience-notice" role="alert">
            {error}
          </p>
        )}
        {list.isError && (
          <p role="alert">
            {list.error.message}
            <button onClick={() => list.refetch()}>重试</button>
          </p>
        )}
        {current?.freshness === "stale" && (
          <p className="experience-notice">
            来源已更新。本演示保留生成时的原文版本，重新生成需再次授权。
          </p>
        )}
        {run && run.status !== "ready" && (
          <section className="experience-progress" aria-live="polite">
            <strong>{labels[run.status] || run.status}</strong>
            <p>
              {errors[run.error_code] ||
                (run.status === "recovery_required"
                  ? "上次请求可能已计费，系统没有自动重发。"
                  : active.includes(run.status)
                    ? "正在按本次授权处理，关闭面板不取消任务。"
                    : "原记忆与已有演示仍保留。")}
            </p>
            {run.checkpoint?.plan?.missing?.map((reason: string) => (
              <p key={reason}>{reason}</p>
            ))}
            <small>
              请求 {run.budget.calls}/{run.budget_policy.max_calls} · 已知{" "}
              {run.budget.known_tokens.toLocaleString()} Token
              {run.budget.has_unconfirmed_usage ? " · 含未确认预留额度" : ""}
            </small>
            {active.includes(run.status) && (
              <button
                disabled={busy}
                onClick={() =>
                  perform(async () => {
                    await post("/experience-runs/" + run.id + "/cancel");
                  })
                }
              >
                取消生成
              </button>
            )}
            {["recovery_required", "usage_unconfirmed"].includes(
              run.status,
            ) && (
              <details>
                <summary>处理未确认请求</summary>
                <label>
                  <input
                    type="checkbox"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  我了解之前的请求可能已计费，继续将使用剩余预算
                </label>
                <button
                  disabled={!confirm || busy}
                  onClick={() =>
                    perform(async () => {
                      await post("/experience-runs/" + run.id + "/resume", {
                        confirm_unknown_charges: true,
                      });
                    })
                  }
                >
                  确认继续
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      await post("/experience-runs/" + run.id + "/cancel");
                    })
                  }
                >
                  结束本次任务
                </button>
              </details>
            )}
          </section>
        )}
        {showingQuote && !list.isLoading && (
          <section className="experience-consent">
            <h3>{newVersion ? "修改这份演示" : "生成交互演示"}</h3>
            <p>
              从本卡片的内容中建立可操作的关系。先准备范围，再由你决定是否调用模型。
            </p>
            <label>
              希望理解或展示什么？
              <textarea
                aria-label="演示目标"
                value={goal}
                placeholder="自动围绕卡片的核心关系生成，可补充你的要求"
                onChange={(e) => {
                  setGoal(e.target.value);
                  invalidateQuote();
                }}
                maxLength={2000}
              />
            </label>
            <button
              className="experience-text"
              onClick={() => setAdvanced(!advanced)}
            >
              {advanced ? "收起调整" : "调整用途、资料与预算"}
            </button>
            {advanced && (
              <div className="experience-options">
                <label>
                  用途
                  <select
                    value={mode}
                    onChange={(e) => {
                      setMode(e.target.value);
                      invalidateQuote();
                    }}
                  >
                    <option value="explainer">交互讲解</option>
                    <option value="prototype">产品原型</option>
                  </select>
                </label>
                {card.conversation_id && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={original}
                        onChange={(e) => {
                          setOriginal(e.target.checked);
                          invalidateQuote();
                        }}
                      />
                      使用选中的原始问答；关闭后仅用当前正文
                    </label>
                    {original && (
                      <label>
                        选择问题
                        <select
                          value={memory}
                          onChange={(e) => {
                            setMemory(e.target.value);
                            invalidateQuote();
                          }}
                        >
                          <option value="">自动选择最近一个问题</option>
                          {memories.data?.memories?.map((m: any) => (
                            <option key={m.id} value={m.id}>
                              {m.original_question}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={evidence}
                    onChange={(e) => {
                      setEvidence(e.target.checked);
                      invalidateQuote();
                    }}
                  />
                  附带已关联的参考片段（最多五段）
                </label>
                <label>
                  本次估算预算
                  <input
                    type="number"
                    min={2000}
                    max={100000}
                    value={maxTokens}
                    onChange={(e) => {
                      setMaxTokens(Number(e.target.value));
                      invalidateQuote();
                    }}
                  />
                </label>
                <label>
                  最多请求次数
                  <select
                    value={calls}
                    onChange={(e) => {
                      setCalls(Number(e.target.value));
                      invalidateQuote();
                    }}
                  >
                    {[2, 3, 4].map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  最多自动修复
                  <select
                    value={repairs}
                    onChange={(e) => {
                      setRepairs(Number(e.target.value));
                      invalidateQuote();
                    }}
                  >
                    {[0, 1, 2].map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {quote ? (
              <>
                <div className="experience-quote">
                  <strong>{quote.model.model || "尚未配置模型"}</strong>
                  <p>{quote.model.base_url}</p>
                  <p>
                    {quote.content_chars.toLocaleString()} 字 ·{" "}
                    {quote.context.refs.length} 个片段 · 本地估算{" "}
                    {quote.token_estimate.low.toLocaleString()}–
                    {quote.token_estimate.high.toLocaleString()} Token
                  </p>
                  <p>
                    本次预算{" "}
                    {quote.budget_policy.max_total_tokens.toLocaleString()}{" "}
                    Token（估算模式），最多 {quote.budget_policy.max_calls}{" "}
                    次请求，含最多 {quote.budget_policy.max_repairs} 次修复。
                  </p>
                  <small>{quote.notice}</small>
                  <details>
                    <summary>查看本次将发送的内容</summary>
                    {quote.context.refs.map((r: any) => (
                      <section key={r.ref_id}>
                        <small>
                          {r.ref_id} · {r.kind} · {r.object_id}
                        </small>
                        <pre>{r.quote}</pre>
                      </section>
                    ))}
                    {quote.previous_source && (
                      <details>
                        <summary>同时发送上一个成功版本的源码</summary>
                        <pre>{quote.previous_source}</pre>
                      </details>
                    )}
                    {quote.context.warnings.map((s: string) => (
                      <p key={s}>{s}</p>
                    ))}
                  </details>
                </div>
                {quote.blocked_reason ? (
                  <>
                    <p>{quote.blocked_reason}</p>
                    <button onClick={configure}>配置模型</button>
                  </>
                ) : (
                  <>
                    <label className="experience-accept">
                      <input
                        type="checkbox"
                        checked={confirm}
                        onChange={(e) => setConfirm(e.target.checked)}
                      />
                      我同意将以上片段发送给所示模型，并接受估算预算与修复范围
                    </label>
                    <button
                      className="experience-primary"
                      disabled={!confirm || busy}
                      onClick={generate}
                    >
                      {busy ? "正在提交…" : "生成演示"}
                    </button>
                  </>
                )}
              </>
            ) : (
              <button
                className="experience-primary"
                disabled={busy}
                onClick={prepare}
              >
                {busy ? "正在准备…" : "准备演示 · 不调用模型"}
              </button>
            )}
            {newVersion && (
              <button
                onClick={() => {
                  setNewVersion(false);
                  setQuote(null);
                }}
              >
                返回已有演示
              </button>
            )}
            {!aid && (
              <details>
                <summary>使用已有源码（不消耗模型 Token）</summary>
                <textarea
                  className="experience-code"
                  aria-label="导入演示源码"
                  value={source}
                  placeholder="粘贴符合 CardSpace SDK 的 experience.tsx"
                  onChange={(e) => setSource(e.target.value)}
                />
                <button
                  disabled={busy || !source}
                  onClick={() =>
                    perform(async () => {
                      const latest = await api<Card>("/cards/" + card.id);
                      const r = await post(
                        "/cards/" + card.id + "/experience-sources",
                        {
                          source,
                          expected_revision_id: latest.current_revision_id,
                          expected_current_artifact_id: null,
                        },
                      );
                      setSelected(r.artifact_id);
                      setQuote(null);
                      setNewVersion(false);
                    })
                  }
                >
                  编译并保存
                </button>
              </details>
            )}
          </section>
        )}
        {aid && manifest.data && !showingQuote && (
          <>
            <Frame
              manifest={manifest.data}
              onSource={(id) => {
                setSelectedRef(id);
                setPane("sources");
              }}
            />
            {pane === "sources" && (
              <section className="experience-side">
                <h3>原文依据 · {manifest.data.source_revision_id}</h3>
                <p>引用指向生成时的原文快照，不代表事实已经核验。</p>
                {manifest.data.refs.map((r: any) => (
                  <article
                    key={r.ref_id}
                    className={selectedRef === r.ref_id ? "selected" : ""}
                  >
                    <small>
                      {r.ref_id} · {r.kind} · {r.object_id} · 字符{" "}
                      {r.start_char}–{r.end_char}
                    </small>
                    <pre>{r.quote}</pre>
                    <button
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent("cardspace-experience-source", {
                            detail: {
                              card_id: card.id,
                              conversation_id: manifest.data.conversation_id,
                              message_id:
                                r.kind === "message" ? r.object_id : undefined,
                            },
                          }),
                        );
                        close();
                      }}
                    >
                      打开记忆原文
                    </button>
                  </article>
                ))}
              </section>
            )}
            {pane === "versions" && (
              <section className="experience-side">
                <h3>演示版本</h3>
                {current.artifacts.map((a: any) => (
                  <div className="experience-version" key={a.id}>
                    <button
                      onClick={() => {
                        setSelected(a.id);
                        setPane("");
                      }}
                    >
                      版本 {a.version} ·{" "}
                      {a.author_type === "model"
                        ? "AI 生成"
                        : a.author_type === "agent"
                          ? "Agent 候选"
                          : "人工修改"}
                    </button>
                    {a.id === current.current_artifact_id ? (
                      <span>当前版本</span>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() =>
                          perform(async () => {
                            await post(
                              "/experiences/" + current.id + "/activate",
                              {
                                artifact_id: a.id,
                                expected_current_artifact_id:
                                  current.current_artifact_id,
                              },
                            );
                            setSelected("");
                            client.invalidateQueries({ queryKey: ["cards"] });
                          })
                        }
                      >
                        设为当前版本
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
            {pane === "source" && (
              <section className="experience-side">
                <h3>修改源码 · 本地编译</h3>
                <p>保存产生新的版本，当前版本保留。不调用模型。</p>
                <textarea
                  className="experience-code"
                  aria-label="演示源码"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      const r = await post(
                        "/experiences/" + current.id + "/source-versions",
                        { source, base_artifact_id: aid },
                      );
                      setSelected(r.artifact_id);
                      setPane("");
                    })
                  }
                >
                  编译并保存新版本
                </button>
              </section>
            )}
            {pane === "export" && (
              <section className="experience-side">
                <h3>导出离线演示</h3>
                <p>
                  包含源码、规范、可信运行时与许可，解压后打开
                  index.html。演示内容可能包含你的私人知识，请自行决定分享范围。
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={includeSources}
                    onChange={(e) => setIncludeSources(e.target.checked)}
                  />
                  附带原文摘录（默认不附带）
                </label>
                <button disabled={busy} onClick={exportFile}>
                  下载离线包
                </button>
              </section>
            )}
          </>
        )}
        {manifest.isError && <p role="alert">{manifest.error.message}</p>}
      </div>
    </div>
  );
}
