# ADR 002：受控源码驱动交互演示

状态：已实施，2026-10-23。

V0.4 接受唯一 experience.tsx 文件、固定 SDK 命名导入及 defineExperience 声明。Babel 仅解析；白名单 AST 转为固定 JSON Schema，再做交叉引用、类型、图和资源检查。生成文件不进入 npm、esbuild、eval、vm 或动态 import。

可信 React 渲染器与 Worker 由维护者源码在构建时打包。Schema 校验器也在构建时生成，不开放 unsafe-eval。首批图表、流程使用自有组件，不新增 ECharts/React Flow。所有文字按文本显示。

iframe 为 opaque origin，只有 allow-scripts；CSP 不允许网络、外框架、表单与外部内容。父界面只给 Spec/ref ID/演示状态，不给认证。MessageChannel 绑定随机实例和 nonce，来源只接受 allowlist 中的 ref ID。Worker 有墙钟超时、步骤、节点/行数与表达式深度限制。

这不是任意代码 OS 沙箱：Node 静态编译器仍有系统用户权限。必须维护审阅其源码；限制文件名/输入、剥离环境、堆/时间上限不能代替 OS 隔离。

通用兼容模型只提供估算预算模式，限制调用次数/输入字节/请求输出参数；无法保证供应商精确计费 Token 上限。缺失 usage 与结果不明的调用会停止，不自动重发。真实模型质量与用户理解效果是独立发布门槛。
