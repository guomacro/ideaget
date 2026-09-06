#!/usr/bin/env node
/**
 * Live local-llama.cpp-embedding RAG test with known-answer questions over the
 * real corpus. Forces the `url` provider onto the local llama.cpp server
 * (http://127.0.0.1:8080/v1/embeddings), re-indexes chunks with dense vectors,
 * then asks questions whose answers are known to be in the papers, printing
 * ranked hits + expected-token checks so dense fusion is inspectable.
 *
 * Run:  node scripts/rag-local-live.mjs        (server must be up first)
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Force the local URL provider (do NOT read .env: we test the local endpoint).
process.env.IDEAGET_EMBEDDING_PROVIDER = 'url'
process.env.IDEAGET_EMBEDDING_URL = 'http://127.0.0.1:8080/v1/embeddings'
process.env.IDEAGET_EMBEDDING_MODEL = 'Qwen3-Embedding-0.6B'

const { boot } = await import('file:///home/macro/projects/agent/agent_code/deepseek-harness/packages/boot/app-boot/lib/index.js')
const HARNESS = '/home/macro/projects/agent/agent_code/deepseek-harness'
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const rows = [
  { id: 'systemPrompt', name: `file://${HARNESS}/packages/core/system-prompt/lib/index.js` },
  { id: 'tools', name: `file://${HARNESS}/packages/core/tools/lib/index.js` },
  { id: 'rag', name: `file://${join(root, 'lib/rag/rag/index.js')}` },
  { id: 'router', name: `file://${join(root, 'lib/rag/router/index.js')}` },
]

const ctx = await boot('ideaget-rag-local-live', join(root, 'scripts/fixtures/root.cordis.yml'), [{ insert: rows }])
try {
  const t0 = Date.now()
  const built = await ctx.ragIndex.indexCorpus()
  const diag = ctx.ragIndex.denseDiagnosis()
  console.log(`indexed ${built.papers} papers / ${built.chunks} chunks in ${Date.now() - t0}ms`)
  console.log(`dense: provider=${diag.provider} on=${diag.on} vectors=${diag.vectors}${diag.error ? ` error=${diag.error}` : ''}`)

  const cases = [
    { q: 'What GPU memory budget is needed to train the LiLa-WAM world-action model end to end?', expect: ['24GB', '90.48'] },
    { q: 'Which benchmark suites did the authors evaluate LiLa-WAM on?', expect: ['RoboTwin', 'LIBERO'] },
    { q: 'What does IFNet fuse for multisensor estimation under unknown correlation?', expect: ['covariance', 'estimate'] },
    { q: 'What does MagicAgent use to generalize agent planning across tasks?', expect: ['planning', 'LLM'] },
  ]
  for (const c of cases) {
    const t1 = Date.now()
    const { layer, hits } = await ctx.ragRouter.ask(c.q)
    console.log(`\nQ: ${c.q}\n  layer=${layer} hits=${hits.length} (${Date.now() - t1}ms) sources=${[...new Set(hits.map(h => h.source))].join(',')}`)
    const top = hits.slice(0, 3)
    top.forEach((hit, i) => {
      const text = (hit.chunk?.text ?? '').slice(0, 380).replace(/\s+/g, ' ')
      console.log(`  [${i + 1}] (${hit.score}) ${hit.title ?? hit.chunk?.paperKey}\n     ${text}`)
    })
    const joined = top.map(h => (h.chunk?.text ?? '')).join(' ')
    for (const token of c.expect) {
      console.log(`  expect "${token}": ${joined.includes(token) ? 'FOUND ✓' : 'MISSING ✗'}`)
    }
  }
} finally {
  await ctx.fiber.dispose()
}
