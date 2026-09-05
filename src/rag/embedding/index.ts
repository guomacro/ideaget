/**
 * Embedding provider seam: one `embedTexts` contract for every backend so the
 * retrieval index (and its downstream fusion) is provider-agnostic — a local
 * OpenAI-compatible endpoint and Google Gemini produce identical vector
 * semantics (aligned input order), which keeps search results consistent
 * whichever provider serves the vectors.
 *
 * - `url`    : OpenAI-compatible `POST {model, input}` (vLLM / Infinity / TEI / Ollama).
 * - `gemini` : Google Generative Language `batchEmbedContents` (cloud).
 *
 * Proxy: non-loopback targets honor `HTTPS_PROXY`/`http_proxy` (and their
 * lowercase forms) through undici `ProxyAgent`; loopback endpoints (local
 * vLLM etc.) always connect directly.
 * @module ideaget/rag/embedding
 */

import { ProxyAgent } from 'undici'

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

function proxyUrlFromEnv(): string {
  return process.env.HTTPS_PROXY
    ?? process.env.https_proxy
    ?? process.env.HTTP_PROXY
    ?? process.env.http_proxy
    ?? ''
}

function isLoopback(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url)
}

const proxyAgents = new Map<string, ProxyAgent>()

/** Dispatcher for one request target; null when no proxy or loopback. */
function dispatcherFor(url: string): ProxyAgent | null {
  const proxy = proxyUrlFromEnv()
  if (proxy === '' || isLoopback(url)) return null
  let agent = proxyAgents.get(proxy)
  if (agent === undefined) {
    agent = new ProxyAgent(proxy)
    proxyAgents.set(proxy, agent)
  }
  return agent
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause
  const causePart = cause?.code !== undefined ? ` (cause ${cause.code}${cause?.message ? `: ${cause.message}` : ''})` : ''
  return `${error.message}${causePart}`
}

async function attemptFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`embedding endpoint ${url} returned ${response.status} ${response.statusText}`)
  }
  return response
}

/** POST with optional proxy; on proxy failure it falls back to a direct
 *  attempt and reports both outcomes so misconfiguration is diagnosable. */
async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const dispatcher = dispatcherFor(url)
  const baseInit: RequestInit & { dispatcher?: unknown } = {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }
  const run = async (proxyDispatcher: unknown | null): Promise<Response> => {
    const init: RequestInit = { ...baseInit }
    if (proxyDispatcher !== null) (init as RequestInit & { dispatcher?: unknown }).dispatcher = proxyDispatcher
    return attemptFetch(url, init)
  }
  if (dispatcher === null) {
    return (await run(null)).json() as Promise<unknown>
  }
  try {
    return (await run(dispatcher)).json() as Promise<unknown>
  } catch (proxyError) {
    try {
      return (await run(null)).json() as Promise<unknown>
    } catch (directError) {
      const proxy = proxyUrlFromEnv()
      throw new Error(
        `embedding request failed via proxy ${JSON.stringify(proxy)}: ${errorDetail(proxyError)}; direct retry: ${errorDetail(directError)}`,
      )
    }
  }
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
