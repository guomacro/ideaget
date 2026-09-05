import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import IngestService from '../src/rag/ingest/index.ts'
import GraphService from '../src/rag/graph/index.ts'
import RagIndexService from '../src/rag/rag/index.ts'
import RouterService from '../src/rag/router/index.ts'

describe('paper-RAG framework skeleton', () => {
  it('mounts all four plugins as Cordis services under one context', async () => {
    const ctx = new Context()
    await ctx.plugin(IngestService, {})
    await ctx.plugin(GraphService, {})
    await ctx.plugin(RagIndexService, {})
    await ctx.plugin(RouterService, {})
    try {
      expect(ctx.get('ragIngest')).toBeInstanceOf(IngestService)
      expect(ctx.get('paperGraph')).toBeInstanceOf(GraphService)
      expect(ctx.get('ragIndex')).toBeInstanceOf(RagIndexService)
      expect(ctx.get('ragRouter')).toBeInstanceOf(RouterService)
      // Scaffold methods fail loud until parameters land.
      await expect(ctx.ragIngest.chunk('k', 't')).rejects.toThrow(/scaffold/)
      await expect(ctx.paperGraph.traverse('seed', undefined, 1)).rejects.toThrow(/scaffold/)
      await expect(ctx.ragIndex.search('q', 'fact', 5)).rejects.toThrow(/scaffold/)
      await expect(ctx.ragRouter.classify('what is X?')).rejects.toThrow(/scaffold/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps default Config values for later refinement', async () => {
    expect(IngestService.Config).toBeDefined()
    expect(GraphService.Config).toBeDefined()
    expect(RagIndexService.Config).toBeDefined()
    expect(RouterService.Config).toBeDefined()
  })
})
