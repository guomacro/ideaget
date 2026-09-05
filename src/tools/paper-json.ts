/**
 * `ideaget_zotero_paper_json`: rules-based academic PDF parsing into an
 * `academic-paper/v1` JSON artifact written to disk (for RAG ingestion).
 * Returns the artifact path plus parse statistics — the full JSON is on disk,
 * not in the model context.
 * @module ideaget/tools/paper-json
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type InferArgs,
  type InferValue,
} from '@deepseek-ai/dsh-tools'
import type { IdeagetService } from '../service.js'

const PAPER_JSON_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: 'Paper ref (zotero://user/0/item/<KEY>) or bare 8-char key.',
  },
  maxChars: {
    type: 'integer',
    default: 400000,
    description: 'Reading-order text budget.',
  },
} as const

type PaperJsonArgs = InferArgs<typeof PAPER_JSON_PARAMETERS>

const PAPER_JSON_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    artifactPath: { type: 'string', required: true },
    title: { type: 'string', required: true },
    pages: { type: 'integer', required: true },
    chars: { type: 'integer', required: true },
    sections: { type: 'array', required: true, items: { type: 'string' } },
    references: { type: 'integer', required: true },
    tables: { type: 'integer', required: true },
    figures: { type: 'integer', required: true },
    notes: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

type PaperJsonOutput = InferValue<typeof PAPER_JSON_OUTPUT_SCHEMA>

export function registerPaperJsonTool(ctx: Context, service: IdeagetService): void {
  ctx.tools.register(defineTool({
    name: 'ideaget_zotero_paper_json',
    description: 'Parse one paper into a structured academic JSON artifact (rules-based, no model): reading-order sections, tables, figures, references. Writes <artifactDir>/<KEY>.academic.json and returns its path and statistics.',
    parameters: PAPER_JSON_PARAMETERS,
    output: {
      schema: PAPER_JSON_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `parsed: ${value.title}`,
          `${value.pages} pages · ${value.chars} chars · sections: ${value.sections.length} · references: ${value.references} · tables: ${value.tables} · figures: ${value.figures}`,
          `artifact: ${value.artifactPath}`,
          value.notes.length > 0 ? `notes: ${value.notes.join('; ')}` : '',
        ].filter(line => line !== '').join('\n'),
      }],
    },
    async execute(args, exec) {
      return service.produceAcademicArtifact(args, exec.signal)
    },
  }))
}
