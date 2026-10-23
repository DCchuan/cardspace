import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { acknowledge, controlValues } from "./controls.mjs";
declare const __WORKER_SOURCE__: string;
let port: MessagePort | null = null,
  instance = "",
  nonce = "",
  worker: Worker | null = null,
  timer: ReturnType<typeof setTimeout>,
  serial = 0,
  workerURL = "";
let embedded = false;
let spec: any,
  refs: string[] = [],
  snapshot: any = null;
function send(type: string, payload: any = {}) {
  port?.postMessage({
    protocol: "experience-bridge.v1",
    instance_id: instance,
    nonce,
    type,
    payload,
  });
}
const listeners = new Set<(v: any) => void>();
function launch() {
  worker?.terminate();
  if (workerURL) URL.revokeObjectURL(workerURL);
  clearTimeout(timer);
  workerURL = URL.createObjectURL(
    new Blob([__WORKER_SOURCE__], { type: "text/javascript" }),
  );
  worker = new Worker(workerURL);
  worker.onmessage = (e) => {
    clearTimeout(timer);
    listeners.forEach((f) => f(e.data));
    if (e.data.type === "STATE") {
      snapshot = e.data.state;
      send("SAVE_STATE", { snapshot });
    }
    if (e.data.type === "ERROR") send("RUNTIME_ERROR", { code: e.data.code });
  };
  worker.onerror = () => {
    clearTimeout(timer);
    listeners.forEach((f) =>
      f({ type: "ERROR", code: "运行暂时中断，请重置" }),
    );
  };
  dispatch({ type: "INIT", spec, refs, snapshot });
}
function dispatch(m: any) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    worker?.terminate();
    listeners.forEach((f) =>
      f({ type: "ERROR", code: "演示计算超时，请重置" }),
    );
    send("RUNTIME_ERROR", { code: "WORKER_TIMEOUT" });
  }, 1500);
  const id = ++serial;
  worker?.postMessage({ ...m, id });
  return id;
}
function event(e: any) {
  return dispatch({ type: "EVENT", event: e });
}
function App() {
  const [pending, setPending] = useState<
    Record<string, { id: number; value: any }>
  >({});
  const [v, setV] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const f = (x: any) => {
      setPending((previous) => acknowledge(previous, x.id));
      if (x.type === "ERROR") setError(x.code);
      else {
        setError("");
        setV(x);
      }
    };
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  const state = controlValues(v?.state.values || {}, pending),
    data = v?.data || {};
  function node(n: any): React.ReactNode {
    if (v?.visible[n.id] === false) return null;
    const props = { key: n.id };
    const change = (value: any) => {
      const id = event({ type: "INPUT", node_id: n.id, value });
      setPending((previous) => ({ ...previous, [n.state_key]: { id, value } }));
    };
    const rows = data[n.data_key] || [];
    switch (n.kind) {
      case "Stack":
      case "Grid":
        return (
          <div
            {...props}
            className={n.kind === "Grid" ? "grid" : "stack"}
            style={
              n.kind === "Grid"
                ? { gridTemplateColumns: `repeat(${n.columns},minmax(0,1fr))` }
                : undefined
            }
          >
            {n.children.map(node)}
          </div>
        );
      case "Heading":
        if (embedded && n.text === spec.title) return null;
        return <h2 {...props}>{n.text}</h2>;
      case "Paragraph":
        return (
          <div {...props}>
            <small>
              {
                (
                  {
                    illustration: "教学示例",
                    hypothesis: "待确认假设",
                    derived: "根据来源推导",
                    source: "来源陈述，尚未核验",
                  } as any
                )[n.origin]
              }
            </small>
            <p>{n.text}</p>
          </div>
        );
      case "Slider":
        return (
          <label {...props}>
            {n.label}
            <output>{state[n.state_key]}</output>
            <input
              type="range"
              min={spec.state[n.state_key].min}
              max={spec.state[n.state_key].max}
              step={spec.state[n.state_key].step}
              value={state[n.state_key]}
              onChange={(e) => change(Number(e.target.value))}
            />
          </label>
        );
      case "Toggle":
        return (
          <label {...props}>
            <input
              type="checkbox"
              checked={state[n.state_key]}
              onChange={(e) => change(e.target.checked)}
            />
            {n.label}
          </label>
        );
      case "Input":
        return (
          <label {...props}>
            {n.label}
            <input
              value={state[n.state_key]}
              maxLength={spec.state[n.state_key].max_length}
              onChange={(e) => change(e.target.value)}
            />
          </label>
        );
      case "Select":
        return (
          <label {...props}>
            {n.label}
            <select
              value={state[n.state_key]}
              onChange={(e) => change(e.target.value)}
            >
              {n.options.map((o: any) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      case "Button":
        return (
          <button
            {...props}
            onClick={() => event({ type: "ACTION", action_id: n.action_id })}
          >
            {n.label}
          </button>
        );
      case "SourceLink":
        return (
          <button
            {...props}
            className="link"
            onClick={() => send("OPEN_SOURCE", { ref_id: n.ref_id })}
          >
            查看原文依据 ↗
          </button>
        );
      case "BarChart":
      case "LineChart": {
        const max = Math.max(
          1,
          ...rows.map((r: any) => Math.abs(Number(r[n.value_key]) || 0)),
        );
        return (
          <figure {...props}>
            <figcaption>{n.label}</figcaption>
            {n.kind === "LineChart" ? (
              <svg role="img" aria-label={n.label} viewBox="0 0 500 130">
                <polyline
                  fill="none"
                  stroke="#6554ad"
                  strokeWidth="3"
                  points={rows
                    .map(
                      (r: any, i: number) =>
                        `${((i + 0.5) * 500) / rows.length},${120 - (Number(r[n.value_key]) / max) * 110}`,
                    )
                    .join(" ")}
                />
              </svg>
            ) : null}
            {rows.map((r: any, i: number) => (
              <div className="bar" key={i}>
                <span>{String(r[n.label_key] ?? "")}</span>
                <div>
                  <i
                    style={{
                      width: `${(Math.abs(Number(r[n.value_key])) / max) * 100}%`,
                    }}
                  />
                </div>
                <output>{Number(r[n.value_key]).toFixed(3)}</output>
              </div>
            ))}
          </figure>
        );
      }
      case "DataTable":
        return (
          <div {...props} className="table">
            <table>
              <thead>
                <tr>
                  {n.columns.map((c: any) => (
                    <th key={c.field}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i}>
                    {n.columns.map((c: any) => (
                      <td key={c.field}>{String(r[c.field] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "List":
        return (
          <ul {...props}>
            {rows.map((r: any, i: number) => (
              <li key={i}>{String(r[n.label_key] ?? "")}</li>
            ))}
          </ul>
        );
      case "FlowGraph": {
        const nodes = data[n.nodes_key] || [],
          edges = data[n.edges_key] || [];
        return (
          <div {...props} className="flow" aria-label="流程图">
            {nodes.map((r: any) => (
              <div
                key={r.id}
                aria-current={
                  state[n.active_state_key] === r.id ? "step" : undefined
                }
                className={state[n.active_state_key] === r.id ? "active" : ""}
              >
                <strong>{r.label}</strong>
                <small>
                  {edges
                    .filter((e: any) => e.from === r.id)
                    .map(
                      (e: any) =>
                        "→ " +
                        (nodes.find((x: any) => x.id === e.to)?.label || e.to),
                    )
                    .join(" · ")}
                </small>
              </div>
            ))}
          </div>
        );
      }
      case "StepViewer": {
        const r = data[n.steps_key]?.[state[n.step_state_key]];
        return (
          <section {...props}>
            <strong>{r?.label}</strong>
            <p>{r?.text}</p>
          </section>
        );
      }
      default:
        return null;
    }
  }
  return (
    <>
      <div className="tools">
        <span>本地演示 · 操作不消耗 Token</span>
        <button
          onClick={() => {
            setError("");
            snapshot = null;
            launch();
          }}
        >
          重置
        </button>
      </div>
      {error ? (
        <div role="alert">{error}</div>
      ) : v ? (
        node(spec.view)
      ) : (
        <p>正在准备演示…</p>
      )}
      {spec?.assumptions?.map((a: any) => (
        <aside key={a.id}>
          <small>
            {a.origin === "hypothesis" ? "待确认假设" : "演示条件 · 尚未核验"}
          </small>
          <p>{a.text}</p>
        </aside>
      ))}
    </>
  );
}
window.addEventListener("message", function init(e) {
  if (
    e.source !== parent ||
    port ||
    e.data?.protocol !== "experience-bridge.v1" ||
    e.data.type !== "INIT" ||
    !e.ports[0] ||
    JSON.stringify(e.data).length > 600000
  )
    return;
  embedded = e.data.embedded === true;
  spec = e.data.spec;
  refs = e.data.refs;
  snapshot = e.data.snapshot || null;
  instance = e.data.instance_id;
  nonce = e.data.nonce;
  port = e.ports[0];
  port.onmessage = ({ data: m }) => {
    if (
      m.protocol === "experience-bridge.v1" &&
      m.nonce === nonce &&
      m.instance_id === instance &&
      m.type === "RESET"
    )
      launch();
  };
  createRoot(document.getElementById("root")!).render(<App />);
  setTimeout(launch, 0);
  send("READY");
});
window.addEventListener("pagehide", () => worker?.terminate());
