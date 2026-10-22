import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Upload,
  Loader2,
  ArrowRight,
  Pencil,
  RotateCcw,
  Check,
  AlertCircle,
} from "lucide-react";
import { api, post, patch, Card } from "./api";

export function undoNotice(message: string, undo: () => Promise<void>) {
  window.dispatchEvent(
    new CustomEvent("cardspace-undo", { detail: { message, undo } }),
  );
}
const labels: Record<string, string> = {
  title: "标题",
  summary: "摘要",
  tags: "主题",
  content: "正文",
  source_label: "来源名称",
};
function stored(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function persist(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Saving to the server remains available when browser storage is full. */
  }
}

export function CaptureComposer({
  close,
  done,
}: {
  close: () => void;
  done: (id?: string) => void;
}) {
  const client = useQueryClient();
  const [text, setText] = useState<string>(
    () => stored("cardspace-capture-draft") || "",
  );
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [receipts, setReceipts] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null),
    root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    input.current?.focus();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
      prior?.focus();
    };
  }, []);
  useEffect(() => persist("cardspace-capture-draft", text), [text]);
  useEffect(() => {
    if (!receipts.some((r) => ["saved", "processing"].includes(r.status)))
      return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const results = await Promise.all(
          receipts.map((r) => api("/captures/" + r.id)),
        );
        if (active) {
          setReceipts(results);
          client.invalidateQueries();
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }, 1200);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [receipts.map((r) => r.id + ":" + r.status).join("|")]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (text.trim()) {
        const saved = await post("/captures", { content: text });
        setReceipts((prev) => [saved, ...prev]);
        setText("");
        persist("cardspace-capture-draft", null);
      }
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const saved = await api("/captures/file", {
          method: "POST",
          body: form,
        });
        setReceipts((prev) => [...prev, saved]);
        setFiles((prev) => prev.filter((item) => item !== file));
      }
      client.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal capture-composer"
        role="dialog"
        aria-modal="true"
        aria-label="新建记忆"
        ref={root}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const all = Array.from(
              root.current?.querySelectorAll<HTMLElement>(
                "button:not([disabled]),textarea,input:not([hidden]),a[href]",
              ) || [],
            );
            if (e.shiftKey && document.activeElement === all[0]) {
              e.preventDefault();
              all.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === all.at(-1)) {
              e.preventDefault();
              all[0]?.focus();
            }
          }
        }}
      >
        <div className="modal-heading">
          <h2>新建记忆</h2>
          <button className="icon-btn" aria-label="关闭录入" onClick={close}>
            <X size={19} />
          </button>
        </div>
        <div
          className="modal-body"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
          }}
        >
          <textarea
            ref={input}
            className="capture-input"
            aria-label="记录内容"
            placeholder={"写点什么，粘贴对话或分享链接…\n也可以拖入文件"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                (e.metaKey || e.ctrlKey) &&
                e.key === "Enter" &&
                !e.nativeEvent.isComposing &&
                !busy &&
                (text.trim() || files.length)
              )
                save();
            }}
            rows={7}
          />
          {files.map((file, i) => (
            <div className="staged-file" key={i}>
              <span>{file.name}</span>
              <button
                className="icon-btn"
                aria-label={"移除附件 " + file.name}
                onClick={() =>
                  setFiles(files.filter((_, index) => index !== i))
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {error && (
            <p className="error-inline" role="alert">
              {error}。未提交的内容仍保留在输入区。
            </p>
          )}
          {receipts.map((r) => (
            <Receipt
              key={r.id}
              receipt={r}
              open={done}
              retry={async () => {
                await post("/captures/" + r.id + "/retry");
                setReceipts((prev) =>
                  prev.map((item) =>
                    item.id === r.id
                      ? { ...item, status: "saved", error: null }
                      : item,
                  ),
                );
              }}
              supplement={() => input.current?.focus()}
            />
          ))}
        </div>
        <div className="modal-footer">
          <div>
            <button
              className="btn"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload size={15} />
              附件
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept=".json,.txt,.md,.markdown,.pdf,.docx"
              onChange={(e) => {
                setFiles((prev) => [
                  ...prev,
                  ...Array.from(e.target.files || []),
                ]);
                e.target.value = "";
              }}
            />
          </div>
          <button
            className="btn primary"
            disabled={busy || (!text.trim() && !files.length)}
            onClick={save}
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
function Receipt({
  receipt: r,
  open,
  retry,
  supplement,
}: {
  receipt: any;
  open: (id?: string) => void;
  retry: () => Promise<void>;
  supplement: () => void;
}) {
  const active = ["saved", "processing"].includes(r.status);
  const [err, setErr] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const client = useQueryClient();
  if (dismissed) return null;
  return (
    <div className="capture-receipt" role="status">
      <div>
        {active ? (
          <Loader2 size={14} className="spin" />
        ) : r.status === "failed" ? (
          <AlertCircle size={14} />
        ) : (
          <Check size={14} />
        )}
        <b>
          {active
            ? "原始输入已保存，正在识别…"
            : r.status === "failed"
              ? "原始输入已保存，处理未完成"
              : r.route === "link"
                ? "链接已保存，未采集正文"
                : r.route === "json_note"
                  ? "已保存为笔记，未识别为对话"
                  : r.route === "document"
                    ? "已存入参考资料"
                    : r.status === "partial"
                      ? "已构建记忆，部分内容未取得"
                      : "已保存，内容可直接使用"}
        </b>
      </div>
      {r.cards?.map((card: any) => (
        <div className="receipt-preview" key={card.id}>
          <b>{card.title}</b>
          <p>{card.summary}</p>
        </div>
      ))}
      {r.filename && <small>{r.filename}</small>}
      {!!(r.error || r.result?.warnings?.length) && (
        <p>{r.error || r.result.warnings.join("；")}</p>
      )}
      {err && <p className="error-inline">{err}</p>}
      <div className="receipt-actions">
        {r.result?.card_ids?.map((id: string, i: number) => (
          <button className="text-btn" key={id} onClick={() => open(id)}>
            查看{r.result.card_ids.length > 1 ? " " + (i + 1) : ""}
            <ArrowRight size={13} />
          </button>
        ))}
        {r.result?.document_id && (
          <button
            className="text-btn"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("cardspace-document", {
                  detail: r.result.document_id,
                }),
              )
            }
          >
            查看资料
            <ArrowRight size={13} />
          </button>
        )}
        {r.status === "failed" && (
          <button
            className="text-btn"
            onClick={() => retry().catch((e) => setErr(e.message))}
          >
            重试
          </button>
        )}
        {["failed", "partial"].includes(r.status) && (
          <>
            <button className="text-btn" onClick={supplement}>
              粘贴原文
            </button>
            <a href={"/api/v1/captures/" + r.id + "/raw"} download>
              原始输入
            </a>
          </>
        )}
        {["failed", "partial"].includes(r.status) && (
          <button
            className="text-btn"
            onClick={async () => {
              try {
                await post("/captures/" + r.id + "/dismiss");
                setDismissed(true);
                client.invalidateQueries({ queryKey: ["captures"] });
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            暂不处理
          </button>
        )}
      </div>
    </div>
  );
}
export function PendingCaptures({
  open,
  capture,
}: {
  open: (id: string) => void;
  capture: () => void;
}) {
  const client = useQueryClient();
  const records = useQuery<any[]>({
    queryKey: ["captures"],
    queryFn: () => api("/captures"),
    refetchInterval: 3000,
  });
  const [expanded, setExpanded] = useState(false);
  const pending = records.data || [];
  if (!pending.length) return null;
  return (
    <details
      className="pending-captures"
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>
        {pending.filter((r) => r.status === "failed").length
          ? "有保存内容需要补充来源"
          : "最近录入"}{" "}
        <small>{pending.length}</small>
      </summary>
      <div>
        {pending.map((r) => (
          <Receipt
            key={r.id}
            receipt={r}
            open={(id) => {
              if (id) open(id);
            }}
            supplement={capture}
            retry={async () => {
              await post("/captures/" + r.id + "/retry");
              client.invalidateQueries({ queryKey: ["captures"] });
            }}
          />
        ))}
      </div>
    </details>
  );
}

export function InlineEditable({
  card: c,
  field,
  body = false,
  children,
}: {
  card: Card;
  field: string;
  body?: boolean;
  children?: React.ReactNode;
}) {
  const client = useQueryClient();
  const key = "cardspace-draft:" + c.id + ":" + field;
  const initial = stored(key);
  const value =
    (field === "tags" ? c.tags.join(", ") : (c as any)[field]) || "";
  const [editing, setEditing] = useState(!!initial),
    [draft, setDraft] = useState<string>(initial?.value ?? value),
    [status, setStatus] = useState(initial ? "本机有未提交草稿" : "");
  const [failed, setFailed] = useState(false),
    [saving, setSaving] = useState(false);
  const ref = useRef({
    value: initial?.value ?? value,
    saved: initial?.saved ?? value,
    staleDraft:
      !!initial &&
      initial.base !== c.current_revision_id &&
      initial.saved === undefined,
    base: initial?.base ?? c.current_revision_id,
    composing: false,
    inflight: false,
    dirty: !!initial,
    touched: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (!ref.current.dirty) {
      setDraft(value);
      ref.current = {
        ...ref.current,
        value,
        saved: value,
        base: c.current_revision_id,
      };
    }
  }, [value, c.current_revision_id, editing]);
  function stash() {
    persist(key, {
      value: ref.current.value,
      base: ref.current.base,
      saved: ref.current.saved,
    });
  }
  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1000);
  }
  async function save(rebase = false) {
    const state = ref.current;
    if (state.inflight || state.composing || !state.dirty) return;
    if ((field === "title" || field === "content") && !state.value.trim()) {
      setStatus("内容不能为空，草稿已保留");
      return;
    }
    state.inflight = true;
    setSaving(true);
    setStatus("保存中…");
    const submitted = state.value;
    const before = state.saved;
    let succeeded = false;
    try {
      let base = state.base;
      const current = await api<Card>("/cards/" + c.id);
      const currentValue =
        field === "tags"
          ? current.tags.join(", ")
          : (current as any)[field] || "";
      if (rebase || (!state.staleDraft && currentValue === state.saved))
        base = current.current_revision_id;
      const updated = await patch("/cards/" + c.id, {
        expected_revision_id: base,
        [field]:
          field === "tags"
            ? submitted
                .split(/[,，]/)
                .map((s: string) => s.trim())
                .filter(Boolean)
            : submitted,
      });
      state.staleDraft = false;
      state.base = updated.current_revision_id;
      state.saved = submitted;
      state.dirty = state.value !== submitted;
      succeeded = true;
      setFailed(false);
      setStatus(state.dirty ? "还有改动待保存" : "已保存");
      if (!state.dirty) persist(key, null);
      else stash();
      client.setQueryData(["card", c.id], updated);
      client.invalidateQueries({ queryKey: ["cards"] });
      client.invalidateQueries({ queryKey: ["revisions", c.id] });
      undoNotice(labels[field] + "已保存", async () => {
        await patch("/cards/" + c.id, {
          expected_revision_id: updated.current_revision_id,
          [field]:
            field === "tags"
              ? before
                  .split(/[,，]/)
                  .map((s: string) => s.trim())
                  .filter(Boolean)
              : before,
        });
        client.invalidateQueries();
      });
    } catch (e) {
      stash();
      setFailed(true);
      setStatus((e as Error).message + " 草稿已保留。");
    } finally {
      state.inflight = false;
      setSaving(false);
      if (state.dirty && succeeded && state.value !== submitted) schedule();
    }
  }
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (ref.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      if (timer.current) clearTimeout(timer.current);
      if (ref.current.dirty) {
        stash();
        if (ref.current.touched) void save();
      }
    };
  }, []);
  function change(value: string) {
    ref.current.touched = true;
    ref.current.value = value;
    ref.current.dirty = value !== ref.current.saved;
    setDraft(value);
    stash();
    setStatus("待保存");
    schedule();
  }
  if (!editing)
    return (
      <>
        {body && children}
        <div className={"inline-value inline-" + field}>
          <button
            className="inline-edit-trigger"
            aria-label={"修改" + labels[field]}
            onClick={() => {
              ref.current.base = c.current_revision_id;
              setEditing(true);
            }}
          >
            <span>
              {field === "tags"
                ? c.tags.length
                  ? c.tags.map((t) => "#" + t).join("  ")
                  : "添加主题"
                : body
                  ? "修改正文"
                  : value || "添加" + labels[field]}
            </span>
            <Pencil size={13} />
          </button>
        </div>
      </>
    );
  return (
    <div className={"inline-editor " + (body ? "body-editor" : "")}>
      <label>
        {labels[field]}
        <textarea
          ref={input}
          aria-label={"修改" + labels[field]}
          rows={body ? 16 : field === "summary" ? 3 : 1}
          value={draft}
          onChange={(e) => change(e.target.value)}
          onCompositionStart={() => {
            ref.current.composing = true;
            if (timer.current) clearTimeout(timer.current);
          }}
          onCompositionEnd={(e) => {
            ref.current.composing = false;
            change(e.currentTarget.value);
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              if (!ref.current.dirty) setEditing(false);
            }
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter" &&
              !e.nativeEvent.isComposing
            )
              void save();
          }}
        />
      </label>
      <div className="inline-save-status" role="status">
        <span>
          {saving && <Loader2 size={12} className="spin" />}
          {status || "改动将自动保存"}
        </span>
        {failed && (
          <button className="text-btn" onClick={() => save(true)}>
            以当前草稿重试
          </button>
        )}
        <button
          className="text-btn"
          disabled={saving || ref.current.dirty}
          onClick={() => setEditing(false)}
        >
          完成
        </button>
        {failed && (
          <button
            className="text-btn"
            onClick={() => {
              persist(key, null);
              ref.current.dirty = false;
              setEditing(false);
              setFailed(false);
            }}
          >
            放弃草稿
          </button>
        )}
      </div>
    </div>
  );
}

