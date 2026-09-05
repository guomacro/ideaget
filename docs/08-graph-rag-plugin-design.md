# 08 · Graph-RAG 论文检索框架：dsh 插件化设计

目标：把"异构知识图谱 + 向量库 + 关系库、引用网络/实体三元组/概念层级/协作网络/
方法-数据-任务/时序连接、五层混合检索 + Agent 动态路由"的方案，实现为一组
**互相协作的 dsh 插件**（官方仓库只读，全部 out-of-tree，宿主 = 自定义 profile）。

## 0. 结论速览

- 官方**没有**图/向量/嵌入插件（前查证过：无 graph/vector/memory/knowledge 包），
  这三块必须自建，但**只做适配器**：图存储接 Neo4j（HTTP/驱动）、向量接
  Qdrant/FAISS(本地文件)、嵌入接"可配置 provider"（BGE 本地或云端 key）——
  存哪、怎么存都是插件 Config，不硬编码。
- 官方**大量可复用**：agent/session/preset/session-query/session-projection/storage/
  skill/jobs/subagent/workflow/goal/plan/commands/compaction/credentials +
  UI 端 conversation/trajectory/slots/remote。
- 建议拆 **5 个插件 + 1 个 preset 组成面**，用服务注入 + 工具 + 事件协作。

## 1. 插件拆解（5 + 1）

| 插件 | 职责（= 你的方案哪一块） | 对外接口 |
|---|---|---|
| `dsh-corpus-ingest`（入库） | PDF→academic JSON(复用 ideaget 解析器)→分块(512tok/50-100重叠)→嵌入→增量索引；元数据/引用图基线 | `ctx.corpus`：`ingest(ref|file)`、`chunk(pdf)`；工具 `corpus_ingest`；`corpus/ingested` 事件 |
| `dsh-paper-graph`（图） | 节点/边模型 + 后端适配（Neo4j Cypher / 轻量 JSON 图文件）；引用网络、概念层级、方法-数据集-任务边 | `ctx.paperGraph`：`query(cypher)`、`traverse(seed, rel, hops)`、`neighbors`；Cypher 走 Config 适配 |
| `dsh-rag-index`（向量+检索） | 论文/分块/概念多粒度向量 + BM25 稀疏 + 融合/重排接口；五层查询实现 | `ctx.rag`：`hybridSearch(query, layer)`；分块与概念向量表管理 |
| `dsh-agent-router`（Agent 路由） | 问题理解→五层路由→工具调用编排→证据融合→答案 | 工具 `paper_ask`（只读常驻）/`paper_route`；读取 agent 上下文（会话/方向） |
| `dsh-rag-ui`（client half） | 在 ideaget 工作台加"检索/图谱/引用"面板（复用 slots/overlay） | `dsh.client` + conversation/shell.overlay + Remote |
| `paper-preset`（preset cordis.yml） | 不写代码：把一个会话的组成 = base 能力 + 上面 4 个 host 插件 + 默认只读工具集 + 方向记忆 section | 随 profile 装入 preset 目录 |

协作：ingest 产出 → `ctx.paperGraph` 写图 + `ctx.rag` 写向量（增量，无全量重建）；
检索层从两者读；agent-router 把用户问题路由到 1..5 层并调用检索/图工具；
client 通过 Typert Remote 看状态与图谱。

## 2. 官方插件/能力逐项映射（哪些可直接采用）

