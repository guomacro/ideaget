import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RagIndexService from '../src/rag/rag/index.ts'

const tempDirs: string[] = []
afterEach(() => { tempDirs.length = 0; vi.unstubAllEnvs(); vi.restoreAllMocks() })

/** Deterministic pseudo-embedding: shared by both fake endpoints so the two
 *  providers receive identical vectors — the consistency claim. */
function embedOf(text: string): number[] {
  const vec = [0, 0, 0, 0, 0, 0]
  const tokens = new Set((text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []))
  for (const token of tokens) {
    let h = 0
    for (const ch of token) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    vec[h % vec.length] = (vec[h % vec.length] ?? 0) + 1
  }
  return vec
}

function stubTools(ctx: Context): void {
  ctx.provide('tools', { register: () => undefined } as never)
}

function makeCorpus(): { corpusDir: string; indexDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'ideaget-embed-'))
  tempDirs.push(root)
  const corpusDir = join(root, 'artifacts')
  const indexDir = join(root, 'index')
  mkdirSync(corpusDir, { recursive: true })
  const doc = (key: string, title: string, text: string) => writeFileSync(join(corpusDir, `${key}.academic.json`), JSON.stringify({
    schema: 'academic-paper/v1',
    source: { ref: `zotero://user/0/item/${key}` },
    paper: { title },
    body: { text },
  }))
  doc('PAPER0001', 'Lightweight world-action model', 'lightweight world-action model robotic manipulation latent reasoning')
  doc('PAPER0002', 'Vision language models', 'vision language model grounding image text')
  return { corpusDir, indexDir }
}

function stubEmbeddingServer(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    const body = JSON.parse(String(init?.body)) as { model?: string; input?: unknown; requests?: { content?: { parts?: { text?: string }[] } }[] }
    let texts: string[]
    if (Array.isArray(body.input)) texts = body.input as string[]
    else if (Array.isArray(body.requests)) texts = body.requests.map(r => r.content?.parts?.[0]?.text ?? '')
    else texts = [String(body.input ?? '')]
    let payload: unknown
    if (url.includes(':batchEmbedContents')) {
      payload = { embeddings: texts.map(text => ({ values: embedOf(text) })) }
    } else {
      payload = { data: texts.map((text, index) => ({ index, embedding: embedOf(text) })) }
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

describe('rag dense providers', () => {
  it('gemini: request shape, key header, and vector parsing', async () => {
    const calls: { url: string; headers: Headers; body: { requests: { model: string; content: { parts: { text: string }[] } }[] } }[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      calls.push({ url: String(input), headers: new Headers(init?.headers), body })
      return new Response(JSON.stringify({
        embeddings: body.requests.map(() => ({ values: [1, 0, 0, 0] })),
      }), { status: 200 })
    }) as unknown as typeof fetch
    vi.stubEnv('GEMINI_API_KEY', 'secret-key')
    const ctx = new Context()
    stubTools(ctx)
    const { corpusDir, indexDir } = makeCorpus()
    await ctx.plugin(RagIndexService, {
      corpusDir, indexDir,
      embeddingProvider: 'gemini',
      geminiModel: 'gemini-embedding-001',
      embedBatch: 1,
    })
    try {
      await ctx.ragIndex.indexCorpus()
      expect(calls.length).toBeGreaterThan(0)
      const first = calls[0]!
      expect(first.url).toContain('models/gemini-embedding-001:batchEmbedContents')
      expect(first.headers.get('x-goog-api-key')).toBe('secret-key')
      expect(first.body.requests[0]!.model).toBe('models/gemini-embedding-001')
      const vectors = (requireIndex(indexDir).vectors as number[][])
      expect(vectors.length).toBeGreaterThan(0)
      expect(vectors[0]).toEqual([1, 0, 0, 0])
    } finally { await ctx.fiber.dispose() }
  })

  it('consistency: url and gemini providers return identical search results', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    stubEmbeddingServer()
    const results: { key?: string; score: number }[][] = []
    for (const provider of ['url', 'gemini'] as const) {
      const ctx = new Context()
      stubTools(ctx)
      const corpus = makeCorpus()
      await ctx.plugin(RagIndexService, {
        corpusDir: corpus.corpusDir,
        indexDir: corpus.indexDir,
        embeddingProvider: provider,
        embeddingUrl: 'http://fake/v1/embeddings',
        embedBatch: 2,
      })
      try {
        await ctx.ragIndex.indexCorpus()
        const hits = await ctx.ragIndex.search('world-action model robotic', 'concept', 5)
        results.push(hits.map(h => ({ key: h.chunk?.paperKey, score: h.score })))
      } finally { await ctx.fiber.dispose() }
    }
    expect(results[0]).toEqual(results[1])
    expect(results[0]![0]!.key).toBe('PAPER0001')
    expect(results[0]![0]!.score).toBeGreaterThan(0)
  })
})

function requireIndex(indexDir: string): { vectors?: number[][] } {
  return JSON.parse(require('node:fs').readFileSync(join(indexDir, 'index.json'), 'utf8'))
}
