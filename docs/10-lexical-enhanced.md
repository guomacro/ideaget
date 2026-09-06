# 10 · 无 embedding 场景的增强词法召回（EnhancedLexicalStore）

## 需求映射与可行性结论

外部方案描述里出现的 `VectorStore` / `EnhancedLexicalStore` / `rank_bm25` 均
非本项目现有标识符（已全仓检索确认）。映射到本项目的现状：

| 外部语汇 | 本项目对应物 | 现状 |
|---|---|---|
| `VectorStore`（向量召回引擎） | `RagIndexService` 的 dense 腿（内存向量 + 余弦融合） | 有，无独立 Store 模块，provider 关闭时自动停用 |
| `rank_bm25`（Python 库） | 内联 Okapi BM25（`rag/rag/index.ts` 的 `search()`，公式 K1=1.5/B=0.75） | 有，但逻辑埋在内联循环里、无同义词扩展、无词形归一 |
| `EnhancedLexicalStore`（增强词法召回引擎） | **本次新增模块** | 无 |

**可行性结论：可行，成本低，风险可控。** 理由：

1. "没有 embedding 时走词法召回"是现状默认行为（docs/09：`embeddingProvider===''`
   时 BM25-only）——需求本质是**把词法召回从"裸 BM25 内联"升级为可配置、可测试、
   带同义词增强的独立引擎**，而不是新增一条召回路径。
2. `rank_bm25` 是 Python 依赖，本项目是 Node/TS 的 DSH 插件，不能引 Python
   运行时 → 用等价 TS 实现同款 Okapi BM25（现成公式抽成 store），不引新依赖。
3. **同义词增强采用"双侧 canonical 折叠"**：文档与查询的 token 都经过同一张
   同义词/词形表折叠到 canonical term，BM25 在 canonical 空间计分。这样
   "LLM"↔"large language model"、"fusion"↔"fuse"、"plan"↔"planning" 等纯词法
   无法互中的词对可以召回，且无需查询端 OR 展开（折叠即对齐），语义一致、可解释。
4. 增强默认开启但**可整体关闭**；关闭后 tokenize/计分与旧实现逐位一致
   （测试断言退化等价），既有 54 个用例与 dense 融合路径不受影响。
5. 不引入 `VectorStore` 抽象层：dense 腿无独立 Store 接口，为替换而抽象是过度
   设计；保留将来接 faiss/qdrant 后端时再抽象 Store 接口的余地。

## 设计

新模块 `src/rag/lexical/index.ts`：

```
EnhancedLexicalStore
  ├─ tokenize(text)      # 短语 key 替换（多词同义词）→ 单词切分（沿用
  │                      #   [a-z0-9-] 正则）→ 同义词折叠 → 保守复数归一
  ├─ build(chunks)       # 在 canonical 空间建 df / docLen（BM25 统计）
  └─ search(query, topK) # Okapi BM25（K1=1.5, B=0.75），返回 [{index, score}]
```

- **同义词表**（`DEFAULT_SYNONYMS`，学术通用小词典，keys 支持多词、按词数+长度
  降序替换避免前缀吞噬）：
  `llm ↔ large language model(s)/language model(s)`、`robot ↔ robotic(s)`、
  `fuse ↔ fusion(s)/fused/fusing`、`estimate ↔ estimation(s)/estimating/estimated`、
  `plan ↔ planning/planner(s)/planned`、`schedule ↔ scheduling/scheduled`、
  `manipulate ↔ manipulation(s)/manipulator(s)`。
- **复数归一**（保守、默认开）：`-ies→y`、`-ses/-xes/-zes/-ches/-shes→去 es`、
  普通 `-s→去 s`（长度护栏 ≥5 且去后 ≥4），避免 `analysis/is` 类误伤。
  显式同义词优先于规则，规则不动词典外词形 → 误扩展面小、可解释。
- **开关**：`RagIndexConfig.lexicalEnhanced`（默认 `true`）；`false` 时 store 用
  空词典 + 关闭复数规则 == 旧行为。

## 集成（`rag/rag/index.ts`）

- 删除内联 `tokensOf`/`computeStats`/`TokenStats`；`indexCorpus()` 与
  `ensureIndex()` 改为 `this.lexical.build(chunks)`。
- `search()` 词法腿改为 `this.lexical.search(query)`，dense 融合与 source
  标注（`bm25`/`fused`）、命中组装逻辑不变。
- 新增 `lexicalDiagnosis()` 暴露 enhanced 开关与生效组数。

## 验证

- 单测（`tests/rag-lexical.spec.ts`）：同义词双侧折叠召回；多词 key；
  复数归一；关闭后与旧实现逐位等价；词典外词不做误扩展；topK/排序。
- 真实语料实测：不配 embedding（`provider=''`）跑 plain vs enhanced 对照，
  观察增强召回（语料中 `LLM`119 次、`large language model`35、`robot`160/
  `robotic`44、`fusion`471/`fuse`12、`estimat*`237 —— 证据充分）。
- 回归：全量 vitest（原 54 + 新增）与现有 live 脚本不受影响。
