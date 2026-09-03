# 04 · 后端模块设计：ideaget 服务 + Zotero 读/写 + Markdown 管线

host half 的组织与扩展点设计。模块边界、工具契约、内容管线、写路径、配置、
安全逐项给出；可行性论证见 [01-feasibility.md](01-feasibility.md)，
装配见 [02-profile-assembly.md](02-profile-assembly.md)。

## 1. 模块边界

ideaget 是一个 bundle 包（host + client），Zotero 能力作为**包内子模块**：

```
src/
├── index.ts              # export { default, IdeagetService }（Service 类插件）
├── service.ts            # IdeagetService extends Service → ctx.ideaget
├── config.ts             # Config（Schemastery）＋ resolveConfig
├── settings-namespace.ts # 依赖无关常量（host/client 共享）
├── contract.ts           # 双端共享 Typert 描述符/编解码（与 client/contract.ts 同源）
├── typert.ts             # 宿主 Typert manifest（网关解析 ideaget/... 端点）
├── command.ts            # /ideaget status 等会话命令
├── prompt.ts             # ctx.systemPrompt.section()（渐进披露工具说明）
├── zotero/
│   ├── transport.ts      # 本地 API 只读 transport（版本探测、server ID、限流）
│   ├── web-client.ts     # Web API 通道（读 + 写，key 来自 credentials）
│   ├── local-write.ts    # Zotero 10+ 本地授权写（authorize/upload/CRUD）
│   ├── model.ts          # 对象模型归一（item/note/attachment/collection/全文）
│   ├── retrieve.ts       # 证据/全文检索（BM25 段落，参照 dsh-zotero 语义）
│   └── export.ts         # 引用/参考文献/BibTeX/RIS/CSL-JSON
├── content/
│   ├── pipeline.ts       # 附件 → 干净 MD：取字节→抽文本→清洗→结构化（含图片）
│   ├── extractors.ts     # pdfjs / pdftotext / Zotero 全文索引（可配置）
│   └── images.ts         # 页面渲染成图（pdftoppm/mupdf/pdfjs），图注启发式
├── ingest/
│   └── add-from-doi.ts   # DOI → 元数据(Crossref) → OA PDF → 入库(按版本分支写通道)
└── tools/
    ├── search.ts get.ts read-md.ts export.ts   # 只读工具（常驻）
    ├── add-paper.ts       # 下载入库工具（写，默认 ask/审批）
    └── validate.ts        # 配置/连通性自检（供 /ideaget status 与 Web 卡片）
```

`IdeagetService` 注册：zotero transport、content pipeline、ingest、全部工具、
prompt section、命令、settings namespace、typert manifest；构造函数只做同步
初始化，请求驱动（加载不碰 Zotero 网络）。

## 2. 工具契约（对齐 `docs/cookbook/adding-a-tool.md` 规范）

每个工具：`defineTool` + 类型化 `parameters` + 单一 canonical value +
`output.render`（模型文案）+ 可选 `presentationMeta`（Web 卡片持久化事实）。

| 工具 | 输入要点 | canonical value 要点 | 说明 |
|---|---|---|---|
| `ideaget_zotero_search` | query/itemType/scope(collection|savedSearch|library)/全文开关/分页 | items[]（zotero ref/稳定 key + title/creators/year/DOI/tags/type） | 参照 dsh-zotero search；`everything` 走全文索引 |
| `ideaget_zotero_get` | ref | metadata + include(notes/annotations/attachments) | 摘要 abstractNote 直接给 |
| `ideaget_zotero_read_md` | ref（父条目或附件）+ 选项 | `{ markdown, sections?, images?: [{page,url,alt?}], meta:{title,abstract,keywords,tags}, budgetInfo }` | **核心新增**：内容管线输出（见 §3）；大文档按预算截断并报 truncated |
| `ideaget_zotero_export` | refs[]/style/locale | 引用/参考文献/BibTeX/RIS/CSL-JSON 文本 | 参照 dsh-zotero |
| `ideaget_zotero_status` | — | `{ reachable, apiVersion?, serverId?, writeMode: 'local10'|'web'|'unsupported', fulltextIndexed }` | 能力探测驱动 |
| `ideaget_paper_add` | doi 或 url/arXiv id + targetCollection + allowOaOnly | `{ created: true, itemKey, collectionKey, source:'oa', file:'pdf' }` | **写工具**：默认经 tools/pre-execute 走 ask 审批；`allowOaOnly=false` 时报版权边界提示 |

命名空间前缀 `ideaget_` 与官方/其他插件工具隔离；全部工具名、schema、
错误文案是**模型可见稳定面**，先写进快照再改。

## 3. 内容管线（read_md 的实现骨架）

阶段与失败语义（管线错误 → 工具 `isError`，带稳定错误码，如
`attachment-not-textual` / `pdf-encrypted` / `budget-exceeded`）：

1. **解析附件**：父条目 ref → 选最佳 PDF/EPUB 附件（`ideaget_zotero_get` 同款逻辑）；
   取字节：本地 API `.../items/<key>/file`（302 file://，宿主 readFile）或 Web API 下载。
