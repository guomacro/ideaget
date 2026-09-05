#!/usr/bin/env node
/**
 * RAG/Router smoke (headless-equivalent, no LLM): boot a minimal real Cordis
 * tree (systemPrompt -> tools -> rag -> router) via the official boot(), then
 * index the real academic artifacts under <cwd>/.ideaget/artifacts and run
 * BM25 retrieval + router.ask to prove the framework works end to end.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { boot } from 'file:///home/macro/projects/agent/agent_code/deepseek-harness/packages/boot/app-boot/lib/index.js'

const HARNESS = '/home/macro/projects/agent/agent_code/deepseek-harness'
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const ROOT_CONFIG = join(root, 'scripts/fixtures/root.cordis.yml')
const rows = [
  { id: 'systemPrompt', name: `file://${HARNESS}/packages/core/system-prompt/lib/index.js` },
  { id: 'tools', name: `file://${HARNESS}/packages/core/tools/lib/index.js` },
  { id: 'rag', name: `file://${join(root, 'lib/rag/rag/index.js')}` },
  { id: 'router', name: `file://${join(root, 'lib/rag/router/index.js')}` },
]

const ctx = await boot('ideaget-rag-smoke', ROOT_CONFIG, [{ insert: rows }])
try {
  const built = await ctx.ragIndex.indexCorpus()
  console.log(`indexed: ${built.papers} papers, ${built.chunks} chunks`)
  const queries = ['lightweight world-action model robotic', 'which papers discuss visual task specification', 'survey of agent foundation model training']
  for (const query of queries) {
    const asked = await ctx.ragRouter.ask(query)
    console.log(`\nQ: ${query}\n  layer=${asked.layer} hits=${asked.hits.length}`)
    for (const hit of asked.hits.slice(0, 3)) {
      const title = hit.title ?? hit.chunk?.paperKey
      console.log(`   [${hit.score}] ${title}\n     ${(hit.chunk?.text ?? '').slice(0, 140)}`)
    }
  }
} finally {
  await ctx.fiber.dispose()
}
