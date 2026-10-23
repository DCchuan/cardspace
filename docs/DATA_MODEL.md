# 数据模型

完整 SQL 为 `migrations/001_initial.sql` 、`002_minimal.sql` 与 `003_experiences.sql`，当前 schema version=3。v1 升级前对非空旧库生成 `pre-v03-*.sqlite3` 恢复副本；已有字段按人工接管处理。v1 / v2 / v3 ZIP 备份均可恢复，v1 在恢复后自动补迁移。

- sources → source_snapshots：来源身份与内容哈希分离，快照 BLOB 保留原始文字 / JSON / 二进制文档。SQL 触发器禁止更新和删除快照。snapshot_origins 将每个对话快照连接到完整导出文件，原始字节与额外元数据均可下载。
- source_snapshots → conversations → messages：每个导入版本拥有独立会话，消息保存原始节点 ID、父节点、角色与导入位置；旧快照与旧会话不会覆盖。
- conversations → question_memories ↔ memory_messages ↔ messages：确定性提取每条用户消息及相关回答。连续追问语义合并未启用。
- sources / conversations → cards → card_revisions：卡片仅保存当前展示指针、标签、知识状态、收藏和归档。每次内容编辑追加修订，expected_revision_id 防止静默覆盖。
- cards ↔ card_links：人类确认的对称关联，用排序后的 ID 对保证幂等。
- sources / snapshots → knowledge_documents → knowledge_chunks：原始文件、文档描述、文本与页码 / 字符定位。
- cards ↔ evidence ↔ knowledge_chunks：关联结论与参考段落。普通引用 verdict=reference，不能直接变成 supported。
- jobs → audit_findings：任务持久化输入、尝试次数、进度、错误与结构化结果，体检发现独立保留处理状态。
- approval_requests → card_revisions：候选版本父指针必须仍是当前版本才能采用。Agent 无审批权限。
- operation_logs：主体、动作、对象、必要元数据与时间；不存 API key 或模型服务错误响应正文。
- embeddings：card_id、revision_id、model、vector JSON。与全文索引一样可以重建，不替代原始资料。

知识状态 draft/unverified/supported/contested/outdated 与收藏 / 归档状态分离。归档是可恢复操作，本版本不提供永久删除。


## V0.3 自动处理与字段接管

- `captures`：原始提交 BLOB、文件名、actor、处理状态、确定性路由、结果 ID、失败原因与关联任务。触发器禁止改写 raw / filename / actor。先提交此事务再入队；重启会找回尚未入队的原始提交。失败不创建冒充已完成的对话卡片。
- `field_ownership`：card_id + field 唯一，owner=human/rule/model，依据的 revision、策略/模型、否决主题与更新时间。人工修改仅锁定实际改动字段，重新生成只作用于指定字段。恢复历史与人工批准版本也获得人工保护。
- `model_usage`：按 UTC 日期、用途与输入字数记账。自动元信息、语义索引与语义查询共用请求上限，失败也计数。单次超字数直接保留本地结果；这是调用次数/字数预算，不是货币费用保证。
- `capture.dismiss` 操作日志：只收起无需处理的回执，不篡改采集完成度、不删除原始输入。

已有 REST / MCP 输入及不可变 source_snapshots 不变。正文和事实状态不属于自动元信息写入范围；来源修正只改变显示名称，不改写真实来源或原始快照。

V0.4 新增独立的 Experience/Context/Quote/Grant/Run/Call/Artifact/File/State 表。上下文、报价、授权、产物与文件不可变；当前版本指针通过 CAS 修改。升级前备份 pre-v04，恢复时核对产物/文件/引用/响应哈希。详见实施记录。
