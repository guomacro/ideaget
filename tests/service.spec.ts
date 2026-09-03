import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { IdeagetError } from '../src/errors.js'
import { IdeagetService } from '../src/service.js'

/**
 * Construct the service under a real Context with a stubbed tools registry
 * (the constructor registers tools through it; nothing here touches a live
 * Zotero because the transport base points at a closed port).
 */
async function serviceWithUnreachableZotero(): Promise<{ service: IdeagetService; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const registered: string[] = []
  ctx.provide('tools', {
    register: (definition: { name?: string }) => {
      registered.push(definition.name ?? '?')
    },
  } as never)
  await ctx.plugin(IdeagetService, {
    zoteroApiBaseUrl: 'http://127.0.0.1:1/api',
    requestTimeoutMs: 500,
    probeDir: '',
    probeVerbose: false,
  })
  const service = ctx.ideaget
  return {
    service,
    dispose: async () => { await ctx.fiber.dispose() },
    registered,
  }
}

describe('IdeagetService under a real Context', () => {
  it('registers all four tools', async () => {
    const ctx = new Context()
    const registered: string[] = []
    ctx.provide('tools', { register: (definition: { name?: string }) => { registered.push(definition.name ?? '?') } } as never)
    await ctx.plugin(IdeagetService, { zoteroApiBaseUrl: 'http://127.0.0.1:1/api', probeDir: '' })
    expect(registered).toEqual([
      'ideaget_zotero_status',
      'ideaget_zotero_search',
      'ideaget_zotero_get',
      'ideaget_zotero_read_md',
    ])
    await ctx.fiber.dispose()
  })

  it('reports an unreachable Zotero without throwing from zoteroStatus', async () => {
    const { service, dispose } = await serviceWithUnreachableZotero()
    try {
      const status = await service.zoteroStatus()
      expect(status.reachable).toBe(false)
      expect(status.writeMode).toBe('readonly')
    } finally {
      await dispose()
    }
  })

  it('maps transport failures onto stable error codes', async () => {
    const { service, dispose } = await serviceWithUnreachableZotero()
    try {
      await expect(service.searchItems({ query: 'x' })).rejects.toMatchObject<IdeagetError>({ code: 'zotero-unreachable' })
      await expect(service.getItem({ ref: 'not-a-ref' })).rejects.toMatchObject<IdeagetError>({ code: 'malformed-ref' })
      await expect(service.readMarkdown({ ref: '!!!' })).rejects.toMatchObject<IdeagetError>({ code: 'malformed-ref' })
    } finally {
      await dispose()
    }
  })
})
