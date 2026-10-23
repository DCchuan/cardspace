// 设计样例：此语言只由专用 AST 编译器读取，不直接 import/执行。
import {
  defineExperience, Stack, Heading, Paragraph, Slider, BarChart, SourceLink,
} from "@cardspace/experience";

export default defineExperience({
  version: "experience.v1",
  title: "推荐排序参数实验",
  mode: "explainer",
  assumptions: [{
    id: "simplification",
    text: "兴趣分与质量分使用线性加权；候选数据为合成教学样例，不代表任何平台的真实参数。",
    origin: "illustration",
    source_refs: ["s1"],
  }],
  state: { alpha: { kind: "number", initial: 0.8, min: 0, max: 1, step: 0.1 } },
  datasets: {
    candidates: {
      origin: "illustration", source_refs: [],
      rows: [
        { id: "A", label: "候选 A", interest: 0.9, quality: 0.3 },
        { id: "B", label: "候选 B", interest: 0.5, quality: 0.8 },
        { id: "C", label: "候选 C", interest: 0.2, quality: 0.6 },
      ],
    },
  },
  derivations: [{
    id: "ranking", op: "rank_linear", input: "candidates", limit: 3,
    terms: [
      { field: "interest", weight: { state: "alpha" } },
      { field: "quality", weight: { op: "sub", args: [{ literal: 1 }, { state: "alpha" }] } },
    ],
  }],
  actions: {},
  view: (
    <Stack id="root">
      <Heading id="title" text="推荐排序参数实验" />
      <Paragraph id="disclaimer"
        text="教学示例：模型和数值均为简化假设。拖动权重可观察排序变化。"
        origin="illustration" source_refs={["s1"]} />
      <Slider id="weight" label="兴趣权重" state_key="alpha" />
      <BarChart id="chart" label="示例排序分数" data_key="ranking"
        label_key="label" value_key="score" />
      <SourceLink id="source" ref_id="s1" />
    </Stack>
  ),
});
