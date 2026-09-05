import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import RagIndexService from '../src/rag/rag/index.ts'
import RouterService from '../src/rag/router/index.ts'
import GraphService from '../src/rag/graph/index.ts'
import IngestService from '../src/rag/ingest/index.ts'

function toolStub(ctx: Context, registered: string[]): void {
  ctx.provide('tools', {
    register: (definition: { name?: string }) => { registered.push(definition?.name ?? '?') },
  } as never)
}

const tempDirs: string[] = []

afterEach(() => {
  tempDirs.length = 0
})

function makeCorpus(): { corpusDir: string; indexDir: string; key: string } {
  const root = mkdtempSync(join(tmpdir(), 'ideaget-rag-'))
  tempDirs.push(root)
  const corpusDir = join(root, 'artifacts')
  const indexDir = join(root, 'index')
  mkdirSync(corpusDir, { recursive: true })
  const key = 'AAAABBBB'
  writeFileSync(join(corpusDir, `${key}.academic.json`), JSON.stringify({
    schema: 'academic-paper/v1',
    source: { ref: 'zotero://user/0/item/AAAABBBB' },
    paper: { title: 'Lightweight Latent Reasoning', abstract: 'abstract', keywords: [] },
    body: {
      text: [
        'Introduction paragraph about lightweight latent reasoning models for robotic manipulation.',
        'A second paragraph discusses world-action modeling and future-state prediction.',
      ].join('\n\n'),
    },
  }))
  return { corpusDir, indexDir, key }
}

describe('paper-RAG framework (first version)', () => {
  it('rag: indexes a corpus and returns ranked BM25 hits with paper titles', async () => {
    const ctx = new Context()
    const registered: string[] = []
    toolStub(ctx, registered)
    const { corpusDir, indexDir } = makeCorpus()
    await ctx.plugin(RagIndexService, { corpusDir, indexDir, chunkChars: 400, chunkOverlap: 50 })
    try {
      expect(registered).toContain('ideaget_rag_status')
      expect(registered).toContain('ideaget_rag_search')
      const built = await ctx.ragIndex.indexCorpus()
      expect(built.papers).toBe(1)
      expect(built.chunks).toBeGreaterThanOrEqual(2)
      const hits = await ctx.ragIndex.search('lightweight robotic manipulation', 'concept', 3)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]!.chunk?.paperKey).toBe('AAAABBBB')
      expect((hits[0] as { title?: string }).title).toContain('Lightweight')
      expect(hits[0]!.source).toBe('bm25')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rag: returns no hits on an empty corpus and reports status', async () => {
    const ctx = new Context()
    toolStub(ctx, [])
    const { corpusDir, indexDir } = makeCorpus()
    await ctx.plugin(RagIndexService, { corpusDir: join(corpusDir, 'empty'), indexDir })
    try {
      const status = ctx.ragIndex.status()
      expect(status.indexed).toBe(true)
      expect(status.papers).toBe(0)
      expect(await ctx.ragIndex.search('anything', 'fact', 3)).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('router: classifies layers and ask() returns routed evidence', async () => {
    const ctx = new Context()
    const registered: string[] = []
    toolStub(ctx, registered)
    const { corpusDir, indexDir } = makeCorpus()
    await ctx.plugin(RagIndexService, { corpusDir, indexDir, chunkChars: 400 })
    await ctx.ragIndex.indexCorpus()
    await ctx.plugin(RouterService, {})
    try {
      expect(registered).toContain('ideaget_paper_ask')
      expect(await ctx.ragRouter.classify('什么是自注意力机制？')).toBe('concept')
      expect(await ctx.ragRouter.classify('近年的研究热点')).toBe('trend')
      expect(await ctx.ragRouter.classify('这篇论文引用了哪些工作？')).toBe('relation')
      expect(await ctx.ragRouter.classify('今年是2026年吗')).toBe('fact')
      const asked = await ctx.ragRouter.ask('lightweight world-action model')
      expect(asked.layer).toBe('fact')
      expect(asked.hits.length).toBeGreaterThan(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('graph: JSON backend upserts nodes/edges and traverses BFS', async () => {
    const ctx = new Context()
    const graphDir = join(mkdtempSync(join(tmpdir(), 'ideaget-graph-')), 'g')
    await ctx.plugin(GraphService, { graphDir })
    try {
      await ctx.paperGraph.upsertNode({ id: 'p1', kind: 'paper', label: 'Paper 1', props: {} })
      await ctx.paperGraph.upsertNode({ id: 'p2', kind: 'paper', label: 'Paper 2', props: {} })
      await ctx.paperGraph.upsertNode({ id: 'a1', kind: 'author', label: 'Alice', props: {} })
      await ctx.paperGraph.upsertEdge({ from: 'p1', to: 'p2', kind: 'CITES' })
      await ctx.paperGraph.upsertEdge({ from: 'p1', to: 'a1', kind: 'AUTHORED_BY' })
      const all = await ctx.paperGraph.traverse('p1', undefined, 2)
      expect(all.nodes.map(n => n.id).sort()).toEqual(['a1', 'p1', 'p2'])
      const cites = await ctx.paperGraph.traverse('p1', 'CITES', 1)
      expect(cites.nodes.map(n => n.id).sort()).toEqual(['p1', 'p2'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('ingest: reports missing artifact or triggers rag reindex when composed', async () => {
    const ctx = new Context()
    const registered: string[] = []
    toolStub(ctx, registered)
    const { corpusDir, indexDir, key } = makeCorpus()
    const outDir = join(corpusDir, '..', 'ingest')
    await ctx.plugin(RagIndexService, { corpusDir, indexDir, chunkChars: 400 })
    await ctx.plugin(IngestService, { corpusDir, outDir })
    try {
      const done = await ctx.ragIngest.ingest(key)
      expect(done.artifactFound).toBe(true)
      expect(done.ragIndexed?.papers).toBeGreaterThan(0)
      const missing = await ctx.ragIngest.ingest('ZZZZZZZZ')
      expect(missing.artifactFound).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
