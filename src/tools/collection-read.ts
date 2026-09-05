/**
 * `ideaget_zotero_collection_read`: batch-read chosen fields (title, authors,
 * year, DOI, abstract, keywords, full body Markdown, references) of every
 * paper in one collection. Heavy fields (body/references) run the PDF
 * pipeline per paper; a paper that fails keeps returning its metadata with an
 * `error` note — one bad paper never drops the whole collection.
 * @module ideaget/tools/collection-read
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type InferArgs,
  type InferValue,
} from '@deepseek-ai/dsh-tools'
import type { IdeagetService } from '../service.js'

const COLLECTION_READ_PARAMETERS = {
  collectionRef: {
    type: 'string',
    required: true,
    description: 'Collection ref (zotero://user/0/collection/<KEY>) or bare 8-char key.',
  },
  includeAbstract: { type: 'boolean', default: true },
  includeKeywords: { type: 'boolean', default: true },
  includeFulltext: { type: 'boolean', default: false, description: 'Extract the paper body as Markdown (PDF pipeline; slower).' },
  includeReferences: { type: 'boolean', default: false, description: 'Heuristic reference lines from the body; empty when none found.' },
  maxChars: { type: 'integer', default: 60000, description: 'Per-paper body budget.' },
  limit: { type: 'integer', default: 10, description: 'Papers to read (1..20).' },
} as const

type CollectionReadArgs = InferArgs<typeof COLLECTION_READ_PARAMETERS>

const PAPER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    title: { type: 'string', required: true },
    creators: { type: 'string' },
    year: { type: 'string' },
    itemType: { type: 'string', required: true },
    doi: { type: 'string' },
    abstract: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    references: { type: 'array', items: { type: 'string' } },
    body: { type: 'string' },
    bodyTruncated: { type: 'boolean' },
    error: { type: 'string' },
  },
} as const

const COLLECTION_READ_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    collection: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        ref: { type: 'string', required: true },
        name: { type: 'string', required: true },
      },
    },
    total: { type: 'integer', required: true },
    offset: { type: 'integer', required: true },
    items: { type: 'array', required: true, items: PAPER_SCHEMA },
  },
} as const

type CollectionReadOutput = InferValue<typeof COLLECTION_READ_OUTPUT_SCHEMA>

export function registerCollectionReadTool(ctx: Context, service: IdeagetService): void {
  ctx.tools.register(defineTool({
    name: 'ideaget_zotero_collection_read',
    description: 'Read one Zotero collection: for each paper its title, authors, year, DOI, abstract, keywords, and optionally full body Markdown and reference lines. Returns metadata for every paper even when the heavy pipeline fails (error field explains).',
    parameters: COLLECTION_READ_PARAMETERS,
    output: {
      schema: COLLECTION_READ_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Collection: ${value.collection.name} — ${value.total} paper(s)`,
          ...value.items.map(paper => [
            `\n[${paper.year ?? 'n.d.'}] ${paper.title}`,
            paper.creators === undefined || paper.creators === '' ? '' : `  ${paper.creators}`,
            paper.doi === undefined ? '' : `  DOI: ${paper.doi}`,
            paper.keywords !== undefined && paper.keywords.length > 0 ? `  Keywords: ${paper.keywords.join('; ')}` : '',
            paper.abstract === undefined ? '' : `  Abstract: ${paper.abstract.slice(0, 500)}${paper.abstract.length > 500 ? '…' : ''}`,
            paper.references !== undefined ? `  References: ${paper.references.length} line(s)` : '',
            paper.body !== undefined ? `  Body: ${paper.body.length} chars${paper.bodyTruncated === true ? ' (truncated)' : ''}` : '',
            paper.error === undefined ? '' : `  error: ${paper.error}`,
          ].filter(line => line !== '').join('\n')),
        ].join('\n'),
      }],
    },
    async execute(args, exec) {
      return service.readCollectionPapers(args, exec.signal)
    },
  }))
}
