import { validateSpec } from "./semantics.mjs";
export function initial(spec) {
  return {
    values: Object.fromEntries(
      Object.entries(spec.state).map(([k, v]) => [k, v.initial]),
    ),
    data: Object.fromEntries(
      Object.entries(spec.datasets).map(([k, v]) => [
        k,
        structuredClone(v.rows),
      ]),
    ),
    serial: 0,
  };
}
export function evaluate(e, state, budget = { left: 20000 }, depth = 0) {
  if (--budget.left < 0 || depth > 8) throw Error("STEP_BUDGET");
  if (Object.hasOwn(e, "literal")) return e.literal;
  if (Object.hasOwn(e, "state")) return state.values[e.state];
  if (e.op === "if")
    return evaluate(
      e.args[evaluate(e.args[0], state, budget, depth + 1) ? 1 : 2],
      state,
      budget,
      depth + 1,
    );
  if (e.op === "and" || e.op === "or") {
    const first = evaluate(e.args[0], state, budget, depth + 1);
    return e.op === "and"
      ? first && evaluate(e.args[1], state, budget, depth + 1)
      : first || evaluate(e.args[1], state, budget, depth + 1);
  }
  const a = e.args.map((x) => evaluate(x, state, budget, depth + 1));
  let v;
  switch (e.op) {
    case "add":
      v = a[0] + a[1];
      break;
    case "sub":
      v = a[0] - a[1];
      break;
    case "mul":
      v = a[0] * a[1];
      break;
    case "div":
      if (a[1] === 0) throw Error("DIV_ZERO");
      v = a[0] / a[1];
      break;
    case "min":
      v = Math.min(...a);
      break;
    case "max":
      v = Math.max(...a);
      break;
    case "clamp":
      v = Math.min(a[2], Math.max(a[1], a[0]));
      break;
    case "eq":
      return a[0] === a[1];
    case "lt":
      return a[0] < a[1];
    case "and":
      return a[0] && a[1];
    case "or":
      return a[0] || a[1];
    case "if":
      return a[0] ? a[1] : a[2];
    default:
      throw Error("OP");
  }
  if (!Number.isFinite(v) || Math.abs(v) > 1e9) throw Error("NUMERIC_RANGE");
  return v;
}
function put(spec, st, key, v) {
  const def = spec.state[key];
  if (!def || typeof v !== def.kind) throw Error("STATE_TYPE");
  if (
    def.kind === "number" &&
    (!Number.isFinite(v) || v < def.min || v > def.max)
  )
    throw Error("STATE_RANGE");
  if (def.kind === "string" && Array.from(v).length > def.max_length)
    throw Error("STATE_RANGE");
  st.values[key] = v;
}
export function reduce(spec, old, event) {
  const st = structuredClone(old),
    budget = { left: 20000 };
  if (event.type === "RESET") return initial(spec);
  if (event.type === "INPUT") {
    const find = (n) =>
      n.id === event.node_id ? n : n.children?.map(find).find(Boolean);
    const n = find(spec.view);
    if (!n || !["Slider", "Toggle", "Input", "Select"].includes(n.kind))
      throw Error("INPUT_NODE");
    if (n.kind === "Select" && !n.options.some((o) => o.value === event.value))
      throw Error("SELECT_VALUE");
    put(spec, st, n.state_key, event.value);
  } else if (event.type === "ACTION") {
    const run = (id, depth = 0) => {
      if (--budget.left < 0 || depth > 50) throw Error("ACTION_LIMIT");
      const a = spec.actions[id];
      if (!Object.hasOwn(spec.actions, id)) throw Error("ACTION_ID");
      if (a.kind === "set")
        put(spec, st, a.state_key, evaluate(a.value, st, budget));
      if (a.kind === "sequence") a.action_ids.forEach((k) => run(k, depth + 1));
      if (a.kind === "transition") {
        const edge = a.edges.find(
          (e) =>
            e.from === st.values[a.state_key] &&
            (!e.guard || evaluate(e.guard, st, budget)),
        );
        if (edge) put(spec, st, a.state_key, edge.to);
      }
      if (a.kind === "append_row") {
        if (Object.values(st.data).reduce((s, x) => s + x.length, 0) >= 500)
          throw Error("ROW_LIMIT");
        const row = Object.fromEntries(
          Object.entries(a.values).map(([k, e]) => [
            k,
            evaluate(e, st, budget),
          ]),
        );
        do {
          if (st.serial >= 1e9) throw Error("SERIAL_LIMIT");
          row.id = "row_" + ++st.serial;
        } while (
          st.data[a.data_key].some((existing) => existing.id === row.id)
        );
        st.data[a.data_key].push(row);
      }
      if (a.kind === "remove_row") {
        const id = evaluate(a.row_id, st, budget);
        st.data[a.data_key] = st.data[a.data_key].filter((r) => r.id !== id);
      }
    };
    run(event.action_id);
  } else throw Error("EVENT_TYPE");
  return st;
}
export function project(spec, state) {
  const data = structuredClone(state.data),
    budget = { left: 20000 };
  for (const d of spec.derivations)
    data[d.id] = state.data[d.input]
      .map((r) => ({
        ...r,
        score: d.terms.reduce(
          (sum, t) => sum + r[t.field] * evaluate(t.weight, state, budget),
          0,
        ),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (String(a.id) < String(b.id)
            ? -1
            : String(a.id) > String(b.id)
              ? 1
              : 0),
      )
      .slice(0, d.limit);
  for (const rows of Object.values(data))
    for (const row of rows)
      if (
        Object.values(row).some(
          (x) =>
            typeof x === "number" && (!Number.isFinite(x) || Math.abs(x) > 1e9),
        )
      )
        throw Error("NUMERIC_RANGE");
  const visible = {};
  const visit = (n) => {
    visible[n.id] = !n.visible_when || evaluate(n.visible_when, state, budget);
    n.children?.forEach(visit);
  };
  visit(spec.view);
  return { state, data, visible };
}
export function start(spec, refs) {
  validateSpec(spec, refs);
  return project(spec, initial(spec));
}
export function restore(spec, snapshot) {
  if (
    !snapshot ||
    JSON.stringify(snapshot).length > 64000 ||
    Object.keys(snapshot).sort().join(",") !== "data,serial,values"
  )
    throw Error("SNAPSHOT");
  if (
    !Number.isSafeInteger(snapshot.serial) ||
    snapshot.serial < 0 ||
    snapshot.serial > 1e9
  )
    throw Error("SNAPSHOT");
  const st = initial(spec);
  if (
    Object.keys(snapshot.values).sort().join(",") !==
    Object.keys(st.values).sort().join(",")
  )
    throw Error("SNAPSHOT");
  for (const [k, v] of Object.entries(snapshot.values)) put(spec, st, k, v);
  if (
    Object.keys(snapshot.data).sort().join(",") !==
    Object.keys(st.data).sort().join(",")
  )
    throw Error("SNAPSHOT");
  let count = 0;
  for (const [k, rows] of Object.entries(snapshot.data)) {
    if (!Array.isArray(rows) || rows.length > 500) throw Error("SNAPSHOT");
    count += rows.length;
    for (const r of rows) {
      if (
        !r ||
        Array.isArray(r) ||
        typeof r !== "object" ||
        Object.keys(r).length > 32
      )
        throw Error("SNAPSHOT");
      for (const [key, v] of Object.entries(r)) {
        if (
          !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) ||
          ["constructor", "prototype", "__proto__"].includes(key) ||
          (!["string", "boolean", "number"].includes(typeof v) && v !== null) ||
          (typeof v === "string" && v.length > 1000) ||
          (typeof v === "number" && (!Number.isFinite(v) || Math.abs(v) > 1e9))
        )
          throw Error("SNAPSHOT");
      }
    }
    st.data[k] = structuredClone(rows);
  }
  if (count > 500) throw Error("SNAPSHOT");
  st.serial = snapshot.serial;
  project(spec, st);
  return st;
}
