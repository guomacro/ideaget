# 06 · 实现记录：读线路落地与阶段 2/3（tests green）

阶段 1（host 读线路 + 真实 Cordis 挂载）之后的两轮代码：**阶段 2 测试套件**
（vitest 34 用例全绿）与 **阶段 3 client half**（`dsh.client` 声明 + 三栏视图
注册 + esbuild bundle + jsdom 组件/注册测试）。官方仓库只读，全部改动在本项目内。

## 本轮完成

### 包骨架（out-of-tree bundle）

- `package.json`：`dsh.bundle.patch`（host 行）；**暂不声明 `dsh.client`**
  （前端"大部分采用默认、保留端口"，后续轮次再加 client half 与三栏视图）。
  peer 依赖 `@deepseek-ai/cordis` / `dsh-tools` / `dsh-commands`；
  runtime 依赖 `@deepseek-ai/schemastery`（配置）与 `pdfjs-dist ~5.4.394`（PDF 文本抽取）。
- `cordis.patch.yml`：插入单行 `{ id: ideaget, name: ideaget }`。
- `tsconfig.json`：NodeNext ESM、`lib/` 输出、strict。

### 后端（host half，均为只读；写与 LLM 是保留端口）

| 文件 | 职责 |
|---|---|
| `src/config.ts` | Config schema（默认值只在 schema 上）；`resolveConfig` 归一化 base URL |
| `src/errors.ts` | 稳定错误码（`zotero-unreachable` / `no-text-attachment` / `pdf-parse-failed` …），不做字符串匹配 |
| `src/probes.ts` | 中间探针：逐阶段 JSONL（stage/ok/ms/detail），失败永不阻断管线；`trace()` 计时+记录+重抛 |
| `src/zotero/transport.ts` | 本地 API 只读传输：`serverInfo`（版本/server id/schema/写模式推断）、`searchItems`（metadata/everything）、`itemByKey`、`childrenOf`、附件 `file://`/http 字节读取（超时/预算） |
| `src/zotero/model.ts` | Zotero v3 JSON 最小类型 + 归一化（ref 解析、creators/year/abstract/tags、`extra` 中 Keywords 解析） |
| `src/content/pdf-text.ts` | pdfjs-dist legacy 文本抽取：按 baseline y 组行、按 x 间隙组词、行距启发式分段落、预算截断 |
| `src/content/pipeline.ts` | 附件解析（best PDF）→ 字节 → Markdown 正文 + 元数据；扫描件/无文本层报稳定错误 |
| `src/tools/*.ts` | 4 个模型工具（schema 用 `as const` + `InferArgs`/`InferValue`，与官方 dsh-zotero 同款写法）：`ideaget_zotero_status` / `_search` / `_get` / `_read_md` |
| `src/command.ts` | `/ideaget status`（commands 服务可选注入，headless 组合也能加载） |
| `src/service.ts` | `IdeagetService extends Service`（`ctx.ideaget`，`static inject=['tools']`，`static Config`），注册全部工具与命令；方法都包探针 |
| `src/index.ts` | `export { default }`（Service 类）+ 类型/错误码 |

### 官方实现核查结论（读官方仓库，未改动）

- **官方没有 PDF 处理插件**：`packages/**` 全树无 pdfjs/pdf-parse/pdf-lib/pdftotext/mupdf。
  附件能力（`dsh-attachment`/`attachment-local`）处理"引用/存储附件"，不做 PDF 解析；
  dsh-zotero 也明确只解析路径、不读 PDF 内容。→ **管线自带 pdfjs-dist** 的决策成立。
- 工具/命令/服务写法与 `@deepseek-ai/dsh-tools`、`dsh-commands` 的官方 API
  对齐（dsh-zotero 同款模式，typecheck 通过）。
- 客户端模块发现机制：声明 `dsh.client` 的包会被 Web client 图自动发现，
  不需要官方仓库登记——后续加 client half 仍零官方改动。

### 实测（真实 Zotero，你本机已开启通信）

