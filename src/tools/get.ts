/**
 * `ideaget_zotero_get`: one item's normalized metadata plus child notes and
 * attachment inventory. Abstract and keywords come straight from the
 * metadata/extra parsers — no LLM involved.
 * @module ideaget/tools/get
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type InferArgs,
  type InferValue,
} from '@deepseek-ai/dsh-tools'
import type { IdeagetService } from '../service.js'

const GET_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: 'Stable item ref, e.g. zotero://user/0/item/58YFQJWK, or a bare 8-char key.',
  },
  includeChildren: {
    type: 'boolean',
    default: true,
    description: 'Also list child notes and attachments.',
  },
} as const

type GetArgs = InferArgs<typeof GET_PARAMETERS>

const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    title: { type: 'string', required: true },
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
  },
} as const

const ATTACHMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    title: { type: 'string', required: true },
    contentType: { type: 'string' },
    linkMode: { type: 'string' },
    path: { type: 'string' },
  },
} as const

const GET_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    title: { type: 'string', required: true },
    creators: { type: 'string', required: true },
    year: { type: 'string' },
    itemType: { type: 'string', required: true },
    doi: { type: 'string' },
    abstract: { type: 'string' },
    keywords: { type: 'array', required: true, items: { type: 'string' } },
    tags: { type: 'array', required: true, items: { type: 'string' } },
    notes: { type: 'array', items: NOTE_SCHEMA },
    attachments: { type: 'array', items: ATTACHMENT_SCHEMA },
    numChildren: { type: 'integer' },
  },
} as const

type GetOutput = InferValue<typeof GET_OUTPUT_SCHEMA>

export function registerGetTool(ctx: Context, service: IdeagetService): void {
  ctx.tools.register(defineTool({
    name: 'ideaget_zotero_get',
    description: 'Read one Zotero item\'s metadata: title, creators, year, DOI, abstract (abstractNote), keywords (tags and parsed Keywords lines in extra), plus child notes and attachment inventory.',
    parameters: GET_PARAMETERS,
    output: {
      schema: GET_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `${value.title}`,
          `${value.creators}${value.year === undefined || value.year === '' ? '' : ` (${value.year})`}`,
          `Type: ${value.itemType}${value.doi === undefined ? '' : ` · DOI: ${value.doi}`}`,
          value.keywords.length > 0 ? `Keywords: ${value.keywords.join('; ')}` : '',
          value.abstract === undefined || value.abstract === '' ? '' : `\nAbstract:\n${value.abstract}`,
          value.notes !== undefined && value.notes.length > 0
            ? `\nNotes (${value.notes.length}):\n` + value.notes.map(note => `- ${note.title}`).join('\n')
            : '',
          value.attachments !== undefined && value.attachments.length > 0
            ? `\nAttachments (${value.attachments.length}):\n`
              + value.attachments.map(att => `- ${att.title} (${att.contentType ?? 'unknown'})`).join('\n')
            : '',
        ].filter(line => line !== '').join('\n'),
      }],
    },
    async execute(args, exec) {
      return service.getItem(args, exec.signal)
    },
  }))
}
