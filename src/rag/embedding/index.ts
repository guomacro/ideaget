/**
 * Embedding provider seam: one `embedTexts` contract for every backend so the
 * retrieval index (and its downstream fusion) is provider-agnostic — a local
 * OpenAI-compatible endpoint and Google Gemini produce identical vector
 * semantics (aligned input order), which keeps search results consistent
 * whichever provider serves the vectors.
 *
 * - `url`    : OpenAI-compatible `POST {model, input}` (vLLM / Infinity / TEI / Ollama).
 * - `gemini` : Google Generative Language `batchEmbedContents` (cloud).
 * @module ideaget/rag/embedding
 */

export interface EmbeddingProviderOptions {
  provider: '' | 'url' | 'gemini'
  url: string
  model: string
  batch: number
  timeoutMs: number
  apiKey: string
  geminiBaseUrl: string
}

export interface EmbeddingProvider {
  id: 'url' | 'gemini'
  embedTexts(texts: string[]): Promise<number[][]>
}

/** Reason the configured provider cannot run (empty when ready). */
export function readiness(options: EmbeddingProviderOptions): string | null {
  if (options.provider === 'url') {
    return options.url === '' ? 'url provider configured but IDEAGET_EMBEDDING_URL is empty' : null
  }
  if (options.provider === 'gemini') {
    if (options.apiKey === '') return 'gemini provider configured but GEMINI_API_KEY is empty'
    if (options.model === '') return 'gemini model is empty'
    return null
  }
  return null
}

export function createEmbeddingProvider(options: EmbeddingProviderOptions): EmbeddingProvider | null {
  if (options.provider === '' || readiness(options) !== null) return null
  return options.provider === 'gemini'
    ? geminiProvider(options)
    : urlProvider(options)
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`embedding endpoint ${url} returned ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<unknown>
}

function urlProvider(options: EmbeddingProviderOptions): EmbeddingProvider {
  return {
    id: 'url',
    async embedTexts(texts) {
      const vectors: number[][] = []
      for (let start = 0; start < texts.length; start += options.batch) {
        const batch = texts.slice(start, start + options.batch)
        const payload = await postJson(options.url, { model: options.model, input: batch }, {}, options.timeoutMs) as {
          data?: { index?: number; embedding?: number[] }[]
        }
        const rows = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        for (let i = 0; i < batch.length; i++) {
          const embedding = rows[i]?.embedding
          if (embedding === undefined || embedding.length === 0) {
            throw new Error(`url provider returned no vector for batch item ${i}`)
          }
          vectors.push(embedding)
        }
      }
      return vectors
    },
  }
}

function geminiProvider(options: EmbeddingProviderOptions): EmbeddingProvider {
  const base = options.geminiBaseUrl.replace(/\/+$/, '')
  const headers = { 'x-goog-api-key': options.apiKey }
  return {
    id: 'gemini',
    async embedTexts(texts) {
      const vectors: number[][] = []
      for (let start = 0; start < texts.length; start += options.batch) {
        const batch = texts.slice(start, start + options.batch)
        const modelRef = `models/${options.model}`
        const payload = await postJson(
          `${base}/models/${options.model}:batchEmbedContents`,
          {
            requests: batch.map(text => ({ model: modelRef, content: { parts: [{ text }] } })),
          },
          headers,
          options.timeoutMs,
        ) as { embeddings?: { values?: number[] }[] }
        const rows = payload.embeddings ?? []
        for (let i = 0; i < batch.length; i++) {
          const values = rows[i]?.values
          if (values === undefined || values.length === 0) {
            throw new Error(`gemini provider returned no vector for batch item ${i}`)
          }
          vectors.push(values)
        }
      }
      return vectors
    },
  }
}
