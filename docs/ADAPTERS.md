# 添加一种对话来源

CardSpace 将来源解析与记忆构建分开。新的 AI 平台只需要提供规范化消息，保存原文、问题引用、卡片、索引与版本的逻辑由统一服务完成。

## 已支持

| 来源 | 链接 | 文本 / JSON |
|---|---|---|
| ChatGPT | 官方 HTTPS `/share/<id>`，提取页面中的结构化快照 | mapping 导出、通用 messages、角色标记文本 |
| DeepSeek | `https://chat.deepseek.com/share/<id>`，读取公开分享内容 | 当前 fragments JSON、旧版 content / thinking_content JSON、DeepSeek: 角色文本 |
| 其他 AI | 暂无链接适配器 | 通用 messages JSON 或手动确认角色的文本 |

私有聊天地址不是公开分享链接。适配器不读取账户 Cookie、不登录、不绕过访问限制。失效、被删除、受限和超过大小上限的内容应返回明确错误。`complete` 仅表示已采集该分享快照支持的数据，不代表包含账户中之后追加的消息。

DeepSeek 当前分享页面通过同域 `GET /api/v0/share/content?share_id=<id>` 返回 JSON。实现依据实际公开响应验证，兼容 REQUEST / RESPONSE / THINK / FILE 片段；它是网页内部接口，不是具有稳定兼容承诺的模型 API。格式可能改变，请用合成测试保护回归。搜索和最终回答摘要不混入思考片段；思考片段在消息 metadata 中独立保存，并在原文界面默认折叠。TIP / TOOL_SEARCH / TOOL_OPEN 等元信息保留在完整原始 JSON 中。未知片段、缺少最终回答或缺少附件二进制时返回 partial。

## 实现位置

- `apps/api/app/adapters/shares.py`：ShareReference、ShareAdapter Protocol、URL 识别与 ADAPTERS 注册表。
- `apps/api/app/adapters/deepseek.py`：DeepSeek JSON 与片段解析，可离线测试。
- `apps/api/app/adapters/conversations.py`：角色文本、ChatGPT 导出与共享页面解析。
- `apps/api/app/services/imports.py`：统一入库与问题引用。来源身份包含 provider，两个平台相同 share_id 不会混淆。

## 规范化结果

```python
{
    'provider': 'new_provider',
    'title': '对话标题',
    'external_id': 'stable_share_id',
    'status': 'complete',  # 或 partial
    'warnings': [],
    'messages': [
        {'external_id': '1', 'role': 'user', 'content': '原始问题'},
        {'external_id': '2', 'parent_external_id': '1',
         'role': 'assistant', 'content': '最终回答', 'metadata': {}},
    ],
}
```

实现 `capture(reference) -> (raw, conversations)`。raw 必须是实际取得的原始响应，不要先用模型重写。roles 标准化为 user/assistant/system/tool；ID 转为稳定字符串。保留返回消息顺序和父节点。没有父节点的线性消息使用相邻问题边界建立回答引用。

在 URL 识别器中加入官方分享域名与精确路径，再在 ADAPTERS 中注册实现。每次重定向都验证目标，限制响应体与超时；不要将用户提交的任意地址当作可抓取目标。界面展示名称放在 `apps/web/src/api.ts`，来源筛选与原文助手名称也要同步。

## 验证

参照 `tests/test_deepseek.py`。使用合成夹具覆盖正常片段、旧格式、附件、无最终回答、未知片段、失效业务码、跨域重定向、来源隔离、重复导入及问题到原文引用。真实链接只用于本地临时验证，不将别人的对话放入仓库或源码包。
