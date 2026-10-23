import { ExperienceButton, ExperienceHost } from "./experiences/Experience";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  MoreHorizontal,
  Layers,
  MessageSquare,
  Star,
  HeartPulse,
  BookOpen,
  Settings,
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  Check,
  CheckCircle2,
  X,
  Command,
  Clock3,
  Upload,
  FileText,
  Link,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Archive,
  Sparkles,
  Database,
  ShieldCheck,
  Download,
  ExternalLink,
  Activity,
  GitBranch,
  History,
  Quote,
  Copy,
  Play,
  RotateCcw,
  AlertCircle,
  Menu,
  Loader2,
  Network,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  api,
  post,
  patch,
  reconnect,
  Card,
  date,
  typeName,
  sourceName,
} from "./api";
import { WorkspaceSearch, NewMemoryButton } from "./navigation";
import "./styles.css";
import "./workspace.css";
import "./minimal.css";
import {
  CaptureComposer,
  InlineEditable,
  PendingCaptures,
  ReferenceCandidates,
  RegenerateField,
  undoNotice,
} from "./minimal";
const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
const nav = [
  { id: "home", name: "卡片", icon: Layers },
  { id: "conversations", name: "对话", icon: MessageSquare },
  { id: "favorites", name: "收藏", icon: Star },
];
const extra = [
  { id: "audits", name: "待确认", icon: HeartPulse },
  { id: "knowledge", name: "参考知识库", icon: BookOpen },
  { id: "jobs", name: "任务中心", icon: Activity },
];
const icons: Record<string, any> = {
  note: FileText,
  conversation: MessageSquare,
  knowledge: BookOpen,
  project: Layers,
};
function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
function App() {
  const client = useQueryClient();
  const [page, setPage] = useState("home");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("updated");
  const [source, setSource] = useState("");
  const [days, setDays] = useState("0");
  const [filters, setFilters] = useState(false);
  const [view, setView] = useState("grid");
  const [limit, setLimit] = useState(36);
  const [offset, setOffset] = useState(0);
  const [undo, setUndo] = useState<null | (() => Promise<void>)>(null);
  const [capture, setCapture] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [experienceJump, setExperienceJump] = useState<any>(null);
  useEffect(() => {
    const opening = () => setSelected(null);
    const source = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setExperienceJump(d);
      setSelected(d.card_id);
    };
    window.addEventListener("cardspace-experience", opening);
    window.addEventListener("cardspace-experience-source", source);
    return () => {
      window.removeEventListener("cardspace-experience", opening);
      window.removeEventListener("cardspace-experience-source", source);
    };
  }, []);
  const [toast, setToast] = useState("");
  const [mobile, setMobile] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  useEffect(() => {
    const show = (e: Event) => {
      setDocumentId((e as CustomEvent).detail);
      setPage("knowledge");
      setCapture(null);
    };
    window.addEventListener("cardspace-document", show);
    return () => window.removeEventListener("cardspace-document", show);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const notify = useCallback((s: string) => {
    setToast(s);
    setUndo(null);
  }, []);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setToast(detail.message);
      setUndo(() => detail.undo);
    };
    window.addEventListener("cardspace-undo", handler);
    return () => window.removeEventListener("cardspace-undo", handler);
  }, []);
  const refresh = () => client.invalidateQueries();
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 240);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), undo ? 12000 : 4500);
    return () => clearTimeout(t);
  }, [toast, undo]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && !e.isComposing) {
        setCapture(null);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    setLimit(36);
    setOffset(0);
  }, [search, kind, tag, page, source, days]);
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => api("/stats"),
    refetchInterval: 5000,
  });
  useEffect(() => {
    client.invalidateQueries({ queryKey: ["cards"] });
    client.invalidateQueries({ queryKey: ["card"] });
  }, [stats.data?.last_change]);
  const backgroundJobs = useQuery<any[]>({
    queryKey: ["jobs"],
    queryFn: () => api("/jobs"),
    refetchInterval: 2500,
  });
  const jobSignature = (backgroundJobs.data || [])
    .map((j) => j.id + ":" + j.status)
    .join("|");
  useEffect(() => {
    for (const key of ["cards", "card", "stats", "approvals", "findings"])
      client.invalidateQueries({ queryKey: [key] });
  }, [jobSignature]);

  const params = new URLSearchParams({
    q: search,
    kind: page === "conversations" ? "conversation" : kind,
    tag,
    sort,
    source,
    days,
    limit: String(Math.min(limit, 100)),
    offset: String(offset),
    favorite: String(page === "favorites"),
    archived: String(page === "archive"),
  });
  const cards = useQuery<{ items: Card[]; total: number }>({
    queryKey: ["cards", params.toString()],
    queryFn: ({ signal }) => api("/cards?" + params, { signal }),
    enabled: [
      "home",
      "cards",
      "conversations",
      "favorites",
      "archive",
    ].includes(page),
  });
  const supplement = useQuery<{ items: Card[] }>({
    queryKey: ["supplement", params.toString()],
    queryFn: ({ signal }) =>
      api("/search/supplement", {
        method: "POST",
        signal,
        body: JSON.stringify({
          ...Object.fromEntries(params),
          query: search,
          favorite: page === "favorites",
          archived: page === "archive",
        }),
      }),
    enabled:
      !!search &&
      offset === 0 &&
      ["home", "cards", "conversations", "favorites", "archive"].includes(page),
    staleTime: 300000,
    retry: false,
  });
  // Keep local matches in their original order. Semantic hits only append new cards.
  const visibleCards = [
    ...(cards.data?.items || []),
    ...(supplement.data?.items || []).filter(
      (c) => !cards.data?.items.some((local) => local.id === c.id),
    ),
  ];
  const go = (p: string) => {
    setPage(p);
    setQ("");
    setTag("");
    setKind("");
    setSource("");
    setDays("0");
    setMobile(false);
  };
  async function action(fn: () => Promise<any>, message: string) {
    try {
      await fn();
      refresh();
      notify(message);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const heading = search
    ? "找回你的记忆"
    : (
        {
          home: "记忆",
          cards: "全部卡片",
          conversations: "对话",
          favorites: "收藏",
          archive: "已归档",
          audits: "待确认",
          knowledge: "参考资料",
          jobs: "任务",
          settings: "设置",
        } as Record<string, string>
      )[page];
  const subtitle = search
    ? `正在搜索「${search}」 · 同时检索原始提问、回答与卡片内容`
    : (
        {
          home: "收集灵感，连接知识。这里是你与 AI 共同构建的第二记忆空间。",
          cards: "从一闪而过的灵感，到可以反复使用的知识。",
          conversations: "保留完整问答与原始上下文，让记忆有迹可循。",
          favorites: "那些想要反复阅读、反复思考的内容。",
          archive: "归档的内容依然安全保存，你随时可以恢复。",
          audits: "只在需要判断或采用正文建议时处理。",
          knowledge: "保存外部参考资料，为个人知识建立可追溯的引用。",
          jobs: "导入、整理与检查任务会保存在本地，支持失败重试。",
          settings: "本地存储、模型连接与数据管理，尽在你的掌握。",
        } as Record<string, string>
      )[page];
  return (
    <div className="app">
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
        >
          <span className="brand-mark">
            <i />
            <i />
          </span>
          <span>
            CardSpace<span className="brand-dot">.</span>
          </span>
        </a>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={
                page === n.id || (n.id === "home" && page === "cards")
                  ? "active"
                  : ""
              }
            >
              <n.icon size={18} />
              <span>{n.name}</span>
            </button>
          ))}
        </nav>
        <nav className="reference-nav">
          <button
            className={page === "knowledge" ? "active" : ""}
            onClick={() => go("knowledge")}
          >
            <BookOpen size={18} />
            参考资料
          </button>
        </nav>
        {!!stats.data?.tags?.length && (
          <details className="sidebar-topics">
            <summary>
              主题
              <ChevronDown size={13} />
            </summary>
            <div className="topics">
              {stats.data.tags.slice(0, 12).map((t: any) => (
                <button
                  key={t.name}
                  className={tag === t.name ? "topic selected" : "topic"}
                  onClick={() => {
                    go("cards");
                    setTag(t.name);
                  }}
                >
                  <span>#</span>
                  {t.name}
                </button>
              ))}
            </div>
          </details>
        )}
        <details
          className="advanced-nav"
          open={["audits", "jobs", "archive"].includes(page) || undefined}
        >
          <summary>
            更多
            <ChevronDown size={13} />
          </summary>
          <nav>
            {extra
              .filter((n) => n.id !== "knowledge")
              .map((n) => (
                <button
                  key={n.id}
                  className={page === n.id ? "active" : ""}
                  onClick={() => go(n.id)}
                >
                  <n.icon size={18} />
                  {n.name}
                  {n.id === "jobs" &&
                    (backgroundJobs.data || []).some((j) =>
                      ["queued", "running"].includes(j.status),
                    ) && <span className="live-dot" />}
                </button>
              ))}
            <button
              className={page === "archive" ? "active" : ""}
              onClick={() => go("archive")}
            >
              <Archive size={18} />
              已归档
            </button>
          </nav>
        </details>
        <div className="sidebar-bottom">
          <button
            onClick={() => go("settings")}
            className={"bottom-nav " + (page === "settings" ? "active" : "")}
          >
            <Settings size={17} />
            设置
          </button>
          <button className="workspace-status" onClick={() => go("settings")}>
            <span className="live-dot" />
            本地保存<span>·</span>MIT 开源
          </button>
        </div>
      </aside>
      {mobile && (
        <div className="mobile-scrim" onClick={() => setMobile(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-toggle"
              aria-label="打开导航"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="header-context">CardSpace</span>
          </div>
          <div className="top-actions">
            <WorkspaceSearch
              value={q}
              inputRef={searchRef}
              onChange={(value) => {
                setQ(value);
                if (
                  ![
                    "home",
                    "cards",
                    "conversations",
                    "favorites",
                    "archive",
                  ].includes(page)
                )
                  setPage("cards");
              }}
              onSearch={() => {
                setSearch(q.trim());
                if (
                  ![
                    "home",
                    "cards",
                    "conversations",
                    "favorites",
                    "archive",
                  ].includes(page)
                )
                  setPage("cards");
                client.invalidateQueries({ queryKey: ["cards"] });
              }}
            />
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1>{heading}</h1>
              {(![
                "home",
                "cards",
                "conversations",
                "favorites",
                "archive",
              ].includes(page) ||
                search) && <p>{subtitle}</p>}
            </div>
            <NewMemoryButton onClick={() => setCapture("note")} />
          </div>
          {["home", "cards", "conversations", "favorites", "archive"].includes(
            page,
          ) && (
            <>
              <div className="library-heading">
                <h2>
                  {search
                    ? "搜索结果"
                    : page === "home"
                      ? "全部"
                      : page === "favorites"
                        ? "收藏的卡片"
                        : page === "archive"
                          ? "归档卡片"
                          : "卡片"}
                  <span>
                    {(cards.data?.total || 0) +
                      visibleCards.filter(
                        (c) =>
                          !cards.data?.items.some((local) => local.id === c.id),
                      ).length}
                  </span>
                </h2>
                <button
                  className={"filter-btn " + (filters ? "selected" : "")}
                  onClick={() => setFilters(!filters)}
                  aria-expanded={filters}
                >
                  <SlidersHorizontal size={14} />
                  视图
                  {(kind || tag || source || days !== "0") && (
                    <span className="filter-dot" />
                  )}
                </button>
              </div>
              {filters && (
                <div className="expanded-filters view-options">
                  <label>
                    类型
                    <select
                      aria-label="筛选类型"
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="">全部类型</option>
                      {Object.entries(typeName).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    主题
                    <select
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                    >
                      <option value="">全部主题</option>
                      {stats.data?.tags?.map((t: any) => (
                        <option key={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    来源
                    <select
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="">全部来源</option>
                      {Object.entries(sourceName).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    时间
                    <select
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    >
                      <option value="0">全部时间</option>
                      <option value="7">最近7天</option>
                      <option value="30">最近30天</option>
                      <option value="365">最近一年</option>
                    </select>
                  </label>
                  <label>
                    排序
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="updated">最近更新</option>
                      <option value="created">创建时间</option>
                      <option value="title">标题顺序</option>
                    </select>
                  </label>
                  <div className="view-toggle">
                    <button
                      aria-label="卡片视图"
                      className={view === "grid" ? "on" : ""}
                      onClick={() => setView("grid")}
                    >
                      <LayoutGrid size={15} />
                    </button>
                    <button
                      aria-label="列表视图"
                      className={view === "list" ? "on" : ""}
                      onClick={() => setView("list")}
                    >
                      <List size={15} />
                    </button>
                  </div>
                  <button
                    className="text-btn"
                    onClick={() => {
                      setKind("");
                      setTag("");
                      setSource("");
                      setDays("0");
                    }}
                  >
                    重置
                  </button>
                </div>
              )}
              {page === "home" && (
                <PendingCaptures
                  open={setSelected}
                  capture={() => setCapture("note")}
                />
              )}
              {tag && (
                <div className="active-filter">
                  #{tag}
                  <button aria-label="清除主题筛选" onClick={() => setTag("")}>
                    <X size={12} />
                  </button>
                </div>
              )}
              {cards.isError ? (
                <ErrorState error={cards.error} retry={() => cards.refetch()} />
              ) : cards.isLoading ? (
                <div className="loading">
                  <Loader2 className="spin" size={22} />
                  正在打开你的记忆空间…
                </div>
              ) : visibleCards.length ? (
                <>
                  <div
                    className={view === "grid" ? "card-masonry" : "card-list"}
                  >
                    {visibleCards.map((c) => (
                      <MemoryCard
                        key={c.id}
                        card={c}
                        open={() => setSelected(c.id)}
                        favorite={() =>
                          action(
                            () =>
                              patch("/cards/" + c.id, {
                                expected_revision_id: c.current_revision_id,
                                favorite: !c.favorite,
                              }),
                            c.favorite ? "已取消收藏" : "已加入收藏",
                          )
                        }
                      />
                    ))}
                  </div>
                  {(offset > 0 ||
                    (cards.data?.total || 0) >
                      offset + Math.min(limit, 100)) && (
                    <div className="load-more">
                      {offset > 0 && (
                        <button
                          className="btn"
                          onClick={() => {
                            setOffset(Math.max(0, offset - 100));
                            setLimit(100);
                          }}
                        >
                          上一页
                        </button>
                      )}
                      {(cards.data?.total || 0) >
                        offset + Math.min(limit, 100) && (
                        <button
                          className="btn"
                          onClick={() => {
                            if (limit >= 100) {
                              setOffset(offset + 100);
                              setLimit(100);
                            } else setLimit(Math.min(limit + 24, 100));
                          }}
                        >
                          {limit >= 100 ? "下一页" : "加载更多卡片"}
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <Empty
                  icon={search ? Search : Layers}
                  title={search ? "这段记忆还没有被找到" : "还没有记录"}
                  text={
                    search
                      ? "试试更短的关键词，或换一种问法。"
                      : "导入 ChatGPT、DeepSeek 对话，或记下一段思考。"
                  }
                />
              )}
            </>
          )}
          {page === "audits" && (
            <AuditPage open={setSelected} notify={notify} />
          )}
          {page === "knowledge" && (
            <KnowledgePage
              open={setSelected}
              notify={notify}
              initialDocument={documentId}
            />
          )}
          {page === "jobs" && <JobsPage notify={notify} open={setSelected} />}
          {page === "settings" && <SettingsPage notify={notify} />}
        </main>
      </div>
      {capture && (
        <Capture
          initial={capture}
          close={() => setCapture(null)}
          notify={notify}
          done={(id?: string) => {
            refresh();
            setCapture(null);
            if (id) setSelected(id);
          }}
        />
      )}
      <ExperienceHost
        configure={() => {
          setSelected(null);
          setPage("settings");
        }}
      />
      {selected && (
        <CardDrawer
          key={selected + ":" + (experienceJump?.message_id || "")}
          id={selected}
          jumpConversation={
            experienceJump?.card_id === selected &&
            experienceJump?.conversation_id
              ? experienceJump.conversation_id
              : search
                ? cards.data?.items.find((c) => c.id === selected)
                    ?.matched_memories?.[0]?.conversation_id
                : undefined
          }
          jumpMessage={
            experienceJump?.card_id === selected && experienceJump?.message_id
              ? experienceJump.message_id
              : search
                ? cards.data?.items.find((c) => c.id === selected)
                    ?.matched_memories?.[0]?.message_ids?.[0]
                : undefined
          }
          close={() => {
            setSelected(null);
            setExperienceJump(null);
          }}
          open={setSelected}
          notify={notify}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          {undo && (
            <button
              className="text-btn"
              onClick={async () => {
                const action = undo;
                setUndo(null);
                try {
                  await action();
                  refresh();
                  setToast("已撤销");
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              撤销
            </button>
          )}
          <button aria-label="关闭通知" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function MemoryCard({
  card: c,
  open,
  favorite,
}: {
  card: Card;
  open: () => void;
  favorite: () => void;
}) {
  const Icon = icons[c.card_type] || FileText;
  return (
    <article
      className={"memory-card " + c.color}
      onClick={open}
      tabIndex={0}
      role="button"
      aria-label={"打开卡片：" + c.title}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <details
        className="card-more"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <summary aria-label="卡片更多操作">
          <MoreHorizontal size={17} />
        </summary>
        <div>
          <button onClick={favorite}>{c.favorite ? "取消收藏" : "收藏"}</button>
          <button onClick={open}>打开卡片</button>
        </div>
      </details>
      <h3>{c.title}</h3>
      <p className="card-summary">
        {c.summary || "打开卡片，继续这一次思考。"}
      </p>
      {c.matched_memories?.length ? (
        <div className="question-match">
          <Quote size={12} />
          <span>{c.matched_memories[0].original_question}</span>
        </div>
      ) : null}
      <div className="card-bottom">
        <span>
          <span
            className={
              "source-dot " +
              (c.source_type === "chatgpt"
                ? "gpt"
                : c.source_type === "deepseek"
                  ? "deepseek"
                  : "")
            }
          />
          {sourceName[c.source_type] || "本地记录"}
        </span>
        <ExperienceButton card={c} />
      </div>
    </article>
  );
}
function ErrorState({ error, retry }: { error: any; retry: () => unknown }) {
  const client = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  async function recover() {
    setConnecting(true);
    setConnectionError("");
    try {
      await reconnect();
      await client.invalidateQueries();
      await retry();
    } catch (error) {
      setConnectionError((error as Error).message);
    } finally {
      setConnecting(false);
    }
  }
  return (
    <div className="empty-state" role="status">
      <AlertCircle size={30} />
      <h3>暂时无法读取内容</h3>
      <p>{connectionError || error?.message || "请检查本地服务是否运行"}</p>
      <button className="btn" disabled={connecting} onClick={recover}>
        {connecting && <Loader2 size={15} className="spin" />}
        {connecting ? "正在连接…" : "重新连接"}
      </button>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: any;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Modal({
  children,
  close,
  wide = false,
}: {
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const root = ref.current;
    root?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Tab" && root) {
        const els = Array.from(
          root.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input,select,textarea,a[href]",
          ),
        );
        if (!els.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === root)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = old;
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={"modal " + (wide ? "modal-wide" : "")}
      >
        {children}
      </div>
    </div>
  );
}
function Capture({
  close,
  done,
}: {
  initial: string;
  close: () => void;
  notify: (s: string) => void;
  done: (id?: string) => void;
}) {
  return <CaptureComposer close={close} done={done} />;
}
function CardDrawer({
  id,
  jumpMessage,
  jumpConversation,
  close,
  open,
  notify,
}: {
  id: string;
  jumpMessage?: string;
  jumpConversation?: string;
  close: () => void;
  open: (id: string) => void;
  notify: (s: string) => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const root = drawerRef.current;
    root?.querySelector<HTMLButtonElement>("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(
          "button:not([disabled]),textarea,input,select,a[href],summary",
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !root.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !root.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      if (prior?.isConnected) prior.focus();
    };
  }, []);
  const client = useQueryClient();
  const [tab, setTab] = useState("read");

  const [busy, setBusy] = useState(false);

  const [optimize, setOptimize] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [instruction, setInstruction] = useState(
    "整理段落，提炼摘要。保留原有观点与不确定性，不增加事实。",
  );
  const [historyId, setHistoryId] = useState("");
  const [selectedMessage, setSelectedMessage] = useState("");
  const card = useQuery<Card>({
    queryKey: ["card", id],
    queryFn: () => api("/cards/" + id),
  });
  const conv = useQuery({
    queryKey: ["conversation", jumpConversation || card.data?.conversation_id],
    queryFn: () =>
      api("/conversations/" + (jumpConversation || card.data?.conversation_id)),
    enabled: !!card.data?.conversation_id && tab === "original",
  });
  const revisions = useQuery<any[]>({
    queryKey: ["revisions", id],
    queryFn: () => api("/cards/" + id + "/revisions"),
    enabled: tab === "history",
  });
  const related = useQuery<Card[]>({
    queryKey: ["related", id],
    queryFn: () => api("/cards/" + id + "/related"),
    enabled: tab === "related",
  });
  useEffect(() => {
    setTab(jumpMessage ? "original" : "read");

    setHistoryId("");
    setSelectedMessage(jumpMessage || "");
  }, [id, jumpMessage]);
  useEffect(() => {
    if (selectedMessage)
      setTimeout(
        () =>
          document
            .getElementById(selectedMessage)
            ?.scrollIntoView({ behavior: "smooth", block: "center" }),
        100,
      );
  }, [selectedMessage, conv.data]);
  async function perform(fn: () => Promise<any>, message: string) {
    setBusy(true);
    try {
      await fn();
      client.invalidateQueries();
      notify(message);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const c = card.data;
  const currentHistory = revisions.data?.find((r) => r.id === historyId);
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="卡片详情"
      >
        <header className="drawer-header">
          <span>
            <Layers size={16} />
            记忆详情
          </span>
          <div>
            <button className="icon-btn" aria-label="关闭详情" onClick={close}>
              <X size={20} />
            </button>
          </div>
        </header>
        {card.isError ? (
          <ErrorState error={card.error} retry={() => card.refetch()} />
        ) : !c ? (
          <div className="loading">
            <Loader2 className="spin" />
            正在读取…
          </div>
        ) : (
          <>
            <div className={"detail-intro " + c.color}>
              <span className="card-type">
                {typeName[c.card_type]}
                <span className="status-pill">
                  {{
                    unverified: "待验证",
                    draft: "草稿",
                    supported: "有支持证据",
                    contested: "存在争议",
                    outdated: "待更新",
                  }[c.knowledge_status] || c.knowledge_status}
                </span>
              </span>
              <InlineEditable key={id + "title"} card={c} field="title" />
              <InlineEditable key={id + "summary"} card={c} field="summary" />
              <div className="detail-meta">
                <span>{date(c.created_at)}</span>
                <span>·</span>
                <span>
                  {(c as any).source_label || sourceName[c.source_type]}
                </span>
                <span>·</span>
                <span>
                  {c.conversation_id
                    ? c.message_count + " 条原始消息"
                    : "个人记录"}
                </span>
              </div>
              <InlineEditable key={id + "tags"} card={c} field="tags" />
              <ExperienceButton card={c} />
            </div>
            <div className="drawer-body">
              <InlineEditable
                key={id + "content"}
                card={c}
                field="content"
                body
              >
                <Markdown>{c.content || ""}</Markdown>
              </InlineEditable>
              <details
                className="context-section"
                open={tab === "original"}
                onToggle={(e) => {
                  if (e.currentTarget.open) setTab("original");
                }}
              >
                <summary>原文与来源</summary>
                {tab === "original" && (
                  <>
                    <div className="section-title">
                      <h3>不可变的原始资料</h3>
                      <span>
                        <ShieldCheck size={14} />
                        已保留快照
                      </span>
                    </div>
                    {c.source_uri && (
                      <a
                        className="source-url"
                        href={
                          /^https:\/\//.test(c.source_uri)
                            ? c.source_uri
                            : undefined
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Link size={14} />
                        {c.source_uri}
                        <ExternalLink size={13} />
                      </a>
                    )}
                    {c.conversation_id ? (
                      conv.isError ? (
                        <ErrorState
                          error={conv.error}
                          retry={() => conv.refetch()}
                        />
                      ) : !conv.data ? (
                        <div className="loading">读取原文…</div>
                      ) : (
                        <>
                          {conv.data.warnings.map((w: string) => (
                            <p className="warning" key={w}>
                              {w}
                            </p>
                          ))}
                          <div className="question-index">
                            <h4>
                              <Quote size={14} />
                              这段对话中，你曾经问过
                            </h4>
                            {conv.data.memories.map((m: any) => (
                              <button
                                key={m.id}
                                onClick={() =>
                                  setSelectedMessage(m.message_ids[0])
                                }
                              >
                                {m.original_question}
                                <ArrowUpRight size={13} />
                              </button>
                            ))}
                          </div>
                          {conv.data.messages.map((m: any) => (
                            <div
                              id={m.id}
                              key={m.id}
                              className={
                                "conversation-message " +
                                m.role +
                                (selectedMessage === m.id ? " highlighted" : "")
                              }
                            >
                              <div className="message-label">
                                <span className="message-avatar">
                                  {m.role === "user" ? "你" : "✦"}
                                </span>
                                <b>
                                  {m.role === "user"
                                    ? "你的提问"
                                    : m.role === "assistant"
                                      ? c.source_type === "deepseek"
                                        ? "DeepSeek"
                                        : c.source_type === "chatgpt"
                                          ? "ChatGPT"
                                          : "AI 助手"
                                      : m.role}
                                </b>
                                <small>#{m.position + 1}</small>
                              </div>
                              <Markdown>{m.content}</Markdown>
                              {m.metadata?.thinking_content && (
                                <details className="thinking-content">
                                  <summary>查看原始思考片段</summary>
                                  <Markdown>
                                    {m.metadata.thinking_content}
                                  </Markdown>
                                </details>
                              )}
                              {m.parent_id &&
                                conv.data.messages[m.position - 1]?.id !==
                                  m.parent_id && (
                                  <small className="muted branch-label">
                                    <GitBranch size={11} />
                                    分支回复 · 接续第{" "}
                                    {conv.data.messages.findIndex(
                                      (x: any) => x.id === m.parent_id,
                                    ) + 1}{" "}
                                    条消息
                                  </small>
                                )}
                            </div>
                          ))}
                        </>
                      )
                    ) : (
                      <p className="muted">
                        这是直接录入的笔记。下方快照保存了未经修改的输入内容。
                      </p>
                    )}
                    <details className="field-provenance">
                      <summary>自动填充与人工接管</summary>
                      <dl>
                        {Object.entries(c.field_ownership || {}).map(
                          ([field, state]) => (
                            <React.Fragment key={field}>
                              <dt>
                                {(
                                  {
                                    title: "标题",
                                    summary: "摘要",
                                    content: "正文",
                                    tags: "主题",
                                    card_type: "类型",
                                    source_label: "显示来源",
                                  } as Record<string, string>
                                )[field] || field}
                              </dt>
                              <dd>
                                {state.owner === "human"
                                  ? "由你接管，自动处理会跳过"
                                  : state.owner === "model"
                                    ? "模型填充，可直接修改"
                                    : "规则填充，可直接修改"}
                                <small>
                                  {state.strategy} · {date(state.updated_at)}
                                </small>
                              </dd>
                            </React.Fragment>
                          ),
                        )}
                      </dl>
                    </details>
                    <div className="snapshot-list">
                      <h4>来源快照</h4>
                      {c.snapshots?.map((s) => (
                        <React.Fragment key={s.id}>
                          <a href={"/api/v1/snapshots/" + s.id} download>
                            <Database size={15} />
                            <span>
                              {date(s.captured_at)}
                              <small>SHA-256 · {s.hash.slice(0, 20)}…</small>
                            </span>
                            <Download size={16} />
                          </a>
                          {s.original_snapshot_id && (
                            <a
                              href={
                                "/api/v1/snapshots/" + s.original_snapshot_id
                              }
                              download
                            >
                              <Download size={14} />
                              下载此快照对应的完整原始 JSON 文件
                            </a>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </>
                )}
              </details>
              <details
                className="context-section"
                open={tab === "history"}
                onToggle={(e) => {
                  if (e.currentTarget.open) setTab("history");
                }}
              >
                <summary>版本历史</summary>
                {tab === "history" && (
                  <>
                    <div className="section-title">
                      <h3>每一次变化，都有记录</h3>
                      <span>{revisions.data?.length || 0} 个版本</span>
                    </div>
                    <div className="revision-list">
                      {revisions.data?.map((r) => (
                        <button
                          key={r.id}
                          className={historyId === r.id ? "selected" : ""}
                          onClick={() =>
                            setHistoryId(historyId === r.id ? "" : r.id)
                          }
                        >
                          <History size={17} />
                          <span>
                            <b>
                              {r.author_type === "human"
                                ? "手动编辑"
                                : r.author_type === "agent"
                                  ? "整理建议"
                                  : "导入记录"}
                            </b>
                            <small>
                              {new Date(r.created_at).toLocaleString("zh-CN")} ·{" "}
                              {r.status === "proposed"
                                ? "待审批"
                                : r.status === "rejected"
                                  ? "已拒绝"
                                  : "已保存"}
                            </small>
                          </span>
                          {r.id === c.current_revision_id ? (
                            <span className="status-pill">当前版本</span>
                          ) : (
                            <ChevronDown size={15} />
                          )}
                        </button>
                      ))}
                    </div>
                    {currentHistory && (
                      <div className="revision-preview">
                        <h3>{currentHistory.title}</h3>
                        {historyId !== c.current_revision_id && (
                          <Diff
                            before={c.content || ""}
                            after={currentHistory.content}
                          />
                        )}
                        <Markdown>{currentHistory.content}</Markdown>
                        {historyId !== c.current_revision_id &&
                          currentHistory.status === "accepted" && (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() =>
                                perform(
                                  () =>
                                    post(
                                      "/cards/" +
                                        id +
                                        "/revisions/" +
                                        historyId +
                                        "/restore",
                                      {
                                        expected_revision_id:
                                          c.current_revision_id,
                                      },
                                    ),
                                  "已恢复为新版本，历史记录仍保留",
                                )
                              }
                            >
                              <RotateCcw size={14} />
                              恢复此版本
                            </button>
                          )}
                      </div>
                    )}
                  </>
                )}
              </details>
              <details
                className="context-section"
                open={tab === "related"}
                onToggle={(e) => {
                  if (e.currentTarget.open) setTab("related");
                }}
              >
                <summary>关联与引用</summary>
                {tab === "related" && (
                  <>
                    <h3>已关联的知识</h3>
                    {c.related_cards?.length ? (
                      c.related_cards.map((r) => (
                        <div className="related-row" key={r.id}>
                          <button
                            className="text-btn"
                            onClick={() => open(r.id)}
                          >
                            <Network size={16} />
                            {r.title}
                          </button>
                          <button
                            className="icon-btn"
                            aria-label="取消关联"
                            onClick={() =>
                              perform(
                                () =>
                                  api("/cards/" + id + "/links/" + r.id, {
                                    method: "DELETE",
                                  }),
                                "已取消关联",
                              )
                            }
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        尚未建立关联。可以从下方发现相关知识。
                      </p>
                    )}
                    <h3>你可能还想起</h3>
                    {related.data?.length ? (
                      related.data.map((r) => (
                        <div key={r.id} className="related-row">
                          <button
                            className="text-btn"
                            onClick={() => open(r.id)}
                          >
                            {r.title}
                            <ArrowUpRight size={14} />
                          </button>
                          <button
                            className="btn small-btn"
                            onClick={() =>
                              perform(
                                () =>
                                  post("/cards/" + id + "/links", {
                                    target_card_id: r.id,
                                  }),
                                "已建立知识关联",
                              )
                            }
                          >
                            关联
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="muted">多记录一点，关联就会慢慢浮现。</p>
                    )}
                    <h3>参考与证据</h3>
                    {c.evidence?.length ? (
                      c.evidence.map((e) => (
                        <div className="evidence-block" key={e.id}>
                          <b>
                            <BookOpen size={14} />
                            {e.document_title}
                          </b>
                          <small>
                            {e.locator} · 参考引用，尚未核实支持关系
                          </small>
                          <p>{e.text}</p>
                          {e.claim_ref && <span>关联结论：{e.claim_ref}</span>}
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        前往参考知识库，打开资料并将原文段落关联到这张卡片。
                      </p>
                    )}
                  </>
                )}
                <ReferenceCandidates cardId={id} notify={notify} />
              </details>
            </div>
            <footer className="drawer-footer">
              <span className="muted">原文保留 · 修改自动保存</span>
              <details className="detail-more">
                <summary>
                  更多 <ChevronDown size={14} />
                </summary>
                <div className="more-panel">
                  <button
                    className="text-btn"
                    onClick={() =>
                      perform(
                        () =>
                          patch("/cards/" + id, {
                            expected_revision_id: c.current_revision_id,
                            favorite: !c.favorite,
                          }),
                        c.favorite ? "已取消收藏" : "已收藏",
                      )
                    }
                  >
                    {c.favorite ? "取消收藏" : "收藏"}
                  </button>
                  <button
                    className="text-btn"
                    onClick={async () => {
                      try {
                        const updated = await patch("/cards/" + id, {
                          expected_revision_id: c.current_revision_id,
                          archived: !c.archived,
                        });
                        client.invalidateQueries();
                        undoNotice(
                          c.archived ? "已恢复卡片" : "已归档",
                          async () => {
                            await patch("/cards/" + id, {
                              expected_revision_id: updated.current_revision_id,
                              archived: c.archived,
                            });
                            client.invalidateQueries();
                          },
                        );
                        close();
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    {c.archived ? "恢复卡片" : "归档"}
                  </button>
                  <button
                    className="text-btn"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(c.content || "")
                        .then(() => notify("已复制内容"))
                        .catch(() => notify("剪贴板暂不可用"))
                    }
                  >
                    复制正文
                  </button>
                  <button
                    className="text-btn"
                    onClick={() => setOptimize(true)}
                  >
                    生成正文整理建议
                  </button>
                  <label>
                    内容类型
                    <select
                      aria-label="更改内容类型"
                      value={c.card_type}
                      onChange={(e) =>
                        perform(
                          () =>
                            patch("/cards/" + id, {
                              expected_revision_id: c.current_revision_id,
                              card_type: e.target.value,
                            }),
                          "已修改类型",
                        )
                      }
                    >
                      {Object.entries(typeName).map(([key, value]) => (
                        <option key={key} value={key}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <InlineEditable
                    key={id + "source_label"}
                    card={c}
                    field="source_label"
                  />
                  {["title", "summary", "tags"].map((field) => (
                    <RegenerateField
                      key={field}
                      card={c}
                      field={field}
                      notify={notify}
                    />
                  ))}
                </div>
              </details>
            </footer>
          </>
        )}
      </section>
      {optimize && c && (
        <Modal close={() => setOptimize(false)}>
          <div className="modal-heading">
            <h2>
              <Sparkles size={20} />
              整理这张卡片
            </h2>
            <button
              className="icon-btn"
              aria-label="关闭"
              onClick={() => setOptimize(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="modal-body">
            <label className="field">
              整理目标
              <textarea
                rows={4}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={useAi}
                onChange={(e) => setUseAi(e.target.checked)}
              />
              使用已配置的 AI 模型
            </label>
            <div className="info-box">
              <ShieldCheck size={17} />
              <p>
                {useAi
                  ? "将本卡片的标题和内容发给设置中的模型。需要先启用模型连接；结果会进入待审批清单。"
                  : "本地整理会清理多余空行并提取文本摘要，不调用网络。结果会作为候选版本供你对比审批。"}
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <span>原文始终保留</span>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                await perform(
                  () =>
                    post("/optimization-jobs", {
                      card_id: id,
                      instruction,
                      use_ai: useAi,
                    }),
                  "已创建整理任务，请在知识体检的待审批清单查看结果",
                );
                setOptimize(false);
              }}
            >
              <Sparkles size={15} />
              生成整理建议
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split("\n");
  const b = after.split("\n");
  const additions = b.filter((x) => !a.includes(x) && x.trim());
  const removals = a.filter((x) => !b.includes(x) && x.trim());
  return (
    <div className="diff-summary">
      <b>内容变化</b>
      {!additions.length && !removals.length ? (
        <p className="muted">
          {before === after
            ? "正文无逐行差异；请同时检查标题、摘要和标签。"
            : "正文仅有空行或格式变化；请同时检查标题、摘要和标签。"}
        </p>
      ) : (
        <>
          {removals.map((s, i) => (
            <div className="diff-remove" key={"r" + i}>
              − {s}
            </div>
          ))}
          {additions.map((s, i) => (
            <div className="diff-add" key={"a" + i}>
              + {s}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
function AuditPage({
  open,
  notify,
}: {
  open: (id: string) => void;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const [tab, setTab] = useState("findings");
  const [status, setStatus] = useState("open");
  const [review, setReview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [auditTag, setAuditTag] = useState("");
  const tags = useQuery({ queryKey: ["stats"], queryFn: () => api("/stats") });
  const findings = useQuery<any[]>({
    queryKey: ["findings", status],
    queryFn: () => api("/findings?status=" + status),
    refetchInterval: 3000,
  });
  const approvals = useQuery<any[]>({
    queryKey: ["approvals"],
    queryFn: () => api("/approvals"),
    refetchInterval: 3000,
  });
  const original = useQuery<Card>({
    queryKey: ["card", review?.target_id],
    queryFn: () => api("/cards/" + review.target_id),
    enabled: !!review,
  });
  async function act(fn: () => Promise<any>, s: string) {
    setBusy(true);
    try {
      await fn();
      client.invalidateQueries();
      notify(s);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="audit-toolbar">
        <div className="audit-controls">
          <select
            aria-label="体检范围"
            value={auditTag}
            onChange={(e) => setAuditTag(e.target.value)}
          >
            <option value="">全部知识</option>
            {tags.data?.tags?.map((t: any) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              act(
                () => post("/audit-jobs", { tag: auditTag || null }),
                "已开始知识体检，进度可在任务中心查看",
              )
            }
          >
            <Play size={15} />
            开始一次体检
          </button>
        </div>
      </section>
      <div className="info-box subtle">
        <ShieldCheck size={16} />
        <p>
          当前执行本地规则初筛。时间、文字相似度和来源缺失只是线索，不代表知识错误；所有发现由你确认。
        </p>
      </div>
      <div className="page-tabs">
        <button
          className={tab === "findings" ? "active" : ""}
          onClick={() => setTab("findings")}
        >
          体检发现 <span>{findings.data?.length || 0}</span>
        </button>
        <button
          className={tab === "approvals" ? "active" : ""}
          onClick={() => setTab("approvals")}
        >
          待审批建议 <span>{approvals.data?.length || 0}</span>
        </button>
        {tab === "findings" && (
          <select
            aria-label="体检状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">待处理</option>
            <option value="resolved">已处理</option>
            <option value="dismissed">已忽略</option>
          </select>
        )}
      </div>
      {tab === "findings" ? (
        findings.isError ? (
          <ErrorState error={findings.error} retry={() => findings.refetch()} />
        ) : findings.data?.length ? (
          <div className="finding-list">
            {findings.data.map((f) => (
              <article key={f.id} className="finding">
                <span className={"finding-icon " + f.severity}>
                  <AlertCircle size={19} />
                </span>
                <div className="finding-content">
                  <span className="finding-type">
                    {
                      {
                        incomplete: "内容补全",
                        missing_tags: "标签建议",
                        outdated: "过时线索",
                        evidence: "参考缺失",
                        duplicate: "疑似重复",
                      }[f.finding_type as string]
                    }
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                  <button
                    className="text-btn"
                    onClick={() => open(f.target_id)}
                  >
                    <Layers size={13} />
                    {f.card_title}
                    <ArrowUpRight size={13} />
                  </button>
                  {f.related_id && (
                    <button
                      className="text-btn"
                      onClick={() => open(f.related_id)}
                    >
                      对比相关卡片
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
                <div className="finding-actions">
                  {status === "open" ? (
                    <>
                      <button
                        className="btn small-btn"
                        onClick={() =>
                          act(
                            () =>
                              post("/findings/" + f.id + "/resolve", {
                                status: "resolved",
                              }),
                            "已标记为处理完成",
                          )
                        }
                      >
                        <Check size={14} />
                        已处理
                      </button>
                      <button
                        className="text-btn muted"
                        onClick={() =>
                          act(
                            () =>
                              post("/findings/" + f.id + "/resolve", {
                                status: "dismissed",
                              }),
                            "已忽略此建议",
                          )
                        }
                      >
                        忽略
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn small-btn"
                      onClick={() =>
                        act(
                          () =>
                            post("/findings/" + f.id + "/resolve", {
                              status: "open",
                            }),
                          "已重新打开",
                        )
                      }
                    >
                      重新打开
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            icon={HeartPulse}
            title={
              status === "open" ? "此刻的知识空间，很安静" : "这里还没有记录"
            }
            text="运行一次体检，发现值得关注的内容。"
          />
        )
      ) : approvals.data?.length ? (
        <div className="approval-list">
          {approvals.data.map((a) => (
            <article className="approval-row" key={a.id}>
              <span className="approval-icon">
                <Sparkles size={22} />
              </span>
              <div>
                <span className="finding-type">整理建议 · {a.model}</span>
                <h3>{a.title}</h3>
                <p>{a.proposed_summary}</p>
              </div>
              <button className="btn" onClick={() => setReview(a)}>
                对比并审批
                <ArrowRight size={14} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={CheckCircle2}
          title="所有建议，都已妥善处理"
          text="在卡片详情中点击「整理一下」，候选版本会出现在这里。"
        />
      )}
      {review && (
        <Modal close={() => setReview(null)} wide>
          <div className="modal-heading">
            <div>
              <h2>这一次修改，由你决定。</h2>
            </div>
            <button
              className="icon-btn"
              aria-label="关闭"
              onClick={() => setReview(null)}
            >
              <X size={20} />
            </button>
          </div>
          <div className="modal-body">
            {original.data && (
              <>
                <div className="compare-columns">
                  <div>
                    <h4>当前版本</h4>
                    <h3>{original.data.title}</h3>
                    <p className="muted">{original.data.summary}</p>
                    <div className="card-tags">
                      {original.data.tags.map((t) => (
                        <span key={t}>#{t}</span>
                      ))}
                    </div>
                    <Markdown>{original.data.content || ""}</Markdown>
                  </div>
                  <div>
                    <h4>建议版本 · {review.model}</h4>
                    <h3>{review.proposed_title}</h3>
                    <p className="muted">{review.proposed_summary}</p>
                    <div className="card-tags">
                      {(
                        JSON.parse(review.proposed_tags || "[]") as string[]
                      ).map((t) => (
                        <span key={t}>#{t}</span>
                      ))}
                    </div>
                    <Markdown>{review.proposed_content}</Markdown>
                  </div>
                </div>
                <Diff
                  before={original.data.content || ""}
                  after={review.proposed_content}
                />
              </>
            )}
          </div>
          <div className="modal-footer">
            <span>
              <ShieldCheck size={13} />
              采用后仍可恢复历史版本
            </span>
            <div>
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  await act(
                    () => post("/approvals/" + review.id + "/reject"),
                    "已拒绝建议，当前卡片未更改",
                  );
                  setReview(null);
                }}
              >
                拒绝建议
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  await act(
                    () => post("/approvals/" + review.id + "/approve"),
                    "已采用建议，保存为新版本",
                  );
                  setReview(null);
                }}
              >
                <Check size={15} />
                采用此版本
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function JobsPage({
  notify,
  open,
}: {
  notify: (s: string) => void;
  open: (s: string) => void;
}) {
  const client = useQueryClient();
  const jobs = useQuery<any[]>({
    queryKey: ["jobs"],
    queryFn: () => api("/jobs"),
    refetchInterval: 1500,
  });
  async function act(id: string, op: string) {
    try {
      await post("/jobs/" + id + "/" + op);
      client.invalidateQueries();
      notify(
        op === "retry" ? "任务已重新排队" : "已提交取消，已保存的内容会保留",
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const names: Record<string, string> = {
    capture: "统一录入",
    metadata: "元信息填充",
    "semantic-index": "增量语义索引",
    import: "对话导入",
    optimization: "卡片整理",
    audit: "知识体检",
    embeddings: "语义索引",
  };
  const states: Record<string, string> = {
    queued: "等待处理",
    running: "正在执行",
    completed: "已完成",
    partial: "部分导入",
    failed: "执行失败",
    cancelled: "已取消",
  };
  return jobs.isError ? (
    <ErrorState error={jobs.error} retry={() => jobs.refetch()} />
  ) : jobs.data?.length ? (
    <div className="jobs-list">
      {jobs.data.map((j) => (
        <article className="job-row" key={j.id}>
          <span className={"job-icon " + j.status}>
            {j.status === "running" ? (
              <Loader2 className="spin" size={20} />
            ) : j.status === "completed" ? (
              <CheckCircle2 size={20} />
            ) : j.status === "failed" ? (
              <AlertCircle size={20} />
            ) : (
              <Clock3 size={20} />
            )}
          </span>
          <div className="job-content">
            <div className="section-title">
              <h3>{names[j.job_type]}</h3>
              <span className={"status-pill " + j.status}>
                {states[j.status]}
              </span>
            </div>
            <span className="muted">
              {new Date(j.created_at).toLocaleString("zh-CN")} · 尝试{" "}
              {j.attempts} 次
            </span>
            {["running", "queued"].includes(j.status) && (
              <div className="progress">
                <span style={{ width: j.progress + "%" }} />
              </div>
            )}
            {j.error && <p className="form-error">{j.error}</p>}
            {j.result && (
              <div className="job-result">
                {["import", "capture"].includes(j.job_type) ? (
                  <>
                    <span>
                      {j.job_type === "capture" ? "输入已处理" : "对话已导入"}
                    </span>
                    {j.result.card_ids?.map((id: string, i: number) => (
                      <button
                        className="text-btn"
                        key={id + i}
                        onClick={() => open(id)}
                      >
                        打开已保存的卡片
                        <ArrowUpRight size={13} />
                      </button>
                    ))}
                    {j.result.warnings?.map((s: string) => (
                      <p className="warning" key={s}>
                        {s}
                      </p>
                    ))}
                  </>
                ) : j.job_type === "audit" ? (
                  <span>
                    检查 {j.result.checked} 张卡片 · 新增 {j.result.findings}{" "}
                    条发现
                  </span>
                ) : j.job_type === "optimization" ? (
                  <span>候选版本已保存，请前往知识体检 → 待审批建议</span>
                ) : (
                  <span>
                    {j.result.skipped
                      ? "已保留本地结果（范围或预算限制）"
                      : j.job_type === "metadata"
                        ? "元信息处理完成"
                        : j.job_type === "semantic-index"
                          ? "增量索引完成"
                          : `已建立 ${j.result.indexed} 张卡片的语义索引`}
                  </span>
                )}
              </div>
            )}
          </div>
          {["failed", "cancelled"].includes(j.status) ? (
            <button
              className="btn small-btn"
              onClick={() => act(j.id, "retry")}
            >
              <RotateCcw size={14} />
              重试
            </button>
          ) : ["queued", "running"].includes(j.status) ? (
            <button
              className="text-btn muted"
              onClick={() => act(j.id, "cancel")}
            >
              取消
            </button>
          ) : (
            <Check size={16} className="muted" />
          )}
        </article>
      ))}
    </div>
  ) : (
    <Empty
      icon={Activity}
      title="这里记录每一份进展"
      text="导入对话、整理卡片或执行体检后，就能在这里查看任务进度与结果。"
    />
  );
}
function KnowledgePage({
  open,
  notify,
  initialDocument,
}: {
  initialDocument?: string | null;
  open: (s: string) => void;
  notify: (s: string) => void;
}) {
  const client = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(
    initialDocument || null,
  );
  useEffect(() => {
    if (initialDocument) setSelected(initialDocument);
  }, [initialDocument]);
  useEffect(() => {
    const show = (event: Event) => setSelected((event as CustomEvent).detail);
    window.addEventListener("cardspace-document", show);
    return () => window.removeEventListener("cardspace-document", show);
  }, []);
  const [attachCard, setAttachCard] = useState("");
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const docs = useQuery<any[]>({
    queryKey: ["documents", q],
    queryFn: () => api("/knowledge-documents?q=" + encodeURIComponent(q)),
  });
  const doc = useQuery({
    queryKey: ["document", selected],
    queryFn: () => api("/knowledge-documents/" + selected),
    enabled: !!selected,
  });
  const cards = useQuery<{ items: Card[] }>({
    queryKey: ["cards", "attach"],
    queryFn: () => api("/cards?limit=100"),
    enabled: !!selected,
  });
  async function upload(file: File) {
    if (file.size > 32 * 1024 * 1024) {
      notify("文件超过 32MB 限制");
      return;
    }
    setBusy(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const r = await api("/knowledge-documents", {
        method: "POST",
        body: data,
      });
      notify(
        r.duplicate
          ? "这份文档已在知识库中"
          : "已导入文档，原始文件与文本分块已保存",
      );
      client.invalidateQueries();
      setSelected(r.document_id);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="knowledge-toolbar">
        <label className="search-input">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索参考资料及正文…"
          />
        </label>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
          导入参考资料
        </button>
        <input
          className="hidden"
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.txt,.pdf,.docx"
          onChange={async (e) => {
            for (const file of Array.from(e.target.files || []))
              await upload(file);
            e.target.value = "";
          }}
        />
      </div>
      <div className="info-box subtle">
        <BookOpen size={17} />
        <p>
          支持 Markdown、TXT、PDF 与 DOCX，最大
          32MB。文档会保留原文件和定位信息；参考内容需要结合上下文判断。
        </p>
      </div>
      {docs.isError ? (
        <ErrorState error={docs.error} retry={() => docs.refetch()} />
      ) : docs.data?.length ? (
        <div className="document-grid">
          {docs.data.map((d) => (
            <button
              className="document-card"
              key={d.id}
              onClick={() => setSelected(d.id)}
            >
              <span className="document-icon">
                <FileText size={27} />
                <small>{d.filename.split(".").pop()?.toUpperCase()}</small>
              </span>
              <h3>{d.title}</h3>
              <span>{d.chunk_count} 个文本分块</span>
              <div className="card-bottom">
                <time>{date(d.created_at)}</time>
                <ArrowUpRight size={16} />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          icon={BookOpen}
          title="为你的知识，搭建一个参考书架"
          text="导入技术文档、读书摘录与资料，为卡片引用可追溯的原文。"
          action={
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Upload size={15} />
              选择第一份资料
            </button>
          }
        />
      )}
      {selected && (
        <Modal wide close={() => setSelected(null)}>
          <div className="modal-heading">
            <div>
              <h2>{doc.data?.title || "正在读取…"}</h2>
            </div>
            <button
              className="icon-btn"
              aria-label="关闭"
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
          </div>
          <div className="modal-body">
            {doc.data && (
              <>
                <button
                  className="text-btn"
                  onClick={async () => {
                    try {
                      const result = await post(
                        "/knowledge-documents/" + selected + "/to-note",
                      );
                      client.invalidateQueries();
                      setSelected(null);
                      open(result.card.id);
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  作为笔记保存
                </button>
                <div className="reference-attach">
                  <label className="field">
                    关联到知识卡片
                    <select
                      value={attachCard}
                      onChange={(e) => setAttachCard(e.target.value)}
                    >
                      <option value="">选择一张卡片…</option>
                      {cards.data?.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    关联的结论 <span>选填</span>
                    <input
                      value={claim}
                      onChange={(e) => setClaim(e.target.value)}
                      placeholder="这份原文与哪条观点相关？"
                    />
                  </label>
                </div>
                {doc.data.chunks.map((ch: any) => (
                  <article className="document-chunk" key={ch.id}>
                    <div className="section-title">
                      <span>{ch.locator}</span>
                      <button
                        className="btn small-btn"
                        disabled={!attachCard}
                        onClick={async () => {
                          try {
                            await post("/evidence", {
                              card_id: attachCard,
                              chunk_id: ch.id,
                              claim_ref: claim,
                            });
                            notify(
                              "已关联参考段落，可在卡片的关联与引用中查看",
                            );
                            client.invalidateQueries();
                          } catch (e) {
                            notify((e as Error).message);
                          }
                        }}
                      >
                        <Link size={13} />
                        引用此段
                      </button>
                    </div>
                    <Markdown>{ch.text}</Markdown>
                  </article>
                ))}
              </>
            )}
          </div>
          <div className="modal-footer">
            <span>引用保留原文与定位</span>
            {attachCard && (
              <button
                className="btn"
                onClick={() => {
                  setSelected(null);
                  open(attachCard);
                }}
              >
                查看关联卡片
                <ArrowUpRight size={14} />
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function SettingsPage({ notify }: { notify: (s: string) => void }) {
  const client = useQueryClient();
  const cfg = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/settings"),
  });
  const [draft, setDraft] = useState<any>({});
  const [dirty, setDirty] = useState(false);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreText, setRestoreText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const logs = useQuery<any[]>({
    queryKey: ["logs"],
    queryFn: () => api("/operation-logs"),
  });
  useEffect(() => {
    if (cfg.data && !dirty) setDraft(cfg.data);
  }, [cfg.data, dirty]);
  const change = (k: string, v: any) => {
    setDirty(true);
    setDraft({ ...draft, [k]: v });
  };
  async function perform(fn: () => Promise<any>, message: string) {
    setBusy(true);
    try {
      const r = await fn();
      notify(message);
      client.invalidateQueries();
      return r;
    } catch (e) {
      notify((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  if (cfg.isError)
    return <ErrorState error={cfg.error} retry={() => cfg.refetch()} />;
  return (
    <div className="settings-layout">
      <details className="settings-card project-about" open>
        <summary className="settings-title">
          <div>
            <h2>CardSpace · 开源记忆工具</h2>
            <p>MIT License · Copyright © 2026 CardSpace contributors</p>
          </div>
        </summary>
        <div className="settings-body">
          <p className="muted">
            欢迎使用、修改和再分发。本软件按现状提供，不附带担保。贡献指南与构建说明包含在源码包中。
          </p>
          <div className="button-row">
            <a
              className="btn"
              href="/api/v1/project/license"
              target="_blank"
              rel="noreferrer"
            >
              MIT 许可证
            </a>
            <a className="btn" href="/api/v1/project/source" download>
              <Download size={14} />
              下载源码
            </a>
          </div>
        </div>
      </details>
      <details className="settings-card">
        <summary className="settings-title">
          <span className="setting-icon purple">
            <Sparkles size={20} />
          </span>
          <div>
            <h2>模型连接</h2>
            <p>连接兼容 OpenAI API 的模型服务，支持本机模型。</p>
          </div>
          <span className="status-pill">
            {cfg.data?.allow_cloud ? "已启用" : "默认关闭"}
          </span>
        </summary>
        <div className="settings-body">
          <label className="switch-row">
            <span>
              <b>允许模型处理所选知识</b>
              <small>启用后，AI 整理和语义索引会发送对应内容到下方服务。</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={!!draft.allow_cloud}
              onChange={(e) => change("allow_cloud", e.target.checked)}
            />
          </label>
          <label className="field">
            服务预设
            <select
              aria-label="模型服务预设"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) change("model_base_url", e.target.value);
              }}
            >
              <option value="">手动配置</option>
              <option value="https://api.openai.com/v1">OpenAI</option>
              <option value="https://api.deepseek.com">DeepSeek</option>
              <option value="http://localhost:11434/v1">本机 Ollama</option>
            </select>
          </label>
          <label className="switch-row">
            <span>
              <b>自动填充新录入的元信息</b>
              <small>
                只处理通过「新建记忆」提交的新内容；人工修改优先，不处理已有全库。
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={!!draft.auto_metadata}
              onChange={(e) => change("auto_metadata", e.target.checked)}
            />
          </label>
          <label className="switch-row">
            <span>
              <b>自动补充语义搜索</b>
              <small>
                为新录入及其后续修改建立索引，搜索词发送到所配置服务；与元信息共用每日请求预算。
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={!!draft.auto_semantic}
              onChange={(e) => change("auto_semantic", e.target.checked)}
            />
          </label>
          <div className="form-row">
            <label className="field">
              每日自动请求上限
              <input
                aria-label="每日自动请求上限"
                type="number"
                min={1}
                max={1000}
                value={draft.model_daily_calls || 20}
                onChange={(e) =>
                  change("model_daily_calls", Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              每次自动处理字数上限
              <input
                type="number"
                min={100}
                max={32000}
                value={draft.model_max_input_chars || 16000}
                onChange={(e) =>
                  change("model_max_input_chars", Number(e.target.value))
                }
              />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              API Base URL
              <input
                value={draft.model_base_url || ""}
                onChange={(e) => change("model_base_url", e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="field">
              模型名称
              <datalist id="available-models">
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <input
                value={draft.model || ""}
                onChange={(e) => change("model", e.target.value)}
                list="available-models"
                placeholder="填写服务支持的模型 ID"
              />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              API Key
              <span>
                {cfg.data?.has_api_key
                  ? "已安全保存于系统凭据存储"
                  : "保存于系统凭据存储"}
              </span>
              <input
                type="password"
                value={key}
                autoComplete="new-password"
                onChange={(e) => {
                  setKey(e.target.value);
                  setDirty(true);
                }}
                placeholder={
                  cfg.data?.has_api_key
                    ? "留空保留现有密钥"
                    : "输入密钥，本机模型可以留空"
                }
              />
            </label>
            <label className="field">
              Embedding 模型 <span>可选</span>
              <input
                value={draft.embedding_model || ""}
                onChange={(e) => change("embedding_model", e.target.value)}
                placeholder="启用语义索引时填写"
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="btn small-btn"
              disabled={
                busy || !cfg.data?.allow_cloud || !cfg.data?.embedding_model
              }
              onClick={() =>
                perform(
                  () => post("/embedding-jobs"),
                  "已创建语义索引任务，所选卡片将发送到模型服务",
                )
              }
            >
              <Database size={14} />
              建立语义索引
            </button>
            <button
              className="btn"
              disabled={busy || !cfg.data?.allow_cloud}
              onClick={async () => {
                const response = await perform(
                  () => api("/models"),
                  "模型列表已读取",
                );
                if (response) setModels(response.items);
              }}
            >
              发现模型
            </button>
            <button
              className="btn primary"
              disabled={busy || !dirty}
              onClick={async () => {
                const r = await perform(
                  () =>
                    patch("/settings", {
                      model_base_url: draft.model_base_url,
                      model: draft.model,
                      embedding_model: draft.embedding_model,
                      allow_cloud: draft.allow_cloud,
                      auto_metadata: draft.auto_metadata,
                      auto_semantic: draft.auto_semantic,
                      model_daily_calls: draft.model_daily_calls,
                      model_max_input_chars: draft.model_max_input_chars,
                      ...(key ? { api_key: key } : {}),
                    }),
                  "模型设置已保存",
                );
                if (r) {
                  setDirty(false);
                  setKey("");
                }
              }}
            >
              保存模型设置
            </button>
          </div>
        </div>
      </details>
      <details className="settings-card">
        <summary className="settings-title">
          <span className="setting-icon green">
            <HeartPulse size={20} />
          </span>
          <div>
            <h2>持续维护</h2>
            <p>应用运行时检查知识；错过的计划会在下次启动补跑。</p>
          </div>
        </summary>
        <div className="settings-body">
          <label className="field">
            新录入默认主题（可留空）
            <input
              value={draft.default_tag || ""}
              onChange={(e) => change("default_tag", e.target.value)}
              onBlur={() => {
                if (draft.default_tag !== cfg.data?.default_tag)
                  perform(
                    () =>
                      patch("/settings", {
                        default_tag: draft.default_tag || "",
                      }),
                    "默认主题已保存",
                  );
              }}
              placeholder="例如：研究笔记"
            />
          </label>
          <label className="switch-row">
            <span>
              <b>定期知识体检</b>
              <small>每次处理最多 500 张，优先检查最久未审查的卡片。</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={!!draft.auto_audit}
              onChange={(e) => change("auto_audit", e.target.checked)}
            />
          </label>
          <label className="switch-row">
            <span>
              <b>导入后进行增量检查</b>
              <small>新对话保存后，自动加入本地体检队列。</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={!!draft.incremental_audit}
              onChange={(e) => change("incremental_audit", e.target.checked)}
            />
          </label>
          <div className="form-row">
            <label className="field">
              检查周期
              <select
                value={draft.audit_interval_days || 7}
                onChange={(e) =>
                  change("audit_interval_days", Number(e.target.value))
                }
              >
                <option value={1}>每天</option>
                <option value={7}>每周</option>
                <option value={30}>每月</option>
              </select>
            </label>
            <label className="field">
              自动备份周期
              <select
                value={draft.backup_interval_days || 1}
                onChange={(e) =>
                  change("backup_interval_days", Number(e.target.value))
                }
              >
                <option value={1}>每天</option>
                <option value={7}>每周</option>
                <option value={30}>每月</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <span className="muted">
              最近备份：
              {cfg.data?.last_backup_at
                ? new Date(cfg.data.last_backup_at).toLocaleString("zh-CN")
                : "尚无"}
            </span>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                const r = await perform(
                  () =>
                    patch("/settings", {
                      auto_audit: draft.auto_audit,
                      incremental_audit: draft.incremental_audit,
                      audit_interval_days: draft.audit_interval_days,
                      backup_interval_days: draft.backup_interval_days,
                    }),
                  "维护计划已保存",
                );
                if (r) setDirty(false);
              }}
            >
              保存维护计划
            </button>
          </div>
        </div>
      </details>
      <details className="settings-card" open>
        <summary className="settings-title">
          <span className="setting-icon blue">
            <Database size={20} />
          </span>
          <div>
            <h2>数据与备份</h2>
            <p>原始快照、版本与参考文件都保存在 SQLite 数据包中。</p>
          </div>
        </summary>
        <div className="settings-body">
          <label className="field">
            本地数据位置
            <code className="path-box">{cfg.data?.data_dir || "读取中…"}</code>
          </label>
          <div className="backup-actions">
            <div>
              <b>导出完整备份</b>
              <p>安全快照与哈希清单，可迁移到另一台电脑。</p>
            </div>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                const r = await perform(
                  () => post("/backups"),
                  "完整备份已生成",
                );
                if (r) window.location.href = r.download_url;
              }}
            >
              <Download size={15} />
              导出备份
            </button>
          </div>
          <div className="backup-actions">
            <div>
              <b>从备份恢复</b>
              <p>恢复前会校验完整性，并为当前数据库创建回滚备份。</p>
            </div>
            <button
              className="btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={15} />
              恢复数据
            </button>
            <input
              type="file"
              accept=".zip"
              className="hidden"
              ref={fileRef}
              onChange={(e) => {
                setRestoreFile(e.target.files?.[0] || null);
                setRestoreText("");
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </details>
      <details className="settings-card">
        <summary className="settings-title">
          <span className="setting-icon purple">
            <Command size={20} />
          </span>
          <div>
            <h2>Agent 与 MCP</h2>
            <p>Agent 共享同一套知识服务与版本规则。</p>
          </div>
        </summary>
        <div className="settings-body">
          <p className="muted">
            MCP 使用 stdio 连接本地 API。配置示例见项目 README；Agent
            可以读取、写入原文、提交修订与体检，审批和数据恢复由界面中的用户执行。
          </p>
          <label className="field">
            Agent 令牌位置
            <code className="path-box">{cfg.data?.agent_token_path}</code>
          </label>
          <p className="muted">
            令牌文件权限为 0600。请通过本机 MCP
            适配器读取，勿粘贴到对话或公开配置中。
          </p>
        </div>
      </details>
      <details className="settings-card">
        <summary className="settings-title">
          <span className="setting-icon orange">
            <History size={20} />
          </span>
          <div>
            <h2>最近操作</h2>
            <p>保存、修改与审批都有记录。</p>
          </div>
        </summary>
        <div className="operation-list">
          {logs.data?.slice(0, 12).map((l) => (
            <div key={l.id}>
              <span className="operation-dot" />
              <b>{l.action}</b>
              <span>{l.actor}</span>
              <time>{new Date(l.timestamp).toLocaleString("zh-CN")}</time>
            </div>
          ))}
        </div>
      </details>
      {restoreFile && (
        <Modal close={() => setRestoreFile(null)}>
          <div className="modal-heading">
            <h2>恢复知识空间</h2>
            <button
              className="icon-btn"
              aria-label="关闭"
              onClick={() => setRestoreFile(null)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="modal-body">
            <p>
              将使用「{restoreFile.name}
              」替换当前数据库。当前内容会先创建回滚备份。正在运行的任务需要先完成或取消。
            </p>
            <label className="field">
              输入「确认恢复」继续
              <input
                value={restoreText}
                onChange={(e) => setRestoreText(e.target.value)}
              />
            </label>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setRestoreFile(null)}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={busy || restoreText !== "确认恢复"}
              onClick={async () => {
                const data = new FormData();
                data.append("file", restoreFile);
                const r = await perform(
                  () => api("/restore", { method: "POST", body: data }),
                  "数据已恢复，完整性校验通过",
                );
                if (r) setRestoreFile(null);
              }}
            >
              恢复数据
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
