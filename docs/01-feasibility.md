# 01 · Zotero 通信能力与可行性分析

本文回答三个问题：**ideaget 能与 Zotero 通信到什么程度**（以 zotero-mcp 系
实现为参照）、**把论文读成干净 Markdown + 图片是否可行**、**把 API 下载的
论文写入 Zotero 对应集合是否可行**。结论先行，细节在后。

## 结论摘要

| 能力 | 可行性 | 关键条件 |
|---|---|---|
| 读取库结构/元数据/笔记/批注/附件清单 | ✅ 高 | Zotero 7+ 桌面版开启本地 API（设置→高级→允许通信），本地无认证读取 |
| 摘要（abstract）、正文全文检索、证据段落 | ✅ 高 | abstractNote 是元数据字段；全文走 Zotero 全文索引（everything/检索 + /fulltext） |
| 关键词（keywords） | 🟡 中 | Zotero 无内建 keywords 字段：tags 承担；期刊"keywords"常在 extra/arXiv 元数据中，需解析，非标准 |
| **干净 Markdown 正文** | 🟡 中-高 | Zotero 不存 MD。需自建管线：取 PDF 字节（本地 file:// 或下载）→ 文本抽取 → 清洗/结构化。逐篇质量取决于 PDF 质量 |
| **论文内图片** | 🟡 部分 | 可行：PDF 页面渲染成图（pdftoppm/mupdf/pdf.js）。"结构化随文插图"需坐标解析，质量不稳；扫描/加密 PDF 受限 |
| **API 下载论文 → 写入对应集合** | ✅ 高（需选通道） | 写通道三选一：Zotero 10+ 本地授权写 / Zotero Web API（云端，需同步）/ Zotero 7.x 需桌面桥插件。按运行版本分支 |
| 全程离线、不注册 zotero.org | ✅（读 + Zotero 10+ 本地写） | Zotero 10+ 的本地 API 支持写，但每次写经桌面确认对话框授权 |
| 下载付费墙论文 | ❌ 不可（合法范围内） | 只走开放获取源（Crossref/OpenAlex/arXiv/PMC）；付费内容提示用户在 Zotero/浏览器内获取 |

> 一句话：**读是现成高可行，MD/图片是自建管线（中高可行），写是"按版本选通道"（高可行但工程上有分支）。**

## 1. Zotero 数据模型：能拿到什么

Zotero 的对象模型（Web API v3 与本地 API 同构）：
items（条目，含 itemType 如 journalArticle/preprint；元数据字段含
`title`、`creators`、`date`、`DOI`、`url`、`abstractNote`、`extra`、
`tags`）、child notes（HTML 富文本）、attachments（PDF/快照，挂父条目下）、
collections（树）、saved searches、tags、库级全文索引（fulltext）。

对 ideaget 的直接含义：
- 摘要 = `abstractNote`（元数据，直接可读）。
- "关键词"：`tags` 是最接近的稳定字段；"author keywords"若有，通常藏在
  `extra`（如 arXiv 抓取的 `arXiv:...`、`Keywords: ...` 行）或全文首页，
  需要解析规则或交给 LLM——**实现时要把"关键词来源"做成配置项**。
- 正文 = PDF 附件文本（Zotero 全文索引有清洗版，但**不是原始顺序/格式**，
  且受索引覆盖限制）；dsh-zotero 的 `zotero_retrieve` 就是吃这个索引做
  BM25 段落检索，它**刻意不解析 PDF**（见其 README 边界说明）。

## 2. 通信通道与版本矩阵（能力边界所在）

