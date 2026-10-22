# 版本与发布

项目使用 MIT License，源码仓库为 https://github.com/DCchuan/cardspace 。

## 当前版本与后续开发

- `v0.3.0`：当前可运行版本的固定标签，对应 GitHub Release。标签发布后不移动、不覆盖；修复应发布新的版本号。
- `main`：稳定主线。后续开发完成并验证后再通过 Pull Request 合入。
- `feat/interactive-experiences`：下一版本交互知识演示功能的开发分支。`docs/plans/v0.4/` 是实施图纸，当前版本没有实现这些运行时功能。

在单独目录开发下一版本，同时保留当前目录运行 v0.3.0：

```bash
git fetch origin --tags
git worktree add ../cardspace-v0.4 feat/interactive-experiences
```

新目录需要独立安装依赖。新旧版本同时运行时，必须为新版指定独立的 `CARDSPACE_DATA_DIR` 和 `CARDSPACE_PORT`；避免新版数据库迁移影响当前知识库。

需要重新取回当前版本时，使用独立目录，不重置正在工作的目录：

```bash
git clone --branch v0.3.0 https://github.com/DCchuan/cardspace.git ../cardspace-v0.3.0
```

初次发布还会在本地 `output/` 生成 `cardspace-v0.3.0.bundle`、源码 ZIP 与 SHA-256 校验文件。Git bundle 包含已提交的历史、分支和标签，可在离线环境恢复仓库：

```bash
git clone output/cardspace-v0.3.0.bundle ../cardspace-restored
```

源码包与 Git bundle 不包含个人知识库、模型密钥或运行依赖。知识库请使用应用内的备份与恢复功能单独备份。已有发布包应保留；新版备份使用新的版本号。

## 发布检查

1. 在干净环境运行 `bash scripts/setup.sh`、`npm test`、`npm run build`。
2. 使用临时数据目录验证导入、搜索、原文定位、版本审批与备份恢复。真实模型联调使用发布者自己的服务，不提交密钥。
3. 修改依赖后运行 `npm run notices`，检查第三方归属。
4. 运行 `npm run source`，核对 `output/cardspace-source.zip`。包内包含源码、依赖锁、许可证、贡献指南与可公开工程文档，排除数据库、备份、环境密钥、node_modules、虚拟环境及原始粘贴规划附件。
5. 将源码上传到维护者选择的仓库，设置私密安全报告渠道，再创建版本标签和发布说明。提交前检查敏感信息；本地生成源码包不等于已经公开发布。

npm 的 private=true 防止误发布到 npm registry，不影响 Git 托管、MIT 授权或源码分发。依赖不随 MIT 重新授权，保留 THIRD_PARTY_NOTICES.md 与原有许可证。

如果分发编译后的网页，附带本项目 LICENSE 和 THIRD_PARTY_NOTICES.md。界面“设置”提供当前检出版本的源码下载；不要用原始版本的源码包代替已经修改的实际版本。
