# V0.4 交互演示：实施前图纸

本目录仅交付方案、契约草案和合成样例；没有修改当前应用功能，没有调用模型生成正式产物。

1. 阅读 [整体蓝图](BLUEPRINT.md)：产品范围、交互线框、架构、技术选型、执行边界、预算、状态机、存储/API、阶段与验收。
2. 按 [Agent 任务书](AGENT_TASKS.md) 实施：先契约和静态编译，再可信运行时，之后接存储/预算/模型，不直接让任意生成脚本进入主应用。
3. 从 [受控 TSX 源码](examples/recommendation.experience.tsx) 和 [期望 Spec](examples/recommendation.experience.json) 开始第一份编译 golden test。
4. [JSON Schema 草案](contracts/experience.v1.schema.json) 定义数据边界；[引用样例](examples/recommendation.evidence.json) 与 [独立数值 oracle](examples/recommendation.oracle.json) 区分来源、教学假设和运行结果。

Schema 包含基础组件、状态和常见动作；首份样例覆盖参数实验。集合推导目前只规范 rank_linear，其他变换必须先扩展契约与 oracle，不能将 JS 函数/原始 option 当透传捷径。JSON Schema 不负责验证交叉引用、初值是否在 min/max 内、布局总数、表达式递归深度、图闭环等全部语义约束，这些是编译器和运行时的额外职责。

验证记录：JSON Schema 自身和参数样例有效；合成引用哈希、数值 oracle 以及 TSX 的 Babel 语法检查在交付前核验。尚未实现编译器，因此不声称已完成 TSX→Spec 的真正编译或演示运行验证。
