# CardSpace

[English](README.en.md) · [贡献指南](CONTRIBUTING.md) · [MIT License](LICENSE)

开源、本地优先的个人知识与 Agent 记忆工作台，支持 ChatGPT 与 DeepSeek。React 19 + TypeScript + FastAPI + SQLite FTS5。

保存完整来源，从历史问题重新找到当时的回答；用可审批、可回溯的修订持续整理知识。

## 运行

需要 Node.js 22+，Python 3.10+（推荐 3.12）。无需 Codex 或模型账户：

```bash
bash scripts/setup.sh
npm start
```

打开 http://127.0.0.1:8765 。也可双击 `启动 CardSpace.command`。

如果依赖已经安装，可以直接运行 `npm start`。

开发模式：`npm run dev`，界面在 http://127.0.0.1:5173 ，API 在 8765。不要同时启动 dev 与 start。

测试：`npm test`。构建：`npm run build`。API 文档：http://127.0.0.1:8765/docs 。API 路由需要本地会话或 Agent Bearer token。

## 已实现

- 中文响应式工作台：瀑布流、列表、类型 / 来源 / 标签 / 日期筛选、排序、分页、收藏、可恢复归档。
- 统一「新建记忆」：文字、ChatGPT / DeepSeek 分享链接、对话 JSON、拖入文件无需先选类型或来源。提交先保存原始输入，失败可就地重试、下载原始输入或粘贴原文。文件暂存后统一保存。
- 确定性角色文本自动导入，无强制预览；ChatGPT `conversations.json`、DeepSeek fragments / content JSON 和通用 `messages` JSON 导入；保留原始 JSON、消息父节点和所有分支。重复来源更新为新快照并复用原卡片。
- DeepSeek 公开分享链接：独立适配公开分享 JSON，保留消息父节点、正文和思考片段。思考片段独立折叠展示，不混入最终回答摘要。
- ChatGPT 公开共享链接适配器：域名与重定向白名单、响应大小限制、结构化快照解析。访问失败 / 动态格式不兼容会明确失败，不会假装完整采集。
- 独立问题记忆与原始消息引用。FTS5 trigram + 中文短词 / 二元子串补充召回。搜索结果直接打开原始问答与定位。
- 标题、摘要、主题就地修改，正文聚焦编辑器自动保存；本机草稿、输入法组合保护、409 冲突提示和撤销。逐字段人工接管、删除主题的否决记录，重导入与迟到 AI 不覆盖人工字段。
- 版本历史、恢复、乐观锁、候选修订、内容变化对比、标题摘要标签对比及人类审批；Agent 无法批准修改。
- 规则自动提取标题、摘要与已有主题；可选模型只填充低风险元信息并验证摘要来自原文。自动元信息 / 语义分别授权，共用每日请求上限与单次字数上限；旧库不批量重写。服务预设、可选模型发现与明确默认主题偏好。
- 本地格式整理；可配置 OpenAI-compatible 结构化 AI 整理；默认关闭数据外发。API key 存入系统凭据存储。
- 本地搜索先返回；在单独授权自动语义处理后，新录入及后续修改增量建立索引，语义结果只补充新卡片，不重排当前本地结果。查询防抖、取消、缓存，模型失败自动回退。兼容 API 保留手动 Embedding / RRF 混合召回。
- 持久化 SQLite 任务队列：进度、取消、重试、重启恢复。自动 / 手动 / 导入后规则体检；按主题检查，最久未审查优先、分批覆盖。
- 体检规则：180 天未复核、知识卡片参考缺失、疑似重复；短笔记和缺少主题不再产生待办。结果可处理 / 忽略 / 重新打开。结果是线索，不自动判错。
- Markdown / TXT / PDF / DOCX 参考库，保留二进制原文件，分块、页码 / 字符定位、全文检索、卡片段落引用和知识关联。自动匹配当前卡片的候选段落，无需重选目标；资料可再次保存为笔记。
- SQLite backup API 安全备份、定期备份、ZIP 可迁移包、SHA-256 与完整性校验、真实恢复及恢复前自动回滚备份。
- 回环监听、Host / Origin 校验、HttpOnly SameSite 会话、独立 Agent token、后端权限分离与操作日志。
- stdio MCP：搜索 / 阅读、创建笔记与卡片、统一录入、对话导入、候选修订、相关知识、知识体检、任务状态与待审批清单。