运行 `node scripts/smoke.mjs <query>`（组件级真实数据 smoke，每阶段过探针）：

```
serverInfo: reachable=true, zoteroVersion=10.0.1, apiVersion=3,
            schemaVersion=44, serverId=lANxCQDcJOv1, writeMode=local-write
metadata search / everything search: 命中真实条目
item 3M7WDU8Y: LiLa-WAM… (2026) F. Yang et al. [preprint]
   abstract/DOI(10.48550/arXiv.2608.03701)/keywords 来自元数据与 extra 解析 ✓
pipeline.pdf: 54309 chars, 16 pages, 377ms, truncated=false
```

探针落盘 `./.ideaget/probes/probes-2026-09-03.jsonl`，逐阶段可查（上述输出即
`verbose` 回显）。发现并修复一个 bug：`serverInfo` 曾把 base 的 `/api` 与路径
重复拼接（`/api/api/` 404），改为请求根路径后正常。

## 阶段 1 收口：真实 Cordis 树内挂载验证 ✅

收口方式：用官方（只读仓库）`boot()` 组装**最小真实服务链**
`systemPrompt → tools → ideaget` 三行（无 LLM、无 web 表面），把 ideaget
当普通插件行挂进树，然后直接调用 `ctx.ideaget`。

脚本（见 `scripts/`）：
- `scripts/mount-test.mjs` — 挂载 + 调用；入口行指到本包 `lib/index.js`。
- `scripts/align-cordis.mjs` — 挂载前把本包 `node_modules/@deepseek-ai/cordis`
  临时 symlink 到官方 `vendor/cordis`（保证与官方包同一 cordis 实例，
  instanceof 不失配）；测试后 `pnpm install` 恢复（`typecheck` 复验绿）。
- `scripts/fixtures/root.cordis.yml` — 空根 `[]`（patch 组合，同 profile 语义）。

实测输出（真实 Zotero 10.0.1）：

```
activated services: { systemPrompt: 'object', tools: 'object', ideaget: 'object' }
status: reachable=true, Zotero 10.0.1, apiVersion=3, schemaVersion=44,
        serverId=lANxCQDcJOv1, writeMode=local-write
Zotero paper titles (10 returned):
 - [2026] LiLa-WAM: Lightweight Latent Reasoning World-Action Model ...
 - [2026] MagicAgent: Towards Generalized Agent Planning ...
 - [2025] IFNet: Data-driven multisensor estimate fusion ...
 - [2020] Distributed multi-sensor multi-view fusion ...
mount test OK: plugin activated in a real Cordis tree and returned Zotero paper titles
```

**结论**：插件在真实 Cordis 组合树内正常激活（`static inject=['tools']` 的
服务等待生效、工具注册进 `ctx.tools`、`/ideaget` 命令走可选注入不阻塞），
且无 LLM 即可返回 Zotero 论文标题——阶段 1 验收通过。

小观察（非阻断）：`searchItems` 空查询会混入附件行（标题显示为 "PDF"）；
后续可默认过滤 `itemType === 'attachment'` 或按文档语义分页。

## 阶段 1 已知边界

- PDF→Markdown 是启发式管线：单栏论文质量好；双栏/复杂表格会行交错或退化为
  数字行（smoke 尾部表格即此类）。图像抽取（页面渲染成图）是**保留端口**，
  本轮未实现（需选型 pdftoppm/mupdf/pdf.js 渲染）。
- 扫描（图片型）PDF 会命中 `pdf-parse-failed`（字符过少检测），OCR 未接入。
- 行距分段的"空行阈值"取运行中平均行距，极简排版可能少分段落——可后续调参。
- 挂载验证用的是官方 `boot()` 的最小服务链（systemPrompt/tools），尚未跑完整
  `dsh --profile web` 表面（web 服务器 + client 图）；那属于阶段 3 接 client
  half 时一起验证（PTC 模式、Web 卡片）。

## 保留端口清单（本轮未接，下轮接）

