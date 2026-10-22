# 安全与权限

只监听 127.0.0.1。Host 中间件防止 DNS rebinding；有 Origin 的请求只允许已知本地来源；拒绝 cross-site Fetch Metadata。前端无跨源 CORS 授权。JSON API 与自定义会话引导请求头阻断跨站表单写入。

UI 通过 HttpOnly / SameSite=strict cookie 登录本地会话。Agent 使用独立 Bearer token。两类凭据不互换；Agent 无法访问 /settings、审批通过或拒绝、恢复版本、建立关系、引用管理、备份恢复等人类管理接口。已有内容修改必须通过 proposed revision。

会话 bootstrap 是本地 UI 的无密码入口，不防御已经具有本机执行权限的恶意程序。对同一 OS 用户运行的不可信程序，依赖 OS 权限与磁盘安全。不要将本地服务映射到公网。

共享链接严格限制 ChatGPT / DeepSeek 的 HTTPS 官方共享地址，每次重定向都重新检查域名与路径，禁用环境代理并限制响应体。模型 Base URL 是用户明确配置的信任边界；远程地址必须 HTTPS，HTTP 仅限回环本机模型。禁用自动重定向，避免密钥跟随跳转泄露。

外部资料不作为系统指令。模型提示明确禁止遵循资料内部的命令；输出通过 Pydantic 校验且仅作为候选修订。没有执行模型输出代码或动态工具的路径。

上传大小上限 32MB，文本 JSON 上限 24M 字符，DOCX 解包上限 100MB。PDF / DOCX 是可信本地单用户输入，复杂解析不放到互联网多租户环境。扫描 PDF 显示 OCR 限制。

备份不是加密文件。用户应保管备份，并使用 OS 磁盘加密。恢复来自自己创建且可信的备份，不导入不可信 SQLite 模式文件。备份不包含模型密钥与认证令牌。

源码下载与备份下载分离。源码包使用受限文件集合，排除运行数据、环境文件、依赖安装目录与原始规划附件；配置的 CARDSPACE_DATA_DIR 也从源码包排除。下载要求人类会话，不向 Agent 暴露整个工作区。


2026-10-23 会话修复：Cookie 名称包含访问端口（`cardspace_session_<port>`），避免同一主机的开发、验收与正式服务相互覆盖。仍然使用 HttpOnly / SameSite=strict Cookie，不向前端或日志暴露认证 secret。前端会验证握手 HTTP 状态，遇到 401 共享一次会话续期，并最多重发一次原请求；403 不自动重发。续期失败后可明确重新连接，连接等待设有 10 秒上限。Origin / Host / Agent 权限保持后端校验。
