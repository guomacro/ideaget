#!/usr/bin/env node
/**
 * Stage-1 close-out: mount ideaget inside a REAL Cordis tree (official
 * `boot()` from the read-only harness checkout) with the minimal service
 * chain the plugin needs — systemPrompt → tools → ideaget — then call
 * `ctx.ideaget` against the live local Zotero and print paper titles.
 *
 * Prerequisite: `@deepseek-ai/cordis` must resolve to the SAME instance the
 * official packages use (vendor/cordis). Run:
 *   node scripts/align-cordis.mjs   # symlink once, restores on exit
 *   node scripts/mount-test.mjs
 * @module ideaget/scripts/mount-test
 */

import { fileURLToPath } from 'node:url'
import { boot } from 'file:///home/macro/projects/agent/agent_code/deepseek-harness/packages/boot/app-boot/lib/index.js'

const HARNESS = '/home/macro/projects/agent/agent_code/deepseek-harness'
const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT_CONFIG = fileURLToPath(new URL('./fixtures/root.cordis.yml', import.meta.url))
const IDEAGET_ENTRY = `file://${process.cwd()}/lib/index.js`

const rows = [
  { id: 'systemPrompt', name: `file://${HARNESS}/packages/core/system-prompt/lib/index.js` },
  { id: 'tools', name: `file://${HARNESS}/packages/core/tools/lib/index.js` },
  { id: 'ideaget', name: IDEAGET_ENTRY },
]

async function main() {
  console.log(`mounting rows: ${rows.map(row => row.id).join(' -> ')}\n`)
  const patches = [{ insert: rows }]
  const ctx = await boot('ideaget-mount-test', ROOT_CONFIG, patches)
  try {
    const systemPrompt = ctx.get('systemPrompt')
    const tools = ctx.get('tools')
    const ideaget = ctx.get('ideaget')
    console.log('activated services:', {
      systemPrompt: typeof systemPrompt,
      tools: typeof tools,
      ideaget: typeof ideaget,
    })

    const status = await ctx.ideaget.zoteroStatus()
    console.log('\nstatus:', JSON.stringify(status, null, 2))

    // "Return paper titles from the Zotero library" — no LLM involved.
    const result = await ctx.ideaget.searchItems({ query: '', limit: 10 })
    console.log(`\nZotero paper titles (${result.items.length} returned):`)
    for (const item of result.items) {
      console.log(` - [${item.year ?? 'n.d.'}] ${item.title} (${item.creators ?? ''}) ${item.ref}`)
    }
    if (result.items.length === 0) {
      throw new Error('mount test failed: searchItems returned no titles')
    }
    console.log('\nmount test OK: plugin activated in a real Cordis tree and returned Zotero paper titles')
  } finally {
    await ctx.fiber.dispose()
  }
}

main().catch((error) => {
  console.error('\nmount test FAILED:', error)
  process.exitCode = 1
})