| 你的方案组件 | dsh 官方对应 | 采用方式 |
|---|---|---|
| Agent 执行与对话 | `dsh-agent` + `dsh-agent-loop`（base 已含） | profile 直接有；工具注册即被 agent 调用 |
| 会话（持久/多轮/查询日志） | `ctx.sessions`(session) + `dsh-session-persistence-jsonl` + `dsh-session-query-sqlite` | 会话即你的"关系库用户层"：查询历史/个性化记忆可走 session-query |
| **轨迹跟踪** | `session/event`(turn/step/tool 事件) + **ui-trajectory**(conversation 目标视图) + `session-projection` | 检索过程轨迹 = 每步工具调用即落 session 事件；ui-trajectory/自绘面板做可视化；`agent/pre-step` 等可加钩子（hooks 桥） |
| 每会话能力组合 | **`dsh-agent-presets`**（preset cordis.yml） | 论文 RAG preset 让新会话自动挂 4 个 host 插件与工具（含 RAG 只读集）；方向隔离天然成立 |
| 并行抽取（NER/RE 三元组） | **subagent**（in-process/新 driver）+ **workflow**(worker-thread) + `tool-subagent` | 文档级抽取作为独立 worker；workflow 编排分片→合并 |
| 长任务/入库队列 | **`ctx.jobs`** + `dsh-jobs-local` + `tool-jobs` | 大 PDF 集 ingest 走 jobs（后台、可取消、进度） |
| 长期研究目标 | **goal**(`ctx.goals` + tool + round-driver) | "调研 XX 方向"作为 goal 持续多轮 |
| 计划模式 | `dsh-plan-mode` | 综述/实验类任务先出计划 |
| 技能/提示工程 | **skill**(provider+注册)、`systemPrompt.section()` | 检索工作流写成 skill；每层策略写 prompt section |
| 会话压缩保上下文 | **compaction**(`ctx.compaction` + basic) | 长对话/大批证据自动压缩 |
| 密钥/嵌入 API key | **credentials**(env/.env provider) | BGE 本地无需；云端嵌入/Neo4j 走 credentials |
| UI 会话/图谱面板 | **slots/conversation/typert Remote**（client 生态） | 复用 ideaget overlay 工作台 |
| 记忆持久化（自己那份） | **storage**(`dsh-storage`/json/domain) 或文件 | 图/向量后端配置本身、索引状态放 storage |
| 引用/共被引解析 | ideaget references 提取（启发式）+ Crossref/OpenAlex 工具 | 建 CITES/CO_CITED 边的数据源 |
| 概念/三元组 | 无 NER 引擎 → LLM/subagent 抽取（rules 先做浅层：标题/摘要关键词+引文结构） | rules 起步，模型层可插拔 |

## 3. 插件如何相互配合（运行时协作图）

```
                 ┌──────────── paper-preset (per-session) ────────────┐
 用户问题 → agent ┤  mounts: corpus-ingest / paper-graph / rag-index   │
 (官方 agent-loop)│          agent-router / (skill: 检索工作流)         │
                 └────────────────────────────────────────────────────┘
   │ tools: paper_ask (router) ──► rag.hybridSearch(layer)  ──► 向量+BM25+图分
   │        │                        ▲          ▲                     │
   │        └──► paperGraph.traverse │          └─ storage(索引状态)    │
   ▼                              (graph 后端 Neo4j/JSON)
 session/event（每步 tool 即轨迹）──► ui-trajectory / rag-ui 面板
 入库: corpus_ingest ──► jobs(后台) ─► workflow/subagent(NER/RE 分片)
                        └─► graph 写边 + rag 增量索引（无全量重建）
 检索答案回写：session 持久化 + compaction 保上下文 + goal 追踪方向目标
```

要点：
- **轨迹是免费的**：agent 每一步（工具调用/结果/推理）本身就是 `session/event`，
  官方 session/session-query/projection/ui-trajectory 直接消费；"检索了哪些论文、
  命中哪些证据"因此可审计、可回放、可展示——不用另造。
- **组合而非 fork**：preset 机制让"论文 RAG 会话"是一个可选组成面，普通会话不受影响。
- **后端可插拔**：paper-graph/rag-index 的 store 是 Config（Neo4j 地址/向量后端/嵌入
  provider），单机无外部服务时退化为 JSON 图文件 + 本地 FAISS 式文件索引。

## 4. 落地顺序（在 ideaget 内）

1. `rag-index` 分块+检索（基于现有 academic JSON 产物，先本地文件索引+BM25，
   向量留 provider 接口）→ 工具 `corpus_search` 混合检索。
2. `paper-graph` 引用图：用 Zotero relations/references + Crossref 补 CITES 边，
   轻量 JSON 图 + 1-2 跳遍历 API（Neo4j 适配后置）。
3. `agent-router`：先 rules 路由（问题词→层）+ 融合公式，答案由 agent 基于证据生成。
4. `corpus-ingest` 接入 jobs/workflow/subagent 做批量与并行抽取。
5. `paper-preset` 组合 + rag-ui 面板 + 轨迹/引用可视化（Remote）。

## 5. 与官方"agent/会话/轨迹"插件的集成结论

- **agent**：用官方 agent-loop 承载所有检索问答；RAG 只注册工具/服务，不改 loop。
- **会话**：每次问答 = 一个持久化 session；查询日志/个性化记忆落 session-query。
- **轨迹跟踪**：官方 ui-trajectory 消费 turn/step/tool 事件；检索链路每步即轨迹；
  需要额外"证据链"视图时，在 ideaget client 按事件+tool/result 自绘（与现有卡片一致）。
- 官方没有的（图/向量/嵌入/三库运维）全部收敛为 3 个插件的"存储适配层"，其余一切
  复用官方能力——这就是"用插件形式编写 + 官方插件配合"的完整答案。
