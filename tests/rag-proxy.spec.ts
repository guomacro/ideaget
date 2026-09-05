import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RagIndexService from '../src/rag/rag/index.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function stubTools(ctx: Context): void {
  ctx.provide('tools', { register: () => undefined } as never)
}

async function capturedInit(providerConfig: object): Promise<RequestInit | undefined> {
  let captured: RequestInit | undefined
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured = init
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0, 0] }] }), { status: 200 })
  }) as unknown as typeof fetch
  const ctx = new Context()
  stubTools(ctx)
  await ctx.plugin(RagIndexService, providerConfig)
  try {
    await ctx.ragIndex.embedTexts(['hello proxy'])
  } finally {
    await ctx.fiber.dispose()
  }
  return captured
}

describe('embedding proxy support', () => {
  it('attaches an undici dispatcher for non-loopback targets when a proxy env is set', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897')
    const init = await capturedInit({
      embeddingProvider: 'url',
      embeddingUrl: 'https://remote.example.com/v1/embeddings',
      embedBatch: 1,
    })
    expect(init).toBeDefined()
    expect((init as { dispatcher?: unknown } | undefined)?.dispatcher).toBeDefined()
  })

  it('keeps loopback targets proxy-free (local vLLM connects directly)', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897')
    const init = await capturedInit({
      embeddingProvider: 'url',
      embeddingUrl: 'http://127.0.0.1:8080/v1/embeddings',
      embedBatch: 1,
    })
    expect(init).toBeDefined()
    expect((init as { dispatcher?: unknown } | undefined)?.dispatcher).toBeUndefined()
  })
})
