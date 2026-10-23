import schemaValidate from "../experience-contracts/validate.cjs";
export const components = [
  "Stack",
  "Grid",
  "Heading",
  "Paragraph",
  "Slider",
  "Toggle",
  "Input",
  "Select",
  "Button",
  "BarChart",
  "LineChart",
  "DataTable",
  "List",
  "FlowGraph",
  "StepViewer",
  "SourceLink",
];
const own = (o, k) => Object.hasOwn(o, k);
const need = (v, code) => {
  if (!v) throw Error(code);
};
export function validateSpec(s, refs = []) {
  need(JSON.stringify(s).length <= 524288, "SPEC_SIZE");
  const walk = (v, d = 0) => {
    need(d <= 40, "DEPTH");
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        need(
          !["__proto__", "prototype", "constructor"].includes(k),
          "UNSAFE_KEY",
        );
        walk(x, d + 1);
      }
    else if (typeof v === "number") need(Number.isFinite(v), "FINITE");
  };
  walk(s);
  need(
    schemaValidate(s),
    "SCHEMA:" + JSON.stringify(schemaValidate.errors?.[0] || {}).slice(0, 240),
  );
  let rows = 0;
  const ids = new Set();
  const expr = (e, d = 0) => {
    need(d <= 8, "EXPRESSION_DEPTH");
    if (own(e, "literal"))
      return e.literal === null ? "null" : typeof e.literal;
    if (own(e, "state")) {
      need(own(s.state, e.state), "STATE_REF");
      return s.state[e.state].kind;
    }
    const types = e.args.map((x) => expr(x, d + 1));
    const arities = {
      add: 2,
      sub: 2,
      mul: 2,
      div: 2,
      min: 2,
      max: 2,
      clamp: 3,
      eq: 2,
      lt: 2,
      and: 2,
      or: 2,
      if: 3,
    };
    need(types.length === arities[e.op], "EXPRESSION_ARITY");
    if (e.op === "if") {
      need(types[0] === "boolean" && types[1] === types[2], "EXPRESSION_TYPE");
      return types[1];
    }
    if (["and", "or"].includes(e.op)) {
      need(
        types.every((t) => t === "boolean"),
        "EXPRESSION_TYPE",
      );
      return "boolean";
    }
    if (e.op === "eq") {
      need(types[0] === types[1], "EXPRESSION_TYPE");
      return "boolean";
    }
    need(
      types.every((t) => t === "number"),
      "EXPRESSION_TYPE",
    );
    return e.op === "lt" ? "boolean" : "number";
  };
  for (const v of Object.values(s.state)) {
    if (v.kind === "number")
      need(
        v.min <= v.initial &&
          v.initial <= v.max &&
          v.min <= v.max &&
          v.step <= Math.max(v.max - v.min, 1),
        "STATE_RANGE",
      );
    if (v.kind === "string")
      need(v.initial.length <= v.max_length, "STATE_RANGE");
  }
  const checkRefs = (o) => {
    if (o.source_refs) {
      need(
        o.source_refs.every((r) => refs.includes(r)),
        "SOURCE_REF",
      );
      if (o.origin === "source" || o.origin === "derived")
        need(o.source_refs.length > 0, "SOURCE_REQUIRED");
    }
  };
  s.assumptions.forEach(checkRefs);
  for (const data of Object.values(s.datasets)) {
    rows += data.rows.length;
    checkRefs(data);
    const seen = new Set();
    for (const r of data.rows)
      if (r.id !== undefined) {
        need(!seen.has(r.id), "ROW_ID");
        seen.add(r.id);
      }
  }
  need(rows <= 500, "ROW_LIMIT");
  const dataKeys = new Set(Object.keys(s.datasets));
  for (const d of s.derivations) {
    need(!dataKeys.has(d.id) && own(s.datasets, d.input), "DATA_REF");
    for (const t of d.terms) {
      need(expr(t.weight) === "number", "WEIGHT_TYPE");
      need(
        s.datasets[d.input].rows.every((r) => typeof r[t.field] === "number"),
        "FIELD_TYPE",
      );
    }
    dataKeys.add(d.id);
  }
  const validatedActions = new Set();
  const actionVisit = (id, seen = new Set()) => {
    need(own(s.actions, id) && !seen.has(id), "ACTION_CYCLE_OR_REF");
    if (validatedActions.has(id)) return;
    const a = s.actions[id],
      path = new Set([...seen, id]);
    if (a.kind === "sequence")
      a.action_ids.forEach((k) => actionVisit(k, path));
    if (["set", "transition"].includes(a.kind))
      need(own(s.state, a.state_key), "STATE_REF");
    if (a.kind === "set")
      need(expr(a.value) === s.state[a.state_key].kind, "ACTION_TYPE");
    if (a.kind === "transition") {
      need(s.state[a.state_key].kind === "string", "TRANSITION_TYPE");
      need(
        a.edges.some((e) => e.from === s.state[a.state_key].initial),
        "FLOW_START",
      );
      a.edges.forEach((e) => {
        need(e.to.length <= s.state[a.state_key].max_length, "FLOW_STATE");
        if (e.guard) need(expr(e.guard) === "boolean", "GUARD_TYPE");
      });
    }
    if (["append_row", "remove_row"].includes(a.kind))
      need(own(s.datasets, a.data_key), "DATA_REF");
    if (a.kind === "append_row")
      Object.values(a.values).forEach((e) => expr(e));
    if (a.kind === "remove_row") expr(a.row_id);
    validatedActions.add(id);
  };
  Object.keys(s.actions).forEach((k) => actionVisit(k));
  let nodeCount = 0;
  const node = (n, d = 0) => {
    need(
      ++nodeCount <= 200 && d <= 8 && !ids.has(n.id),
      "LAYOUT_LIMIT_OR_DUPLICATE",
    );
    ids.add(n.id);
    checkRefs(n);
    if (n.visible_when)
      need(expr(n.visible_when) === "boolean", "VISIBLE_TYPE");
    if (n.state_key) need(own(s.state, n.state_key), "STATE_REF");
    if (n.kind === "Slider")
      need(s.state[n.state_key].kind === "number", "CONTROL_TYPE");
    if (n.kind === "Toggle")
      need(s.state[n.state_key].kind === "boolean", "CONTROL_TYPE");
    if (["Input", "Select"].includes(n.kind))
      need(s.state[n.state_key].kind === "string", "CONTROL_TYPE");
    if (n.kind === "Select")
      need(
        n.options.some((o) => o.value === s.state[n.state_key].initial) &&
          n.options.every(
            (o) => o.value.length <= s.state[n.state_key].max_length,
          ),
        "SELECT_VALUE",
      );
    if (n.data_key) need(dataKeys.has(n.data_key), "DATA_REF");
    if (n.action_id) need(own(s.actions, n.action_id), "ACTION_REF");
    if (n.ref_id) need(refs.includes(n.ref_id), "SOURCE_REF");
    if (n.kind === "FlowGraph") {
      need(
        own(s.datasets, n.nodes_key) &&
          own(s.datasets, n.edges_key) &&
          own(s.state, n.active_state_key),
        "FLOW_REF",
      );
      const nodes = s.datasets[n.nodes_key].rows,
        edges = s.datasets[n.edges_key].rows;
      need(
        nodes.length > 0 &&
          nodes.length <= 30 &&
          nodes.every(
            (r) => typeof r.id === "string" && typeof r.label === "string",
          ) &&
          new Set(nodes.map((r) => r.id)).size === nodes.length,
        "FLOW_NODES",
      );
      need(
        s.state[n.active_state_key].kind === "string" &&
          nodes.some((r) => r.id === s.state[n.active_state_key].initial),
        "FLOW_START",
      );
      need(
        edges.every(
          (e) =>
            nodes.some((r) => r.id === e.from) &&
            nodes.some((r) => r.id === e.to),
        ),
        "FLOW_EDGE",
      );
    }
    if (n.kind === "StepViewer") {
      need(
        own(s.datasets, n.steps_key) && own(s.state, n.step_state_key),
        "STEP_REF",
      );
      const st = s.state[n.step_state_key];
      need(
        st.kind === "number" &&
          st.min >= 0 &&
          st.max < s.datasets[n.steps_key].rows.length &&
          st.step === 1,
        "STEP_RANGE",
      );
    }
    n.children?.forEach((c) => node(c, d + 1));
  };
  node(s.view);
  return s;
}
