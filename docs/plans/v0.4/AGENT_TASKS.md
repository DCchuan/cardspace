# V0.4 Agent 实施任务书

状态：实施前任务，不自动启动开发。不更改现有服务或向真实模型发起请求。本目录的契约/样例是设计输入，尚无可运行 SDK/编译器。

先阅读 `BLUEPRINT.md`。出现不一致时，先修订契约和本文件，再实现；不能自行增加任意代码执行回退、自动付费重试或默认全库读取。

## A. 目录与所有权建议

```text
packages/experience-contracts/        # 从本目录草案迁移，规范 JSON Schema 与 TS 类型
packages/experience-sdk/              # 受控 TSX 的类型、组件描述、写码文档；不是 eval 包装器
packages/experience-compiler/         # Node CLI：Babel AST → 规范 ExperienceSpec
packages/experience-runtime/          # 可信 React 渲染器、表达式/状态执行、Worker、iframe 桥
packages/experience-examples/         # 三类合成 golden fixtures + 固定 oracle
packages/prompts/experience-plan.v1.md
packages/prompts/experience-code.v1.md
packages/prompts/experience-repair.v1.md
apps/api/app/services/experiences.py
apps/api/app/services/experience_context.py
apps/api/app/services/experience_budget.py
apps/api/app/workers/experience_queue.py
apps/api/app/adapters/experience_model.py
apps/web/src/experiences/              # 入口、授权、查看器、依据、版本、源码
migrations/003_experiences.sql
```

父卡片、原始来源与人工修订沿用旧表；不要复制一套卡片/用户系统。演示生成时不要从用户工作目录扫描其他文件。

## B. 工作包（顺序表示依赖，不代表已授权分派子 Agent）

### W0：能力/契约冻结

输入：本目录 Schema、代码样例、BLUEPRINT 第 5–8 节。

交付：固定 ExperienceSpec、ContextPack、KnowledgePlan、BudgetPolicy、Grant、CompilerDiagnostic、RuntimeMessage 契约；三类合成样例；ADR「为什么首版只接受受控代码」。本目录 Schema 先覆盖参数实验，实施时扩展流程与原型前须增加契约和 goldens，不能用任意 props 字典绕过。

验收：TS/Python 对所有正反例判定相同；Schema 使用固定本地引用；词法/组件/表达式能力明确；不访问真实模型。决定图表/流程图库最小集合，锁定依赖与 NOTICE。

### W1：静态编译器

依赖 W0；可先做，不等待模型。

交付：`compile({files,sdk_version,source_ref_allowlist}) -> {spec,diagnostics}`；固定入口/文件名；JSON stdio CLI；至多 128 KiB 源码、200 节点、深度 8；可解释的错误码和源码行列。

必测：import FS/网络模块、import alias 混淆、JSX spread、computed property、getter、函数 props、顶层副作用、`__proto__`、`constructor`、超大 AST、文件路径穿越、外部 schema 引用。只遍历白名单 AST，不运行源码，不读取模型提供的构建配置。

验收：`examples/recommendation.experience.tsx` 编译后与规范 JSON 在排除排版/对象键顺序后完全一致；非法代码不会落入 esbuild 执行。超时可杀掉 CLI，主 API 不崩溃。

### W2：可信运行时

依赖 W0；W1 的 Spec 可先用固定夹具替代。

交付：参数实验、流程推演、产品交互原型三套可运行例子；可信组件注册表；有界逻辑 Worker；事件/action ID；重置、状态快照和错误恢复；来源引用桥。

约束：所有文字按文本渲染；禁用 raw HTML/CSS/URL 和回调字符串；ECharts/React Flow 如使用，只通过固定 props 映射。不能接受任意 options 透传。依赖离线打包；schema 验证器构建期生成，不为 Ajv 打开浏览器 unsafe-eval。

验收：示例权重 0.8→0.2 改变排序，固定 expected 数值一致；流程边界和产品列表操作可确定复现；任何交互不会发起模型请求。恶意 postMessage 无法调用主 API；关闭/重置能恢复挂起的 Worker。原文定位事件只接受授权 ref ID。

### W3：存储、授权与预算

依赖 W0，和 W1/W2 可交错开展但先冻结接口。

交付：migration 003、旧库升级/备份回滚、不可变产物/ContextPack、引用哈希、报价和 grant、调用台账、版本指针 CAS、文件导出基础。

约束：现有 `model_usage` 不是 Token 账本。未知价格不显示 0 元，未知 tokenizer 不宣称严格 Token 上限。响应缺失 usage 不可默认按 0 结算继续跑。模型和上下文指纹不符必须重新报价。

