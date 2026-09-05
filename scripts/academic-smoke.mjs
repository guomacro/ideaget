#!/usr/bin/env node
/**
 * Rules-based academic parsing smoke over REAL papers from the local Zotero:
 * pick 3+ papers, run the academic pipeline, write JSON artifacts under
 * `<cwd>/.ideaget/artifacts`, and print a digest for the human checks:
 *  1) reading order / prose fluency (sample paragraphs across the body)
 *  2) section & references placement
 *  3) table/figure honesty
 * Usage: node scripts/academic-smoke.mjs ["LiLa-WAM" "MagicAgent" "IFNet"]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZoteroTransport } from '../lib/zotero/transport.js'
import {
  abstractOf, creatorsNames, itemRef, keywordsOf, titleOf, yearOf,
} from '../lib/zotero/model.js'
import { bestPdfAttachment } from '../lib/content/pipeline.js'
import { parsePdfToAcademic } from '../lib/content/academic.js'

const here = dirname(fileURLToPath(import.meta.url))
const artifactsDir = join(here, '..', '.ideaget', 'artifacts')
const transport = new ZoteroTransport('http://127.0.0.1:23119/api', 20000)
const argv = process.argv.slice(2)
const fileIndex = argv.indexOf('--file')
const files = fileIndex === -1 ? [] : argv.slice(fileIndex + 1).filter(a => !a.startsWith('--'))
const queries = files.length === 0 && argv.length > 0 ? argv : (files.length > 0 ? [] : ['LiLa-WAM', 'MagicAgent', 'IFNet'])

async function resolvePaper(query) {
  const hits = await transport.searchItems({ query, qmode: 'titleCreatorYear', limit: 8 })
  const parents = hits.filter(item => item.data.itemType !== 'attachment')
  const chosen = parents[0] ?? hits[0]
  if (chosen === undefined) return undefined
  let item = chosen
  let parent = item
  if (item.data.itemType !== 'attachment') {
    parent = item
    const children = await transport.childrenOf(item.key)
    const pdf = bestPdfAttachment(children)
    if (pdf === undefined) return undefined
    return { parent, attachment: pdf.item, href: pdf.href }
  }
  // Attachment hit: resolve its parent for metadata.
  const up = item.links?.up?.href
  const m = up && /\/(items)\/([A-Z0-9]{8})/.exec(up)
  if (m) parent = await transport.itemByKey(m[2])
  return { parent, attachment: item, href: item.links?.enclosure?.href ?? '' }
}

async function main() {
  mkdirSync(artifactsDir, { recursive: true })
  const fileJobs = files.map(file => ({ kind: 'file', file }))
  const queryJobs = queries.map(query => ({ kind: 'query', query }))
  for (const job of fileJobs.length > 0 ? fileJobs : queryJobs) {
    const label = job.kind === 'file' ? job.file.split('/').pop() ?? job.file : job.query
    console.log(`\n===== ${label} =====`)
    try {
      if (job.kind === 'file') {
        const { readFileSync } = await import('node:fs')
        const bytes = new Uint8Array(readFileSync(job.file))
        const doc = await parsePdfToAcademic(bytes, { sourceFile: label }, { budgetChars: 400_000 })
        const path = join(artifactsDir, `file-${label.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}.academic.json`)
        writeFileSync(path, JSON.stringify(doc, null, 2))
        console.log(`  ${doc.body.pages} pages · ${doc.stats.chars} chars · paragraphs=${doc.body.paragraphs} · sections=${doc.body.sections.length} · refs=${doc.references.length} · tables=${doc.stats.tables} · figures=${doc.stats.figures}`)
        console.log(`  artifact: ${path}`)
        const heads = doc.body.sections.filter(s => s.heading).slice(0, 10).map(s => s.heading).join(' | ')
        console.log(`  section heads: ${heads}`)
        const paras = doc.body.text.split(/\n\s*\n/).filter(p => p.trim() !== '')
        console.log('  --- head ---'); console.log('  ' + (paras.slice(0, 2).join(' ¶¶ ') ?? '').slice(0, 800).replace(/\n/g, ' '))
        console.log('  --- middle ---'); console.log('  ' + ((paras[Math.floor(paras.length * 0.45)] ?? '')).slice(0, 360).replace(/\n/g, ' '))
        console.log('  --- refs ---'); console.log('  ' + doc.references.slice(0, 2).join(' | ').slice(0, 300))
        continue
      }
      const paper = await resolvePaper(job.query)
      if (paper === undefined) { console.log('no matching PDF found'); continue }
      const data = paper.parent.data
      const bytes = await transport.attachmentBytes(paper.href, 16 * 1024 * 1024)
      const doc = await parsePdfToAcademic(bytes, {
        ref: itemRef(paper.parent),
        title: titleOf(data),
        authors: creatorsNames(data),
        year: yearOf(data.date),
        abstract: abstractOf(data),
        keywords: keywordsOf(data),
        doi: data.DOI,
        sourceFile: paper.attachment.data.filename,
      }, { budgetChars: 400_000 })
      const path = join(artifactsDir, `${paper.parent.key}.academic.json`)
      writeFileSync(path, JSON.stringify(doc, null, 2))
      console.log(`[${paper.parent.key}] ${doc.paper.title}`)
      console.log(`  ${doc.body.pages} pages · ${doc.stats.chars} chars · paragraphs=${doc.body.paragraphs} · sections=${doc.body.sections.length} · refs=${doc.references.length} · tables=${doc.stats.tables} · figures=${doc.stats.figures}`)
      console.log(`  artifact: ${path}`)
      const sections = doc.body.sections.filter(s => s.heading)
      console.log(`  section heads: ${sections.slice(0, 12).map(s => s.heading).join(' | ')}`)
      if (doc.notes.length > 0) console.log(`  notes: ${doc.notes.join('; ')}`)
      // Prose samples: first body paragraphs (order/fluency), a middle and a
      // late paragraph, and the references head.
      const paras = doc.body.text.split(/\n\s*\n/).filter(p => p.trim() !== '')
      const head = paras.slice(0, 3).join(' ¶¶ ')
      const mid = paras[Math.floor(paras.length * 0.45)] ?? ''
      const late = paras[Math.floor(paras.length * 0.8)] ?? ''
      console.log('  --- head paragraphs ---'); console.log('  ' + head.slice(0, 700).replace(/\n/g, ' '))
      console.log('  --- middle paragraph ---'); console.log('  ' + mid.slice(0, 360).replace(/\n/g, ' '))
      console.log('  --- late paragraph ---'); console.log('  ' + late.slice(0, 360).replace(/\n/g, ' '))
      console.log('  --- references head ---'); console.log('  ' + (doc.references.slice(0, 3).join(' | ')).slice(0, 400))
      if (doc.tables.length > 0) {
        console.log(`  table#0 rows=${doc.tables[0].rows.length}: ` + JSON.stringify(doc.tables[0].rows.slice(0, 3)))
      }
    } catch (error) {
      console.log(`FAILED: ${error.message}`)
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