## 本地数据

macOS 默认 `~/Library/Application Support/CardSpace/`；其他系统默认 `$XDG_DATA_HOME/cardspace` 或 `~/.local/share/cardspace`。界面「设置与偏好」可查看实际位置。

数据库、原始文本与文档原文件全部在该目录内；不写入代码仓库。自动备份保留最近 30 份。会话 secret 与 Agent token 为独立的 0600 文件，不进入备份包。模型密钥在 OS keyring，不进入备份。新电脑恢复后需重新配置模型密钥。

可通过 `CARDSPACE_DATA_DIR=/absolute/path npm start` 指定其他目录；`CARDSPACE_PORT` 可指定生产端口。一个数据目录只运行一个 API 进程，不使用 `--workers` 或多实例。

基础录入、阅读、编辑、关键词检索可在断网环境工作。共享链接和外部模型需要网络；模型调用只在设置允许后执行。

## MCP 连接

先启动 CardSpace API，然后在支持 stdio 的 MCP 客户端配置：

```json
{
  "mcpServers": {
    "cardspace": {
      "command": "/absolute/path/cardspace/.venv/bin/python",
      "args": ["/absolute/path/cardspace/apps/mcp/server.py"]
    }
  }
}
```

若使用自定义数据目录，应在 MCP 环境中设置同一个 `CARDSPACE_DATA_DIR`。自定义 API 地址使用 `CARDSPACE_API_URL`。适配器只通过 API 操作，不直接读取 SQLite。

Agent 可以调用 `submit_revision` 提交自行生成的内容（无需二次模型调用），或 `propose_revision` 发起本地 / 模型整理任务；候选版本都需要用户在界面中批准。不会向 Agent 暴露审批、设置、备份恢复与原始数据永久删除工具。

## 验证与边界

详见 [验收记录](docs/ACCEPTANCE.md)、[实现覆盖](docs/IMPLEMENTATION.md) 和 [架构](docs/ARCHITECTURE.md)。这是可运行的 V0.3 实现，不能等同于 PRD 中未来的全部 V1.0 / P2 规划。

- 共享网页格式可能变化；本版本只提取可获得的结构化数据。DeepSeek 适配已经验证真实公开响应样本；内部分享接口可能变化。ChatGPT 动态页面仍可能不兼容，JSON / 粘贴可作为兜底。
- JSON 中的图片 / 音频附件保存原始元数据并标记缺失；不自动从账户拉取附件，不支持导出 ZIP 批量解包。未支持的单链接只保存为链接备忘，不声称取得正文。
- 规则体检未实现基于模型的事实核查、适用条件分析或自动冲突判断。不会将普通参考引用标为“事实已证实”。
- 语义索引采用本地持久化向量 + 进程内余弦检索，适合个人规模；不是 ANN 大规模索引。第三方模型真实联调需要用户自己的服务与密钥。
- 扫描 PDF 无 OCR；网页参考资料采集、浏览器扩展、连续追问语义分组、卡片 AI 聊天、交互知识图谱及桌面封装属于后续扩展。
- UI 视图保存在当前浏览器会话内，刷新后回到首页。编辑草稿暂存在当前浏览器，已提交输入与正式知识保存在 SQLite；不要依赖未提交附件跨刷新保留。

## 开源与社区

整个项目采用 [MIT License](LICENSE)，允许社区使用、修改与再分发，包括商业与闭源改造。保留版权与许可声明，依赖遵循各自许可证，见 [第三方归属](THIRD_PARTY_NOTICES.md)。

欢迎从 [贡献指南](CONTRIBUTING.md) 和 [来源适配器说明](docs/ADAPTERS.md) 开始。界面遵循 [简洁约定](docs/DESIGN.md)。设置中可以查看许可证、下载当前源码；命令行运行 `npm run source` 也可生成便于迁移与公开的源码包。源码包不包含个人知识库与密钥。

源码托管于 [DCchuan/cardspace](https://github.com/DCchuan/cardspace)，已准备 Issue / PR 模板、社区行为准则、安全报告说明与 CI。固定版本、离线备份与后续开发流程见 [版本与发布](docs/RELEASE.md)。
