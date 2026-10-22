# ADR-001 — 本地模块化单体

状态：已采用。

采用 React + FastAPI + SQLite。业务 services 被 UI API、MCP 与持久化 Worker 共用。默认数据在 OS 用户目录，网络模型默认关闭。原始快照不可变；展示修改追加 Revision；Agent 修订必须审批。以问题为检索入口，先关键词，配置后叠加 Embedding。

为控制单机复杂度，本版本不用 Redis / Celery / 微服务。Worker 在 API 生命周期内运行，一个数据目录只支持一个 API 进程。跨进程或远程访问应新增 ADR 与租约 / 认证方案，不能直接开放端口。
