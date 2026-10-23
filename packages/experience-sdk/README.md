# CardSpace Experience SDK v1

这是一种静态语言，不是可运行的 React 包。源码只允许：

```tsx
import { defineExperience, Stack, Heading, Button } from '@cardspace/experience';
export default defineExperience({ /* 固定 ExperienceSpec 属性，view 允许 JSX */ });
```

规范：`packages/experience-contracts/experience.v1.schema.json`。示例：`packages/experience-examples/`。

组件：Stack/Grid、Heading、Paragraph、Slider/Toggle/Input/Select、Button、BarChart/LineChart、DataTable/List、FlowGraph/StepViewer、SourceLink。每个组件必须有唯一 id。只使用 Schema 中的属性；不支持任意 React props、HTML、URL、CSS、函数或依赖。

状态 number 需 initial/min/max/step，boolean 需 initial，string 需 initial/max_length。表达式只有 `{literal:标量}`、`{state:状态名}`、`{op:运算名,args:[表达式]}`。算术 add/sub/mul/div/min/max 为二元，clamp 和 if 为三元；eq/lt/and/or 二元。深度最多 8，类型必须一致。if 首项是布尔；数字有界，除零报错。

数据集有 origin、source_refs、rows。rank_linear 按声明 terms 求加权和，生成 score 降序排序；同分按 id 排序。不能传函数。

动作 set、transition、sequence、append_row、remove_row。transition 在当前状态选择首个符合 guard 的边；无符合边时不变。sequence 禁止循环；append_row 自动分配本地 row_N ID，最多合计 500 行。Button 用 action_id。条件显示使用 visible_when。

FlowGraph：nodes_key 对应含字符串 id/label 的数据集，edges_key 对应 from/to 数据集；active_state_key 为字符串状态。StepViewer：steps_key 含 label/text，step_state_key 为 0 到行数减一的整数状态。

引用 ref ID 由 ContextPack 分配，不能自造。Paragraph/assumptions/datasets 中 source/derived 必须有来源；illustration/hypothesis 可为空。所有生成产物均需人工核对关系正确性。变化、重置、播放不请求模型。
