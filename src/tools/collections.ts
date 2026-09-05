/**
 * `ideaget_zotero_collections`: list the library's collections with item
 * counts — the picker a user (or agent) reads before choosing which
 * collection to batch-read.
 * @module ideaget/tools/collections
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type InferArgs,
  type InferValue,
} from '@deepseek-ai/dsh-tools'
import type { IdeagetService } from '../service.js'

const COLLECTIONS_PARAMETERS = {} as const

type CollectionsArgs = InferArgs<typeof COLLECTIONS_PARAMETERS>

const COLLECTIONS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    collections: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          name: { type: 'string', required: true },
          numItems: { type: 'integer' },
        },
      },
    },
  },
} as const

type CollectionsOutput = InferValue<typeof COLLECTIONS_OUTPUT_SCHEMA>

export function registerCollectionsTool(ctx: Context, service: IdeagetService): void {
  ctx.tools.register(defineTool({
    name: 'ideaget_zotero_collections',
    description: 'List the user\'s Zotero collections with item counts. Read this first to pick a collection ref for ideaget_zotero_collection_read.',
    parameters: COLLECTIONS_PARAMETERS,
    output: {
      schema: COLLECTIONS_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value.collections.length === 0
          ? 'No Zotero collections.'
          : value.collections.map(c => `- ${c.name} (${c.numItems ?? 0} items) — ${c.ref}`).join('\n'),
      }],
    },
    async execute(_args, exec) {
      return service.listCollections(exec.signal)
    },
  }))
}
