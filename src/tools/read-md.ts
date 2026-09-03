/**
 * `ideaget_zotero_read_md`: the content pipeline entry — resolve the best
 * stored PDF of one item, extract text locally, and return clean Markdown
 * body text beside normalized metadata. No LLM, no OCR; scanned PDFs fail
 * with an honest error. Images are a reserved port.
 * @module ideaget/tools/read-md
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type InferArgs,
  type InferValue,
} from '@deepseek-ai/dsh-tools'
import type { IdeagetService } from '../service.js'

const READ_MD_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: 'Stable parent-item ref, e.g. zotero://user/0/item/58YFQJWK, or a bare 8-char key.',
  },
  maxChars: {
    type: 'integer',
    default: 120000,
    description: 'Extracted-text budget; larger bodies truncate and report `truncated: true`.',
  },
} as const

type ReadMdArgs = InferArgs<typeof READ_MD_PARAMETERS>

const READ_MD_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    markdown: { type: 'string', required: true },
    title: { type: 'string', required: true },
    creators: { type: 'string' },
    year: { type: 'string' },
    abstract: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    doi: { type: 'string' },
    pages: { type: 'integer', required: true },
    chars: { type: 'integer', required: true },
    truncated: { type: 'boolean', required: true },
    attachmentName: { type: 'string' },
  },
} as const

type ReadMdOutput = InferValue<typeof READ_MD_OUTPUT_SCHEMA>

export function registerReadMdTool(ctx: Context, service: IdeagetService): void {
  ctx.tools.register(defineTool({
    name: 'ideaget_zotero_read_md',
    description: 'Read a paper from the local Zotero library as clean Markdown body text plus metadata (abstract, keywords). Use for understanding paper content; mind the character budget on long papers.',
    parameters: READ_MD_PARAMETERS,
    output: {
      schema: READ_MD_OUTPUT_SCHEMA,
      render: (args, value) => {
        const head = [
          `# ${value.title}`,
          value.creators === undefined || value.creators === '' ? '' : value.creators,
          value.year === undefined || value.year === '' ? '' : value.year,
          value.keywords !== undefined && value.keywords.length > 0
            ? `Keywords: ${value.keywords.join('; ')}`
            : '',
          value.abstract === undefined || value.abstract === '' ? '' : `Abstract:\n${value.abstract}`,
        ].filter(line => line !== '').join('\n')
        const budget = value.truncated
          ? `\n\n> truncated: extracted ${value.chars} chars across ${value.pages} page(s); re-run with a larger maxChars for the rest.`
          : ''
        return [{
          type: 'text',
          text: `${head}\n\n---\n${value.markdown}${budget}`.slice(0, Number(args.maxChars) + 4000),
        }]
      },
    },
    async execute(args, exec) {
      return service.readMarkdown(args, exec.signal)
    },
  }))
}
