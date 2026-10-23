import fs from "node:fs";
const assumption = [
  {
    id: "example",
    text: "本演示为本地教学模拟，不连接实际账户或支付系统。",
    origin: "illustration",
    source_refs: ["s1"],
  },
];
const data = (rows) => ({ origin: "illustration", source_refs: [], rows });
const flow = {
  version: "experience.v1",
  title: "订单流程推演",
  mode: "explainer",
  assumptions: assumption,
  state: {
    stage: { kind: "string", initial: "created", max_length: 30 },
    valid: { kind: "boolean", initial: false },
  },
  datasets: {
    nodes: data([
      { id: "created", label: "创建订单" },
      { id: "checked", label: "校验通过" },
      { id: "paid", label: "支付模拟" },
      { id: "done", label: "完成" },
    ]),
    edges: data([
      { from: "created", to: "checked" },
      { from: "checked", to: "paid" },
      { from: "paid", to: "done" },
    ]),
  },
  derivations: [],
  actions: {
    next: {
      kind: "transition",
      state_key: "stage",
      edges: [
        { from: "created", to: "checked", guard: { state: "valid" } },
        { from: "checked", to: "paid" },
        { from: "paid", to: "done" },
      ],
    },
  },
  view: {
    kind: "Stack",
    id: "root",
    children: [
      { kind: "Heading", id: "title", text: "订单流程推演" },
      {
        kind: "Paragraph",
        id: "intro",
        text: "先满足校验条件，再逐步推进。支付只改变本地状态。",
        origin: "illustration",
        source_refs: ["s1"],
      },
      { kind: "Toggle", id: "valid", label: "资料已校验", state_key: "valid" },
      {
        kind: "FlowGraph",
        id: "flow",
        nodes_key: "nodes",
        edges_key: "edges",
        active_state_key: "stage",
      },
      { kind: "Button", id: "next", label: "下一步", action_id: "next" },
      { kind: "SourceLink", id: "source", ref_id: "s1" },
    ],
  },
};
const prototype = {
  version: "experience.v1",
  title: "待办应用最小原型",
  mode: "prototype",
  assumptions: assumption,
  state: { task: { kind: "string", initial: "阅读原文", max_length: 120 } },
  datasets: { tasks: data([]) },
  derivations: [],
  actions: {
    add: {
      kind: "append_row",
      data_key: "tasks",
      values: { label: { state: "task" } },
    },
    clear: { kind: "set", state_key: "task", value: { literal: "" } },
    submit: { kind: "sequence", action_ids: ["add", "clear"] },
    remove: {
      kind: "remove_row",
      data_key: "tasks",
      row_id: { literal: "row_1" },
    },
  },
  view: {
    kind: "Stack",
    id: "root",
    children: [
      { kind: "Heading", id: "title", text: "待办应用最小原型" },
      {
        kind: "Paragraph",
        id: "intro",
        text: "输入并添加任务，展示本地列表操作。刷新或重置可恢复初始状态。",
        origin: "illustration",
        source_refs: ["s1"],
      },
      { kind: "Input", id: "input", label: "任务", state_key: "task" },
      { kind: "Button", id: "submit", label: "添加任务", action_id: "submit" },
      { kind: "List", id: "list", data_key: "tasks", label_key: "label" },
      {
        kind: "Button",
        id: "remove",
        label: "移除第一个示例任务",
        action_id: "remove",
      },
      { kind: "SourceLink", id: "source", ref_id: "s1" },
    ],
  },
};
for (const [name, spec] of Object.entries({ flow, prototype })) {
  fs.writeFileSync(
    `packages/experience-examples/${name}.experience.json`,
    JSON.stringify(spec, null, 2) + "\n",
  );
  const jsx = (n) => {
    const { kind, children, ...attrs } = n;
    return `<${kind} ${Object.entries(attrs)
      .map(([k, v]) => `${k}={${JSON.stringify(v)}}`)
      .join(
        " ",
      )}${children ? `>${children.map(jsx).join("\n")}</${kind}>` : " />"}`;
  };
  const { view, ...rest } = spec;
  const props = Object.entries(rest)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(",\n");
  const components = new Set(["defineExperience"]);
  const walk = (n) => {
    components.add(n.kind);
    n.children?.forEach(walk);
  };
  walk(view);
  fs.writeFileSync(
    `packages/experience-examples/${name}.experience.tsx`,
    `import {${[...components].join(",")}} from '@cardspace/experience';\nexport default defineExperience({${props},\nview:(${jsx(view)})});\n`,
  );
}