权威依据：[Zotero Local API 官方文档](https://www.zotero.org/support/dev/web_api/v3/local_api)（2026-07 更新）与
[Zotero Web API](https://www.zotero.org/support/dev/web_api/v3)。

### 通道一：本地 API `http://127.0.0.1:23119/api/`

Zotero 桌面版内建，离线、无速率限制、比云端快。必须先在
设置→高级→"允许此计算机上的其他应用程序与 Zotero 通信"开启，否则 403。

**读取**（所有版本）：无需认证。条目/集合/保存检索/标签/笔记/批注、
`<prefix>/searches/<key>/items`（本地特有：真正执行保存检索）、
全文检索与 `/fulltext?since=` 增量。附件文件端点返回 **302 → `file://` 路径**
（`/file/view/url` 直接给本地磁盘路径纯文本）——这是"宿主读本地 PDF"的关键钩子。

**写入**——**版本分水岭**（这是本项目最大的可行性变量）：

| | Zotero 7.x | Zotero 10+（官方文档已定义） |
|---|---|---|
| 本地写 CRUD | ❌ 不支持（读为主） | ✅ items/collections/saved searches 的 POST/PUT/PATCH/DELETE、tag 删除、fulltext 写、文件上传 |
| 写认证 | — | `POST /api/local/authorize` `{appName}` → 桌面弹窗 Allow/Always Allow/Deny → 32 位**本地 key**；单次有效或"始终允许"后长期有效；401 需重新授权；每分钟最多 5 次弹窗（429） |
| 一致性 | synced 版本 | **Zotero-Server-ID**（写必带，428/412 校验）+ 本地对象版本（If-Unmodified-Since-Version）；缓存按 server ID 分区 |
| 文件上传 | — | 三阶段流程本地可用（不再走 S3）：`POST .../file`(md5/filename/filesize/mtime) → 上传字节 → `upload=<key>` 确认；仅 imported_file/imported_url；<4GB；无分片 |
| 全文写 | — | `PUT .../fulltext`、`POST /fulltext`（批量≤10） |

官方文档警告：读无认证意味着**任何本机进程可读你的库，禁止把 23119 端口
转发/暴露到外部**。ideaget 默认只读、写必须显式授权，与此一致。

> 工程含义：Zotero 7.x 是当前大多数用户所在版本，**本地写不可用**；
> 这正是 [Xpropel/zotero-mcp](https://github.com/Xpropel/zotero-mcp) 自研
> `zotero-local-bridge` 桌面插件（xpi）暴露本地写端点的原因。Zotero 10+
> 把写原生化，但要求"桌面弹窗授权 + server ID 分区 + 本地版本并发"。
> ideaget 的写路径必须**先做能力探测**（GET /api/ 读版本/能力）再分支。

### 通道二：Web API `https://api.zotero.org`

需要 zotero.org API key + userID（[keys 页](https://www.zotero.org/settings/keys)）。
全读写（含集合、标签、笔记、全文搜索 API、S3 三阶段文件上传），有速率限制
（官方建议退避），写的对象在**云端库**，需 Zotero 客户端同步后才落到桌面。
[zotero-mcp-plus](https://github.com/alisoroushmd/zotero-mcp) 是这条通道的完整参照
（39 个工具：读 + create_item(DOI/PMID/URL)/attach_pdf/add_to_collection/manage_tags…）。

### 通道选型建议

| 场景 | 推荐通道 |
|---|---|
| 读（搜索/元数据/全文/笔记） | 本地 API（离线、快、无 key） |
| 写"下载论文入库" | 若运行 Zotero ≥10：本地授权写（无云端依赖）；否则：Web API key（云端→同步）或提示装桥插件 |
| 只读部署/最小风险 | 只用本地 API 读 + Web API 读 |

## 3. 需求 A：干净 Markdown 正文

Zotero **不存储** Markdown：PDF 是原始文件，笔记是 HTML，全文索引是检索用
清洗文本。产出"干净 MD"必须自建管线，分三层：

1. **取字节**：本地 API `.../items/<key>/file` 302 到 `file://`（宿主进程可直接
   readFile，天然离线）；Web API 则下载（限速）。dsh-zotero 已示范如何把附件
   ref 解析为验证过的磁盘路径。
2. **抽文本**：按可用依赖选择（做成配置项 `extractor`）：
   - `pdfjs`（pdfjs-dist，Node 可跑，纯 JS、无外部二进制）——首选，能同时做图片渲染；
   - `pdftotext`/`pdftoppm`（poppler-utils 外部二进制，质量高，需系统安装）；
   - Zotero 全文索引（`/fulltext`）作为**快速降级**（有 BM25 chunk 但非原文格式）。
3. **清洗/结构化成 MD**：标题层级启发式（字号/字体/页眉去重）、把连续文本按段落
   重排、公式与表格退化为行内/代码块表示、去除页眉页脚；可选 LLM 二次结构化
   （把摘要/正文/方法/结论分节并产出 keywords），但**默认离线规则优先**，
   LLM 结构化做成开关（成本与稳定性由用户定）。

可行性判定：**中-高**。普通出版 PDF（文本层干净）→ 高质量 MD；双栏复杂排版、
公式、表格 → 结构会退化但内容可读；扫描件需 OCR（tesseract，成本高，默认不做）；
加密/DRM PDF → 无法抽取（报错并提示）。

## 4. 需求 B：论文内图片

- 最稳做法：**整页渲染**（pdftoppm/mupdf/pdf.js canvas → PNG/WebP），按页码交付
  "第 N 页图"。适合人看/喂给多模态模型。
- 结构化做法：解析 PDF 图像对象坐标，产出"随文插图 + 图注"——可行性**低-中**，
  依赖 PDF 内部结构，质量不稳定；建议 v1 只做整页渲染 + 图注启发式（image 附近
  文本块），v2 再评估坐标级提取。
- 边界：扫描件（图片型 PDF）整页渲染天然可用；矢量图渲染需光栅化；版权上
  渲染仅供个人阅读使用，不重分发。
- 架构选项：宿主进程做（Node + pdfjs-dist/外部工具）或浏览器端做（host 把
  PDF 字节经 Fetch 路由给 client，client 用 pdf.js 渲染）——ideaget 采用
  **宿主进程管线 + 结果以工具 canonical value 返回、图片以本地可访问 URL
  交付 Web 卡片**（参照 dsh-zotero 附件/证据卡片模式）。

## 5. 需求 C：API 下载论文 → 写入 Zotero 对应集合

分两半：

**源侧（合法获取）**：由 DOI/arXiv/PMID 定位：
- 元数据：Crossref（DOI）、arXiv API、OpenAlex、PubMed/PMC——均免费开放；
- PDF 字节：arXiv（OA 必有）、PMC、OpenAlex `open_access` 标记的 OA 源；
- 付费墙内容：**不绕过**。检测到非 OA → 返回结构化提示（DOI/链接/机构入口），
  由用户在 Zotero/浏览器手动获取后再用"导入本地文件"路径入库。

**写侧（入库）**，按运行时 Zotero 版本三选一（能力探测后分支）：

1. **Zotero 10+ 本地授权写**（推荐，无云端依赖）：
   探测 server ID → `POST /api/local/authorize {appName:"ideaget"}`（桌面弹窗，
   用户可"始终允许"）→ 携带本地 key 与 `Zotero-Server-ID` 执行：
   按 DOI 检索去重 → 建 item（元数据来自 Crossref）→ 建/取目标 collection →
   三阶段文件上传 PDF → `add to collection`。401 → 重新授权；429 → 退避。
2. **Web API**：配置 key+userID；同上流程但走云端（S3 上传），写后依赖 Zotero
   客户端同步回桌面。参照 zotero-mcp-plus。
3. **Zotero 7.x 本地**：本地写不可用 → 提示两条路之一（启用 Web API 通道，
   或安装 Zotero 桌面桥插件如 [zotero-local-bridge](https://github.com/Xpropel/zotero-mcp)）。

工程细节（写入设计文档 04 展开）：按 DOI/标题预检去重；`If-Unmodified-Since-Version`
乐观并发；`Zotero-Write-Token` 内存缓存（Zotero 重启即失效，需重试）；
上传 MD5 校验；文件 <4GB；仅 imported_file/imported_url 附件类型。

## 6. 与参照实现的差距对照（我们多做什么、少做什么）

| 能力 | dsh-zotero（DSH 本地只读） | zotero-mcp-plus（云端读写） | Xpropel/zotero-mcp（本地+桥） | ideaget 目标 |
|---|---|---|---|---|
| 本地库检索/元数据/笔记 | ✅ | 云端为主 | ✅ | ✅ 继承 |
| 证据段落（BM25） | ✅ | fulltext 可选 | — | ✅ 继承 |
| PDF→干净 MD | ❌ 明确不做 | extract_text（内联文本） | MD/TXT sidecar + OCR | ✅ 主新增 |
| 论文图片 | ❌ | — | — | 🟡 页面渲染为主 |
| API 下载→入库 | ❌ 只读 | ✅ create_item/attach_pdf | ✅ 本地导入 | ✅ 按版本分支 |
| 摘要/body/keywords 说明 | 摘要✅ | — | — | ✅ 摘要+结构化正文+keywords 配置源 |

## 7. 风险与边界（写进实现的验收标准）

- 版本差异是第一风险：写路径必须**探测驱动**（读取 `Zotero-API-Version` /
  server 能力），7.x 与 10+ 行为不同，文档与测试按矩阵覆盖。
- 隐私：默认只读本地库；23119 不外泄（官方警告）；写操作默认走审批
  （tools/pre-execute → ask，见设计文档 04）；Web key 存 credentials/settings。
- 大 PDF/多图：字节与 token 预算、超时、取消（exec.signal）。
- 版权：OA 才自动下载；渲染图仅个人阅读。
- 与官方 DSH 的关系：deepseek-harness 只读；本插件完全 out-of-tree，
  构建经 `prepare`（git 安装需 allowBuilds，见设计文档 02）。
