# 参与 CardSpace

欢迎提交问题、改善中文 / 英文文档、优化检索、设计更安静的界面，或为新的 AI 对话来源编写适配器。项目采用 [MIT License](LICENSE)，贡献遵循同一许可证。

## 本机开发

需要 Node.js 22+、Python 3.12（最低 3.10）。无需 Codex、云账户或模型密钥。

```bash
bash scripts/setup.sh
npm run dev
```

前端：http://127.0.0.1:5173；本地 API：http://127.0.0.1:8765。可用 `CARDSPACE_DATA_DIR` 指定临时数据目录。请使用合成数据，不上传个人对话、数据库、令牌、模型密钥或备份。

```bash
npm test
npm run build
npm run source
```

CI 自动执行后端测试和前端生产构建。修改依赖后更新对应 lockfile，并运行 `npm run notices` 更新第三方归属。

## 从哪里开始

- 来源适配：[docs/ADAPTERS.md](docs/ADAPTERS.md)。DeepSeek / ChatGPT 都进入同一个记忆构建服务，不能绕过版本或权限规则。
- 界面取舍：[docs/DESIGN.md](docs/DESIGN.md)。优先减少可见内容，不为功能存在而增加常驻入口。
- 业务架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。修改业务规则放在 services，外部格式放在 adapters。
- 当前范围：[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。文档中的未来计划不是已实现的承诺。

小修改可直接发 PR；新的数据模型、后台行为或外部服务连接，先在项目仓库发 Issue 说明问题和方案。PR 请说明用户能观察到的变化、验证方式和兼容性。新适配器需要合成夹具及成功、部分成功、失效、重复导入和恶意 URL 的测试。

## 贡献约定

保留原始快照，展示修改创建新修订；不要让 Agent 批准自己的修改。基础记录与关键词检索必须离线可用。新增网络行为应默认关闭或由明确的导入动作触发。避免没有必要的依赖和强制账户。

不要求转让版权或签署额外 CLA。提交者应确认自己有权贡献代码；未经授权不搬运第三方代码、真实对话或附件。外部资料仅作为格式参考时请注明出处和可验证的边界。

## 发布

维护者按 [docs/RELEASE.md](docs/RELEASE.md) 验证、构建与打包。本地源码包使用白名单，默认排除运行数据、原始规划附件和依赖安装目录。实际发布仍需维护者检查内容与第三方许可证。
