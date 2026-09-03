/**
 * `ideaget_zotero_search`: candidates from the user's local library using
 * Zotero's own quick search (metadata, or fulltext-indexed with
 * `qmode: everything`). Compact output — stable refs plus the facts an agent
 * needs to escalate with `ideaget_zotero_get` / `ideaget_zotero_read_md`.
 * @module ideaget/tools/search
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type InferArgs,
  type InferValue,
} from '@deepseek-ai/dsh-tools'
import type { IdeagetService } from '../service.js'

const SEARCH_PARAMETERS = {
  query: { type: 'string', required: true, description: 'Free-text query.' },
  qmode: {
    type: 'string',
    enum: ['titleCreatorYear', 'everything'],
    default: 'titleCreatorYear',
    description: 'titleCreatorYear: title/creator/year only; everything: also Zotero-indexed full text.',
  },
  limit: { type: 'integer', default: 5, description: 'Maximum results; capped by the configured limit.' },
} as const

type SearchArgs = InferArgs<typeof SEARCH_PARAMETERS>

const SEARCH_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    title: { type: 'string', required: true },
    creators: { type: 'string' },
    year: { type: 'string' },
    itemType: { type: 'string', required: true },
    attachmentType: { type: 'string' },
  },
} as const

const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string', required: true },
    qmode: { type: 'string', required: true },
    total: { type: 'integer', required: true },
    items: { type: 'array', required: true, items: SEARCH_ITEM_SCHEMA },
  },
} as const

type SearchOutput = InferValue<typeof SEARCH_OUTPUT_SCHEMA>

export function registerSearchTool(ctx: Context, service: IdeagetService): void {
  ctx.tools.register(defineTool({
    name: 'ideaget_zotero_search',
    description: 'Search the user\'s local Zotero library. Returns compact item summaries with stable `zotero://user/0/item/<KEY>` refs; escalate with ideaget_zotero_get or ideaget_zotero_read_md.',
    parameters: SEARCH_PARAMETERS,
    output: {
      schema: SEARCH_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value.items.length === 0
          ? `No Zotero items matched "${value.query}".`
          : `${value.items.length} of ${value.total} item(s) matched "${value.query}":\n`
            + value.items.map(item => `- ${item.title} (${item.year ?? 'n.d.'}) ${item.creators ?? ''} — ${item.ref}`).join('\n'),
      }],
    },
    async execute(args, exec) {
      return service.searchItems(args, exec.signal)
    },
  }))
}