验收：同一 quote 重复点击幂等；Agent token 不能发起软件付费生成；预算不足请求在发送前停止；取消仍记录已知费用；v1/v2/v3 备份可恢复且逐文件哈希验证。测试在临时 DB 内执行。

### W4：隔离任务通道与模型编排

依赖 W1–W3。

交付：Plan→Code→Compile→Validate→最多两次 Repair 的检查点执行；单个 active generation 默认值；超时/取消/恢复；外部响应先持久化后校验。

必须同时处理旧机制：

- `workers/queue.py` 普通 worker 的领取范围排除新生成类型，避免抢走任务。
- `db.init_db()` 原本将 running 一律改 queued 的恢复语句排除演示外部调用；有 in_flight 未确认响应时设 recovery_required。
- `/jobs/{id}/retry` 不得绕过演示 grant/预算；对演示任务返回引导到专用继续流程。
- 通用取消入口对演示调用应用 human 权限与调用状态逻辑；不是只改 jobs.status。
- 首版 API 保持单进程；Node/浏览器子进程不直接操作 SQLite。不得把进程内 RLock 当成跨进程锁。

验收：第 N 次供应商请求后注入崩溃，不自动重打不确定请求；响应已持久化时重启从本地输出继续；正常导入不会被演示长请求饿死。429、断网、输出截断、非法 JSON、未知 usage 和不足余额均有稳定错误码。

### W5：极简产品入口

依赖 W2–W4。

交付：卡片上单个常显入口、生成授权轻面板、进度、查看器、依据、版本、修改要求、源码查看/导入与导出。卡片列表批量返回 experience_summary，避免每张卡片额外查询。

按钮状态按 BLUEPRINT 第 3 节。已有演示打开不弹付费确认；重新生成才确认新的任务范围。无模型/无内容时提供配置/补内容入口，保留卡片阅读。修复失败旧产物继续打开。

验收：桌面与 360px 窄屏可完成生成/打开/找回依据；键盘可达，入口不只在 hover 显示；中文输入法不会误提交；用户无需填写框架、模板 ID、组件类型、依赖等技术字段。

### W6：模型评估与开源交付

依赖 W1–W5。

交付：24 个脱敏案例、每例目标与 oracle、攻击夹具、真实授权模型评估记录、离线导出包、许可/NOTICE/贡献文档、回滚说明。

验收：BLUEPRINT 发布门槛全部给出证据。前后端当前回归通过；预算上限和语义正确性分别测量；不把编译成功当作知识正确。未通过的案例标记 unsupported，不用不受控执行兜底。

## C. 必须冻结的接口样例

### 报价请求（零模型调用）

```json
{
  "expected_revision_id": "rev_current",
  "mode": "explainer",
  "goal": "观察权重变化如何影响排序",
  "scope": {"selection": "current_card", "include_original_questions": true, "include_linked_evidence": false},
  "budget_policy": {"max_calls": 4, "max_repairs": 2, "max_total_tokens": 30000, "accounting_mode": "strict_if_supported"}
}
```

响应包含：quote_id、context_fingerprint、model_config_fingerprint、已选范围与字数、token_estimate、estimate_quality、会生效的预算模式、expires_at、blocked_reason。若只能提供 estimated 模式，用户确认时必须能看到，不得伪装成 strict。

### 生成请求

```http
POST /api/v1/experience-quotes/quote_x/generate
Idempotency-Key: client-generated-unique-id
Content-Type: application/json
```

```json
{"accept_model_fingerprint":"sha256:...","accept_context_fingerprint":"sha256:...","accept_budget_mode":"strict","base_artifact_id":null}
```

202 响应返回 experience_id、run_id、job_id。服务端只从已持久化 quote 读资料与限额，不接受请求中临时塞入任意模型 URL 或更大资料范围。

### 运行时事件

```json
{"protocol":"experience-bridge.v1","instance_id":"frame_x","nonce":"ephemeral","type":"OPEN_SOURCE","payload":{"ref_id":"s1"}}
```

事件不包含 API path、URL、Cookie 或密钥；验证 source window/MessagePort、nonce、实例、ref allowlist、字段和大小。模型不可编写任意 bridge 方法。

## D. 小步交付与审阅方式

推荐第一份实现任务只做 W0+W1 的参数实验纵切片：一次命令把合成 TSX 编译成固定 Spec；非法 import 和函数 props 被拒绝；完全不接模型、不改线上 UI。第二份交付再做可信运行时，第三份接报价/授权/存储，之后才启用真实生成。

每份交付说明：新增了什么能力、不能表达什么、触及哪些文件、用哪些反例验证、能否完全离线、是否产生任何外部模型调用。不要在没有证据的情况下写“已安全沙箱化”“不会超费”“任何领域都能生成”。
