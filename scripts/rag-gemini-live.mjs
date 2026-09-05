#!/usr/bin/env node
/**
 * Live Gemini-embedding RAG test with known-answer questions over the real
 * corpus. Loads ideaget/.env (last-wins), indexes chunks with dense vectors
 * via Google Gemini, then asks questions whose answers are known to be in the
 * papers, printing ranked hits with excerpts so the effect is inspectable.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Load .env (no override of already-set vars).
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const envFile = join(root, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const s = line.trim()
    if (s === '' || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq === -1) continue
    const key = s.slice(0, eq).trim()
    const value = s.slice(eq + 1).trim()
    process.env[key] = value  // .env is the authority for this run
  }
}

const { boot } = await import('file:///home/macro/projects/agent/agent_code/deepseek-harness/packages/boot/app-boot/lib/index.js')
const HARNESS = '/home/macro/projects/agent/agent_code/deepseek-harness'
const rows = [
  { id: 'systemPrompt', name: `file://${HARNESS}/packages/core/system-prompt/lib/index.js` },
  { id: 'tools', name: `file://${HARNESS}/packages/core/tools/lib/index.js` },
  { id: 'rag', name: `file://${join(root, 'lib/rag/rag/index.js')}` },
  { id: 'router', name: `file://${join(root, 'lib/rag/router/index.js')}` },
]

const ctx = await boot('ideaget-rag-gemini-live', join(root, 'scripts/fixtures/root.cordis.yml'), [{ insert: rows }])
try {
  const t0 = Date.now()
  const built = await ctx.ragIndex.indexCorpus()
  const diag = ctx.ragIndex.denseDiagnosis()
  console.log(`indexed ${built.papers} papers / ${built.chunks} chunks in ${Date.now() - t0}ms`)
  console.log(`dense: provider=${diag.provider} on=${diag.on} vectors=${diag.vectors}${diag.error ? ` error=${diag.error}` : ''}`)

  const cases = [
    { q: 'What GPU memory budget is needed to train the LiLa-WAM world-action model end to end?', expect: ['24GB', '90.48'] },
    { q: 'Which benchmark suites did the authors evaluate LiLa-WAM on?', expect: ['RoboTwin', 'LIBERO'] },
  ]
  for (const c of cases) {
    const t1 = Date.now()
    const hits = await ctx.ragRouter.ask(c.q)
    console.log(`\nQ: ${c.q}\n  layer=${hits.layer} hits=${hits.hits.length} (${Date.now() - t1}ms)`)
    const top = hits.hits.slice(0, 3)
    top.forEach((hit, i) => {
      const text = (hit.chunk?.text ?? '').slice(0, 420).replace(/\s+/g, ' ')
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
