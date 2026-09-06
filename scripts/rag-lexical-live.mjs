#!/usr/bin/env node
/**
 * No-embedding RAG live test: EnhancedLexicalStore (default, synonym-aware)
 * vs plain BM25 (`lexicalEnhanced: false`) over the real corpus. Boots two
 * RagIndexService instances on separate Contexts with a throwaway index dir
 * (never touches .ideaget/rag-index), no embedding provider, and asks queries
 * chosen so raw-lexical gaps are visible (e.g. `fuse`/`fusing` occur 0x in the
 * corpus while `fused`/`fusion` are common — only synonym folding recalls).
 *
 * Run: node scripts/rag-lexical-live.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import RagIndexService from '../lib/rag/rag/index.js'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const corpusDir = join(root, '.ideaget', 'artifacts')
const QUERIES = [
  'fuse',                                          // raw freq 0 -> only folding recalls
  'fusing sensor measurements',                    // fusing raw freq 0
  'estimate fusion under unknown correlation',     // estimation/fusion variants
  'lightweight latent reasoning world action model', // plain sanity query
]

async function runOnce(label, lexicalEnhanced) {
  process.env.IDEAGET_EMBEDDING_PROVIDER = '' // force no-embedding path
  const ctx = new Context()
  ctx.provide('tools', { register: () => undefined })
  const indexDir = mkdtempSync(join(tmpdir(), 'ideaget-lex-live-'))
  await ctx.plugin(RagIndexService, { corpusDir, indexDir, lexicalEnhanced })
  try {
    const built = await ctx.ragIndex.indexCorpus()
    const lex = ctx.ragIndex.lexicalDiagnosis()
    console.log(`\n=== ${label}: indexed ${built.papers} papers / ${built.chunks} chunks | lexicalEnhanced=${lex.enhanced} groups=${lex.groups} ===`)
    for (const q of QUERIES) {
      const hits = await ctx.ragIndex.search(q, 'fact', 5)
      console.log(`Q: ${q}`)
      if (hits.length === 0) { console.log('   (no hits)'); continue }
      for (const h of hits.slice(0, 3)) {
        const text = (h.chunk?.text ?? '').slice(0, 150).replace(/\s+/g, ' ')
        console.log(`   [${h.score}] ${h.title ?? h.chunk?.paperKey}\n      ${text}`)
      }
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

await runOnce('ENHANCED (default, synonym folding)', true)
await runOnce('PLAIN (lexicalEnhanced=false)', false)
