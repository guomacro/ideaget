# ideaget

DeepSeek Harness 的 out-of-tree 插件项目（bundle：host + web client 双端），
目标是做一个**文献驱动的 agent 工作台**：以本地 Zotero 文献库为证据源，
支持把论文读成"干净 Markdown + 图片"、解释摘要/正文/关键词，并支持把
API 下载到的论文写入 Zotero 对应集合。

官方源码（deepseek-harness 仓库）**只读**，本项目所有改动都在本目录内完成，
前端遵循 `@deepseek-ai/dsh-client` 系插件的既有设计规范（`dsh.client` 清单、
`exports["./client"]`、slots、Typert Remote）。

## 当前状态

**阶段 1–3 已交付，测试通过**：host 读线路（Zotero 本地 API + PDF→Markdown 管线 + 探针）在真实 Cordis 树内挂载验证、返回真实论文标题；vitest 34 用例全绿；client half 已声明 `dsh.client` 并注册 conversation.view 三栏视图（esbuild bundle 经 dsh CJS 宿主语义验证）。LLM/写路径/三栏数据接入与 Remote 仍是保留端口。详见 [docs/06-impl-notes.md](docs/06-impl-notes.md)。

版本管理：git + 远端 `https://github.com/guomacro/ideaget.git`（main）。

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/01-feasibility.md](docs/01-feasibility.md) | Zotero 通信能力与四项核心需求的可行性分析（读干净 MD+图片、摘要/正文/关键词、API 下载入库），含版本矩阵与风险边界 |
| [docs/02-profile-assembly.md](docs/02-profile-assembly.md) | `ideaget` profile 装配设计：自定义 profile = dsh-base + dsh-web-app + ideaget bundle 的机制与命令 |
| [docs/03-frontend-design.md](docs/03-frontend-design.md) | 前端设计：基于 conversation.view 的自建三栏视图（左侧栏 + 聊天 + 详情） |
| [docs/04-backend-module-design.md](docs/04-backend-module-design.md) | 后端模块设计：ideaget 服务、zotero 只读/写路径、Markdown 内容管线、工具集、配置与安全 |
| [docs/05-roadmap.md](docs/05-roadmap.md) | 分阶段实施计划与每阶段验证方式 |
| [docs/06-impl-notes.md](docs/06-impl-notes.md) | 阶段 1 实现记录：读线路实测、PDF 管线、探针、官方无 PDF 插件核查、已知边界 |

## 关键外部参照

- [dsh-zotero](https://github.com/Vncntvx/dsh-zotero)：本地 Zotero 只读工具集的 DSH 插件范例（本项目后端传输层与前端卡片模式的直接模板）
- [zotero-mcp-plus（alisoroushmd/zotero-mcp）](https://github.com/alisoroushmd/zotero-mcp)：云端 Web API 全读写 + 全文 + 批量整理的 MCP 参照
- [Xpropel/zotero-mcp](https://github.com/Xpropel/zotero-mcp)：本地优先 + Zotero 桌面桥插件写路径的 MCP 参照
- [Zotero Local API 官方文档](https://www.zotero.org/support/dev/web_api/v3/local_api)：能力与版本差异的权威来源
- [Zotero Web API 官方文档](https://www.zotero.org/support/dev/web_api/v3)：云端读写与文件上传协议

## 术语速记

- **bundle**：声明 `dsh.bundle.patch` 的 npm 包，贡献一个配置层（patch 文件），由 `dsh plugin add` 安装进 profile 并写入 `dsh.profile.bundles`。
- **profile**：`$DSH_HOME/profiles/<name>/`，可运行组合（有序 bundle 列表 + 用户 patch 层）。
- **client half**：同一包内声明 `dsh.client` + 导出 `./client` 的浏览器端插件，被 Web GUI 的 client module 系统自动发现并注入 `window.__DSH_BOOT__`。
