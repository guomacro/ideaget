# 09 · 本地嵌入模型（Qwen3-Embedding）放置与接入约定

RAG 插件在配置好 `embeddingProvider` 之前只走 BM25；接本地嵌入时按下面二选一。

## 方式 A（推荐）：本地推理服务，插件只连一个 URL

模型文件由 runner 自己管理，你只需"选一个能被服务加载的位置"：

- **Ollama**：`ollama pull qwen3-embedding:8b`（模型落在 `~/.ollama/models`，
  无需手选目录）。验证：`curl http://127.0.0.1:11434/api/embed -d '{"model":"qwen3-embedding:8b","input":"hi"}'`
- **vLLM / Infinity / TEI**（OpenAI 兼容 `/embeddings`）：模型文件放统一目录
  并指向服务，例如 `$HOME/.dsh/models/Qwen3-Embedding-0.6B`。

## 方式 B：模型文件本体要放哪（HF/ModelScope 直下时）

统一约定目录：`$HOME/.dsh/models/`（与 dsh home 一致；若放进 ideaget 仓库内，
用 `models/` 子目录——已加入 `.gitignore`，不会提交）。

```sh
# Hugging Face
huggingface-cli download Qwen/Qwen3-Embedding-0.6B \
  --local-dir "$HOME/.dsh/models/Qwen3-Embedding-0.6B" \
  --local-dir-use-symlinks False
# 国内网络（ModelScope）
modelscope download --model Qwen/Qwen3-Embedding-0.6B \
  --local_dir "$HOME/.dsh/models/Qwen3-Embedding-0.6B"
# Ollama 形态（文件自动进 ~/.ollama/models，无需手选路径）
ollama pull qwen3-embedding:8b
```

仓库含：官方基座 `Qwen/Qwen3-Embedding-0.6B`（另有 8B 版）；
[Ollama qwen3-embedding:8b](https://registry.ollama.ai/library/qwen3-embedding:8b)。

## 插件接入

`.env` 三键即可（示例已写入 `.env.example`）：
`IDEAGET_EMBEDDING_PROVIDER=url` / `IDEAGET_EMBEDDING_URL=…` /
`IDEAGET_EMBEDDING_MODEL=…`；RAG 插件构造时读取，`embeddingProvider===''`
时保持 BM25-only（默认）。

## 状态更新（2026-09）

vLLM 尝试在 GPU 上加载 Qwen3-Embedding-0.6B 失败（显存不足）。dense 腿代码已
就位但**默认关闭**（`.env` 中 `IDEAGET_EMBEDDING_PROVIDER=` 空）；此时检索纯
BM25。待 GPU/CPU 服务可用时：把 provider 置为 `url` 并确认 8080 可
`curl /v1/embeddings`，再跑一次 `indexCorpus()` 生成向量即可启用余弦融合。

## 云端线路：Google Gemini Embedding（接口 + gateway）

`src/rag/embedding/index.ts` 提供统一的 **EmbeddingProvider 接口**（唯一方法
`embedTexts(texts): Promise<number[][]>`，向量与输入一一对应）：

| provider id | gateway/接口 | 说明 |
|---|---|---|
| `url` | OpenAI 兼容 `POST {model,input}`（vLLM/Infinity/TEI） | 本地，已在用 |
| `gemini` | `POST {base}/models/{model}:batchEmbedContents`，头 `x-goog-api-key` | **云端新增** |

一致性保证：两类 provider 由同一契约实现，索引只消费 `number[][]`；余弦融合、
BM25、排序代码与 provider 无关——同一语料、同一查询，无论向量来自本地 vLLM 还
是 Gemini，**检索结果与分数逐项一致**（测试 `tests/rag-gemini.spec.ts` 用同一
确定性向量分别走两条线路断言结果完全相同）。

### 环境变量设置位置（两处）

- 模板：`ideaget/.env.example`（已更新，含本地与 Gemini 两段，密钥留空）。
- 实际生效：`ideaget/.env`（launcher 从调用目录读取；`DEEPSEEK_API_KEY` 同在此）。
  切到云端只需：
  ```bash
  IDEAGET_EMBEDDING_PROVIDER=gemini
  GEMINI_API_KEY=<你的 key>        # 或 GOOGLE_API_KEY
  # IDEAGET_GEMINI_MODEL=gemini-embedding-001   # 默认即可
  ```
- 配置后需重建索引向量：触发一次 `indexCorpus()`（rag-smoke / ingest / 后续
  corpus 工具），之后 `search()` 自动余弦融合（dense 权重 0.6 / sparse 0.4，
  可在插件 Config 调）。
