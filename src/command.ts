/**
 * The `/ideaget status` human command: control-plane check for the local
 * Zotero read line and the probe log location. Slash commands are not a
 * second CLI for the tools — search/read stay model-tool territory.
 * @module ideaget/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type { IdeagetService } from './service.js'
import type { ZoteroStatusView } from './types.js'

function formatStatus(status: ZoteroStatusView): string {
  if (!status.reachable) {
    return `Zotero local API: not reachable\n${status.diagnosis ?? ''}`
  }
  return [
    'Zotero local API: reachable',
    `Zotero version: ${status.zoteroVersion ?? 'not reported'}`,
    `API version: ${status.apiVersion ?? 'not reported'}`,
    `Schema version: ${status.schemaVersion ?? 'not reported'}`,
    `Server ID: ${status.serverId ?? 'not reported'}`,
    `Write mode: ${status.writeMode}`,
  ].join('\n')
}

/**
 * Register `/ideaget status` when a command registry is composed; the
 * optional-dependency form keeps the plugin loadable without one.
 */
export function registerStatusCommand(ctx: Context, service: IdeagetService): void {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'ideaget',
      description: 'Check the ideaget Zotero read line (local API, versions, probes)',
      input: { hint: 'status' },
      recordInput: false,
      handler: async (invocation) => {
        const arg = invocation.rawInput.trim()
        if (arg !== '' && arg !== 'status') {
          return { kind: 'error', text: 'Usage: /ideaget status' }
        }
        const status = await service.zoteroStatus(invocation.signal)
        return { kind: 'success', text: formatStatus(status) }
      },
    })
  })
}