1. **LLM/Agent**：工具已注册并类型化，但无任何模型调用；提示词 section 未加。
2. **写路径**（下载入库）：`transport` 已推断 `writeMode=local-write`（Zotero 10+），
  但未实现 `POST /api/local/authorize` + CRUD + 三阶段上传（见 01/04 分析）。
3. **client half**：未声明 `dsh.client`，未建三栏视图；Typert Remote 契约未挂。
4. **settings 卡片**：配置目前只在组合层 `config`；Web 可编辑走后续 settings namespace。
5. **图片**：页面渲染成图、图注启发式。

## 阶段 2：测试套件（vitest，34 用例全绿）

`pnpm test`（`tests/**/*.spec.{ts,tsx}`）：

| 套件 | 覆盖 |
|---|---|
| `config.spec.ts` | resolveConfig 尾部斜杠归一 |
| `model.spec.ts` | parseRef（URI/裸 key/拒绝小写与畸形）、creators/year/tags/abstract/keywords（extra Keywords 解析 + tags 回退） |
| `probes.spec.ts` | JSONL 落盘、失败不阻断、trace 记录成功/失败并重抛 |
| `pdf-pipeline.spec.ts` | pdf-lib 现场生成 PDF：跨页抽取、字符预算截断、空白页近零文本、无 PDF 附件/坏字节/超预算各命中稳定错误码、best-pdf 选择 |
| `transport.spec.ts` | fetch stub：serverInfo 头解析（10→local-write / 7→readonly）、ECONNREFUSED→unreachable、403→local-api-disabled、检索 URL 拼装、file:// 读取与预算、非法 scheme |
| `service.spec.ts` | 真实 Context + tools stub：4 个工具全部注册、不可达 Zotero 不抛、错误码映射（含 malformed-ref） |
| `tests/client/apply.spec.ts` | client apply 经 slots 注册 conversation.view 'ideaget'（id/order/组件） |
| `tests/client/ideaget-view.spec.tsx` | jsdom 渲染三栏（rail/stream/details）、空态、来源列表 |

过程中修的两个实现缺陷：pdf.js 会 transfer 传入 buffer（重复解析同一字节报
DataCloneError）→ 抽取入口做私有拷贝；`parseRef` 曾用 `/i` 放过 8 位小写串
→ 收紧为纯 `[A-Z0-9]{8}`。

## 阶段 3：client half（dsh.client + 三栏视图注册）

- `package.json`：声明 `dsh.client`（platform web，inject 信息性列表）与
  `exports["./client"]` → `lib/client.js`；构建 = tsc（host）+ esbuild（client）。
- `tsconfig.client.json`：client half 独立 typecheck（bundler 解析 + tsx 扩展名，
  仅 noEmit）；主 tsconfig 排除 `src/client`。
- `src/client/index.ts`：`inject=['slots']` + `apply(ctx)`，经
  `ctx.slots.inject('conversation.view', …)` 注册 `{name:'conversation.view',
  id:'ideaget', order:70}` → 三栏视图组件。
- `src/client/components/IdeagetView.tsx`：纯展示三栏（左 rail 来源列表 /
  中 stream 占位 / 右 details 占位），文案待 locale 化（保留端口）。
- `scripts/build-client.mjs`：esbuild，CJS（dsh client 模块宿主语义）、
  external `react`/`react-dom`/`@deepseek-ai/*`。
- **类型说明**：官方 client UI 包（ui-slots/ui-conversation）在 npm 上因 peer
  闭包含未发布 workspace 包（`@deepseek-ai/dsh-compact`）无法独立安装，故
  client 侧对 `slots` 服务用本地最小结构类型（运行时不变，宿主 web 树提供
  真实服务与槽声明）。
- bundle 在 dsh 式 CJS 求值器下验证：`exports: [apply, inject]` ✓。

三栏视图的"左栏数据来自会话内投影 / 右栏详情 / 配置卡片 / Remote 状态"仍是
保留端口（见 docs/03-frontend-design.md 数据流表）；本轮交付的是符合
dsh-client 规范的注册、组件骨架与测试。

## 阶段 2/3 已知边界
