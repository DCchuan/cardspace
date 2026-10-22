# API 契约

启动服务后访问 `/docs` 和 `/openapi.json`；已导出的静态契约位于 `packages/contracts/openapi.json`。Base URL 为 `/api/v1`。接口输入由 Pydantic 校验。

浏览器 `POST /session`，要求同源自定义头 `X-CardSpace-Client: web`，返回 HttpOnly cookie。Agent 使用 `Authorization: Bearer <agent.token 文件内容>`。

主要接口：cards(GET/POST)、cards/{id}(GET/PATCH)、notes(POST)、imports/preview(POST)、imports(POST)、conversations/{id}(GET)、memories/{id}(GET)、search(GET)、memory-search(POST)、cards/{id}/revisions(GET/POST)、optimization-jobs(POST)、audit-jobs(POST)、jobs/{id}(GET)、jobs/{id}/retry/cancel(POST)、findings(GET)、approvals(GET)、knowledge-documents(GET/POST)、evidence(POST)、settings(GET/PATCH)、backups(POST)、restore(POST)。

分页使用 limit<=100、offset；卡片 PATCH 与修订提交必须携带 expected_revision_id，冲突返回 409。修改同一张卡片应重新读取当前版本后重试，不能静默重放旧内容。

异步创建返回 202 与 job_id。状态依次为 queued / running / completed 或 partial / failed / cancelled。只有 completed / partial 的结果内存在 card_ids 才表示保存内容已完成。前端订阅任务轮询并在任务状态改变后刷新相关缓存。

搜索返回 items / total、matched_memories、original_question、summary、message_ids 与 conversation_id。无命中返回空列表，不生成历史记忆。memory-search 的 semantic=true 将查询发送至配置的 embedding 模型，需要先允许模型处理与建立索引。

高风险与管理端点需要 human session，Agent Bearer token 返回 403。所有写入通过服务层事务提交后返回。


## V0.3 统一录入与极简界面接口

- `POST /captures` `{content}` / `POST /captures/file` multipart `file`：202 返回 capture 元数据与 job_id。响应中的 saved 意味着原始提交已持久化，**不是**对话已采集。
- `GET /captures/{id}`：saved / processing / completed / partial / failed、route、result 与 error。`GET /captures/{id}/raw` 获取原始提交。`POST /captures/{id}/retry` 重试失败；`POST /captures/{id}/dismiss` 只收起终态回执。`GET /captures` 返回未收起的非完成回执。
- `PATCH /cards/{id}` 增加 card_type / source_label（human 专用；后者只是来源显示名称）。对正文/标题/摘要/主题的实际人工修改按字段保护，不允许自动任务覆盖。
- `POST /cards/{id}/regenerate` `{field: title|summary|tags, expected_revision_id}`：人类明确重新生成一项规则元信息；保留已否决主题。其他字段不解锁。
- `GET /cards/{id}/reference-candidates`：返回与当前卡片相关的参考分块候选。既有 `POST /evidence` 使用已知 card_id，无须重新选择目标；引用不会自动判定支持证据。
- `POST /knowledge-documents/{id}/to-note`：保留原始资料，另存可编辑笔记；不拼接重叠分块，重新解析原始文件。
- `POST /search/supplement` `{query,kind,tag,source,days,favorite,archived,limit}`：human 自动语义补充，尊重过滤条件、单独范围授权与每日预算；失败返回空补充，不中断关键词搜索。缓存 5 分钟；前端只追加新命中。
- `GET /models`：human 在允许连接后尝试服务模型发现，支持手工填写兜底。
- Settings 增加 auto_metadata、auto_semantic（默认关闭）、model_daily_calls=20、model_max_input_chars=16000、default_tag。自动请求失败也计数；旧库不会因为打开开关而整库重写。

MCP 新增 `capture_memory(content)`，其余 14 个工具保持兼容。Agent 可以提交原始内容，但不触发 human 专属的自动模型范围，不能访问模型设置或解除人工字段保护。