export function ReferenceCandidates({
  cardId,
  notify,
}: {
  cardId: string;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const items = useQuery<any[]>({
    queryKey: ["reference-candidates", cardId],
    queryFn: () => api("/cards/" + cardId + "/reference-candidates"),
  });
  return (
    <details className="reference-suggestions">
      <summary>
        候选参考 {items.data?.length ? `· ${items.data.length}` : ""}
      </summary>
      <p className="muted">匹配段落仅作参考，引用不代表结论已验证。</p>
      {items.isError ? (
        <p>资料暂不可用，请稍后重试。</p>
      ) : items.isLoading ? (
        <p>正在查找…</p>
      ) : items.data?.length ? (
        items.data.map((k) => (
          <div key={k.id} className="reference-candidate">
            <b>{k.document_title}</b>
            <small>{k.locator}</small>
            <p>{k.text}</p>
            <button
              className="text-btn"
              onClick={async () => {
                try {
                  await post("/evidence", { card_id: cardId, chunk_id: k.id });
                  client.invalidateQueries();
                  notify("已引用此段");
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              引用此段
            </button>
          </div>
        ))
      ) : (
        <p className="muted">
          还没有匹配段落。上传相关资料后会自动出现在这里。
        </p>
      )}
    </details>
  );
}

export function RegenerateField({
  card: c,
  field,
  notify,
}: {
  card: Card;
  field: string;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  return (
    <button
      className="text-btn"
      onClick={async () => {
        try {
          const result = await post("/cards/" + c.id + "/regenerate", {
            field,
            expected_revision_id: c.current_revision_id,
          });
          client.invalidateQueries();
          undoNotice("已重新生成" + labels[field], async () => {
            await patch("/cards/" + c.id, {
              expected_revision_id: result.current_revision_id,
              [field]: (c as any)[field],
            });
            client.invalidateQueries();
          });
        } catch (e) {
          notify((e as Error).message);
        }
      }}
    >
      <RotateCcw size={12} />
      重新生成{labels[field]}
    </button>
  );
}