2. **抽文本**：`extractor` 配置项（默认 pdfjs-dist，Node 内纯 JS）：
   `pdftotext`（质量高，需 poppler）；降级：Zotero `/fulltext` 索引文本。
   加密/无文本层 → 明确报错（不做 OCR，除非配置 `ocr: true` 且有 tesseract）。
3. **清洗 → 结构化 MD**：页眉页脚/连续重复行去除 → 标题层级启发式 → 段落重排 →
   表格/公式退化表示；`sections`（abstract/body/introduction/methods/results/
   conclusion）用规则粗分；`keywords` 来源顺序（配置）：tags → extra 解析
   （arXiv `Keywords:`）→ 首页文本启发 →（可选 LLM）。
4. **图片**（配置 `includeImages`）：页面渲染（pdftoppm/mupdf WASM/pdfjs 渲染）
   → PNG/WebP，经宿主 Fetch 路由或 data 引用交付 client；`images` 数组带页码/尺寸；
   版权提示在 render 文案里（仅个人阅读）。
5. **预算与并发**：maxBytes/maxImages/超时（exec.signal）；多附件并行上限；
   结果含 `budgetInfo` 保证模型可见（不静默截断）。

**关键纪律**（对齐官方"模型可见 ⟺ 已记录"）：管线产物是工具 canonical
value，全部随 `tool/result` 落会话日志——重放时 Web 卡片从 `result.meta`
重建，不重新跑管线（`presentationMeta` 存 md 摘要/图片清单/章节锚点）。

## 4. 写路径（ideaget_paper_add）

**能力探测先行**（transport 构造时 + 每次写前校验）：

```
GET /api/                        → 可达性；Zotero-Server-ID；写支持标志
  分支：
  · Zotero ≥10（本地写可用）
      POST /api/local/authorize {appName:'ideaget'}   ← 桌面弹窗（Allow/Always Allow/Deny）
      → key（remember 或单次）；写请求带 Zotero-API-Key + Zotero-Server-ID
      · 401 → 重新 authorize；429 → Retry-After 退避；412 → 缓存作废（server 换了）
  · 无本地写 → 回退 Web API（需 settings 配 key+userID）：云端 CRUD + S3 三阶段上传
  · 都没有 → 返回结构化错误：提示 Web key 或桌面桥插件（不静默降级）
```

流程（去重优先）：按 DOI/标题预检（本地或云端搜索）→ 已存在则返回现有 ref
（不重复建）→ Crossref 取元数据 → OpenAlex/arXiv/PMC 判定 OA 并取 PDF 字节
（非 OA → 明确提示 + 返回 DOI/入口，不下载）→ 建 item → 上传附件（三阶段 +
MD5 校验；仅 imported_file/imported_url）→ 目标 collection（不存在则建）→
`add to collection`。写语义：`If-Unmodified-Since-Version` 乐观并发；
`Zotero-Write-Token` 仅内存缓存（Zotero 重启失效 → 错误可重试）。

**审批**：所有写路径注册在只读默认之上——`tools/pre-execute` 对
`ideaget_paper_add` 返回 `ask`（官方 approval 能力），deny/approve 都落日志；
`readOnly` 配置（默认 true）时该工具直接不可见（渐进披露：写工具按需注入）。

## 5. 配置 schema（config.ts 概念稿）

```ts
interface Config {
  zoteroApiBaseUrl: string        // 默认 http://127.0.0.1:23119/api
  requestTimeoutMs: number
  readOnly: boolean               // 默认 true；false 才启用写工具
  writeMode?: 'local-authorize' | 'web-api'   // 分支选择，未设=自动探测
  webApi?: { key?: string; userId?: number }  // 敏感项走 credentials，不落 config 明文
  search: { resultLimit: number; fulltextEnabled: boolean; defaultScope: string }
  content: {
    extractor: 'pdfjs' | 'pdftotext' | 'zotero-index'
    maxBytes: number; includeImages: boolean; maxImages: number
    ocr: boolean
    keywordsSources: ('tags' | 'extra' | 'first-page' | 'llm')[]
    llmStructuring?: boolean     // 可选 LLM 结构化（需 llm 服务，默认关）
  }
  ingest: { defaultCollection?: string; oaOnly: boolean }
}
```

组合层 `cordis.patch.yml` 提供基底层；Web 端 Settings namespace（`ideaget`）
实时覆盖（保存即生效，host 端 live rebuild——参照 dsh-zotero config 卡片）。

## 6. 命令与系统提示词

- `/ideaget status`：通道/版本/写模式/索引覆盖/配置摘要（故障排查入口）。
- prompt section：只介绍"当前可见"工具（只读集 vs 含写集）——渐进披露，
  写工具未授权时不在 schema 里出现；与 `tools/change` 联动（preset 换绑时重算）。

## 7. 安全与验收

- 默认只读；本地 API 地址仅 127.0.0.1 可写配置（防转发后滥用，呼应官方警告）。
- Web key 经 `dsh-credentials` 存 `.env`/settings，不进日志/会话/propmt。
- 写操作全量走 ask 审批；删除类操作 v1 不做（只增不改删）。
- 验收清单：7.x 只读矩阵全绿；10+ 本地写（授权→建→传→归集合→401 重授权→
  429 退避）全绿；Web API 写全绿；加密/扫描/大文件各有一致错误码；
  模型可见内容全部可在会话日志重建（快照测试覆盖 read_md 输出）。
