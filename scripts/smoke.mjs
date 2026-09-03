#!/usr/bin/env node
/**
 * Real read-line smoke against the running local Zotero (component level, no
 * Cordis mount): serverInfo → metadata search → fulltext search → item +
 * children → best PDF attachment bytes → markdown pipeline, every stage
 * traced through ProbeLog so intermediate outputs are inspectable.
 *
 * Env: ZOTERO_API_BASE (default http://127.0.0.1:23119/api),
 *      IDEAGET_PROBE_DIR (default <cwd>/.ideaget/probes), verbose on.
 * Usage: node scripts/smoke.mjs [query]
 */

import { join } from 'node:path'
import { ZoteroTransport } from '../lib/zotero/transport.js'
import { ProbeLog } from '../lib/probes.js'
import {
  abstractOf,
  creatorsText,
  itemRef,
  keywordsOf,
  tagsOf,
  titleOf,
  yearOf,
} from '../lib/zotero/model.js'
import { pdfAttachmentToMarkdown } from '../lib/content/pipeline.js'

const base = process.env.ZOTERO_API_BASE ?? 'http://127.0.0.1:23119/api'
const probes = new ProbeLog(
  process.env.IDEAGET_PROBE_DIR ?? join(process.cwd(), '.ideaget', 'probes'),
  true,
)
const transport = new ZoteroTransport(base, 15000)
const query = process.argv[2] ?? 'transformer'
const maxPdfBytes = 8 * 1024 * 1024
const budgetChars = 120000

async function main() {
  console.log(`\n=== ideaget smoke: Zotero read line (base ${base}) ===\n`)

  // 1. Server capability probe
  const info = await probes.trace('zotero.serverInfo', () => transport.serverInfo())
  console.log('serverInfo:', JSON.stringify(info, null, 2))

  // 2. Metadata search
  const hits = await probes.trace('tool.search.metadata', () =>
    transport.searchItems({ query, qmode: 'titleCreatorYear', limit: 5 }))
  console.log(`\nmetadata search "${query}": ${hits.length} hit(s)`)
  for (const item of hits.slice(0, 3)) {
    console.log(` - ${titleOf(item.data)} (${yearOf(item.data.date)}) ${creatorsText(item.data)} [${item.data.itemType}] ${itemRef(item)}`)
  }

  // 3. Fulltext search
  const full = await probes.trace('tool.search.everything', () =>
    transport.searchItems({ query, qmode: 'everything', limit: 5 }))
  console.log(`\neverything search "${query}": ${full.length} hit(s)`)

  // 4. Pick the first non-attachment hit with children and read its PDF
  let candidates = hits.length > 0 ? hits : full
  if (hits.length === 0 && full.length === 0) {
    console.log('\nno hits — listing first 5 items instead')
    const anyItems = await probes.trace('zotero.items.sample', () =>
      transport.searchItems({ query: '', limit: 5 }))
    candidates = anyItems.filter(item => item.data.itemType !== 'attachment')
  }
  const target = candidates.find(item => item.data.itemType !== 'attachment')
  if (target === undefined) {
    console.log('\nno readable parent item found; smoke ends here (search itself passed).')
    return
  }

  const key = target.key
  const parent = await probes.trace('tool.get.item', () => transport.itemByKey(key))
  const children = await probes.trace('tool.get.children', () => transport.childrenOf(key))
  const notes = children.filter(child => child.data.itemType === 'note')
  const attachments = children.filter(child => child.data.itemType === 'attachment')
  console.log(`\nitem ${key}: ${titleOf(parent.data)}`)
  console.log(` children: ${children.length} (${notes.length} notes, ${attachments.length} attachments)`)

  const pdfs = attachments.filter(a => a.data.contentType === 'application/pdf')
  if (pdfs.length === 0) {
    console.log('no stored PDF attachment to read; smoke ends here.')
    return
  }

  const meta = {
    title: titleOf(parent.data),
    creators: creatorsText(parent.data),
    year: yearOf(parent.data.date),
    abstract: abstractOf(parent.data),
    keywords: keywordsOf(parent.data),
    tags: tagsOf(parent.data),
    doi: parent.data.DOI,
  }
  console.log('meta:', JSON.stringify(meta, null, 2))

  // 5. Pipeline: bytes → markdown (probe on 'pipeline.pdf' + inner bytes read)
  const result = await probes.trace('pipeline.pdf', () =>
    pdfAttachmentToMarkdown(meta, pdfs, maxPdfBytes, budgetChars, (href) =>
      probes.trace('pipeline.bytes', () => transport.attachmentBytes(href, maxPdfBytes))))

  console.log(`\npipeline result: ${result.chars} chars, ${result.pages} pages, truncated=${result.truncated}`)
  console.log('attachment:', result.attachmentName)
  console.log('\n--- markdown head (1200 chars) ---\n')
  console.log(result.markdown.slice(0, 1200))
  console.log('\n--- markdown tail (400 chars) ---\n')
  console.log(result.markdown.slice(-400))
  console.log('\nsmoke OK')
}

main().catch((error) => {
  console.error('\nsmoke FAILED:', error)
  process.exitCode = 1
})
