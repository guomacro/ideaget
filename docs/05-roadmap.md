# 05 · 实施路线图（代码阶段）

文档先行阶段（01–04）已完成。**阶段 1 已部分落地并实测**（见
[06-impl-notes.md](06-impl-notes.md)：host 骨架、只读传输、PDF→MD 管线、
4 个工具、探针；LLM/写/client 为保留端口）。以下代码阶段按依赖顺序推进，
每阶段以**可验证行为**收口；官方 deepseek-harness 仓库保持只读，全部改动在本项目内。

## 阶段 1 · host 骨架 + 只读 Zotero 传输（✅ 主要完成，待挂载收口）

- ✅ 包骨架、`/ideaget status`、settings namespace 预留（组合层 config 先行）。
- ✅ zotero/transport 只读 GET、版本探测、file:// 附件读取、超时/预算。
- ✅ 工具：`ideaget_zotero_search` / `_get` / `_read_md` / `_status`；PDF→MD 管线。
- ✅ 中间探针（ProbeLog JSONL + verbose）。
- ⏳ 收口项：在真实 `dsh --profile` 组合内挂载验证（Loader 全树激活、工具进入
  PTC/模型可见面、快照测试）。

## 阶段 2 · 内容管线（read_md）

- content/pipeline：附件→字节（file://）→ pdfjs 抽文本 → 清洗结构化 → MD；
  `zotero-index` 降级；预算/截断/错误码。
- `ideaget_zotero_read_md` 工具 + `presentationMeta`；模型可见输出快照测试。
- 验证：真实 PDF 论文返回干净 MD（抽样人工比对质量）；加密/扫描/超大各命中
  稳定错误码；大文档截断且 `budgetInfo` 可见。

## 阶段 3 · 前端三栏视图（对应设计文档 03）

- client half 骨架：`exports["./client"]`、esbuild 构建、locale、Remote 声明。
- conversation.view 'ideaget' 目标 + Definition（左栏行/中栏消息/右栏详情）+ 卡片。
- 验证：`dsh --profile web` 内新会话切到 ideaget 页签；搜索→阅读→卡片呈现；
  `pnpm run test:gui` 同级 jsdom 组件测试绿。

## 阶段 4 · 图片与详情（能力分级）

- 页面渲染成图（pdftoppm/mupdf/pdf.js），图片经 host Fetch 路由交付卡片；
  图注启发式；右栏详情（摘要/证据/关键词来源链）。
- 验证：带图论文在 ideaget 视图内可看第 N 页；卡片在 replay 下可重建。

## 阶段 5 · 写路径（ideaget_paper_add，按版本分支）

- 能力探测 → 本地授权写（Zotero ≥10：authorize/CRUD/三阶段上传/server ID 分区）→
  Web API 回退（credentials key）→ 7.x 提示；去重/审批（ask）/错误码。
- 验证：真实库建条目+传 PDF+归集合（先允许写的小库）；401 重授权、429 退避、
  412 缓存作废各有测试；`readOnly: true` 时写工具不可见。

## 阶段 6 · 独立 profile 化与分发

- 按设计文档 02 落 `dsh plugin --profile ideaget add @deepseek-ai/dsh-web-app` +
  ideaget 包；`--dump-config` 验证三层。
- 发布：`npm pack`（tarball 直装）或 git（`prepare` + 用户 allowBuilds + 锁 commit）。
- 端到端：新机器文档化安装步骤走查一遍。

## 贯穿各阶段的测试与文档纪律

- host：vitest 单测 + 真实组合测试（Loader 全树激活）；工具模型可见输出进快照。
- client：jsdom 组件测试（真实 props，不测 class 名）；文案全部走 locale。
- 每条模型可见文案/错误码先落文档与快照再实现；改动同步更新本项目 docs/
  与 README（官方仓库 docs 不动）。
