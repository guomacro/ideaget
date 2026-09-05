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
