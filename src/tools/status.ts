/**
 * `ideaget_zotero_status`: connectivity/capability probe surfaced to the
 * model (and future client). Reports what the local API answered, not
 * guesses: version, server id, schema version, write-mode inference.
 * @module ideaget/tools/status
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type InferArgs,
  type InferValue,
} from '@deepseek-ai/dsh-tools'
import type { IdeagetService } from '../service.js'

const STATUS_PARAMETERS = {} as const

type StatusArgs = InferArgs<typeof STATUS_PARAMETERS>

const STATUS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reachable: { type: 'boolean', required: true },
    diagnosis: { type: 'string' },
    zoteroVersion: { type: 'string' },
    apiVersion: { type: 'string' },
    schemaVersion: { type: 'string' },
    serverId: { type: 'string' },
    writeMode: { type: 'string', required: true },
  },
} as const

type StatusOutput = InferValue<typeof STATUS_OUTPUT_SCHEMA>

function renderStatus(value: StatusOutput): string {
  if (!value.reachable) {
    return `Zotero local API: not reachable\n${value.diagnosis ?? ''}`
  }
  return [
    'Zotero local API: reachable',
    `Zotero version: ${value.zoteroVersion ?? 'not reported'}`,
    `API version: ${value.apiVersion ?? 'not reported'}`,
    `Schema version: ${value.schemaVersion ?? 'not reported'}`,
    `Server ID: ${value.serverId ?? 'not reported'}`,
    `Write mode: ${value.writeMode}`,
  ].join('\n')
}

export function registerStatusTool(ctx: Context, service: IdeagetService): void {
  ctx.tools.register(defineTool({
    name: 'ideaget_zotero_status',
    description: 'Check whether the local Zotero library API is reachable and which capabilities ideaget detected (versions, server id, write mode). Run this first when Zotero access misbehaves.',
    parameters: STATUS_PARAMETERS,
    output: {
      schema: STATUS_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    async execute(_args, exec) {
      return service.zoteroStatus(exec.signal)
    },
  }))
}
