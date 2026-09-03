import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdeagetError } from '../src/errors.js'
import { ZoteroTransport } from '../src/zotero/transport.js'

function response(init: { status?: number; headers?: Record<string, string>; body?: unknown }): Response {
  const headers = new Headers(init.headers ?? {})
  return new Response(init.body === undefined ? null : JSON.stringify(init.body), {
    status: init.status ?? 200,
    headers,
  })
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('ZoteroTransport', () => {
  const base = 'http://127.0.0.1:23119/api'

  it('serverInfo parses capability headers', async () => {
    globalThis.fetch = vi.fn(async () => response({
      status: 200,
      headers: {
        'x-zotero-version': '10.0.1',
        'zotero-api-version': '3',
        'zotero-schema-version': '44',
        'zotero-server-id': 'SERVER1',
      },
      body: null,
    })) as unknown as typeof fetch
    const transport = new ZoteroTransport(base, 1000)
    const info = await transport.serverInfo()
    expect(info).toMatchObject({
      reachable: true,
      zoteroVersion: '10.0.1',
      apiVersion: '3',
      schemaVersion: '44',
      serverId: 'SERVER1',
      writeMode: 'local-write',
    })
  })

  it('serverInfo reports readonly for Zotero 7', async () => {
    globalThis.fetch = vi.fn(async () => response({
      status: 200,
      headers: { 'x-zotero-version': '7.0.4' },
      body: null,
    })) as unknown as typeof fetch
    const info = await new ZoteroTransport(base, 1000).serverInfo()
    expect(info.writeMode).toBe('readonly')
  })

  it('serverInfo maps connection refusal to unreachable without throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      const error = new Error('fetch failed') as Error & { cause?: { code?: string } }
      error.cause = { code: 'ECONNREFUSED' }
      throw error
    }) as unknown as typeof fetch
    const info = await new ZoteroTransport(base, 1000).serverInfo()
    expect(info.reachable).toBe(false)
    expect(info.diagnosis).toContain('not running')
  })

  it('maps 403 to local-api-disabled', async () => {
    globalThis.fetch = vi.fn(async () => response({ status: 403, body: null })) as unknown as typeof fetch
    await expect(new ZoteroTransport(base, 1000).searchItems({ query: 'x' }))
      .rejects.toMatchObject<IdeagetError>({ code: 'local-api-disabled' })
  })

  it('builds the quicksearch URL with qmode/limit', async () => {
    const fetchMock = vi.fn(async () => response({ status: 200, body: [] })) as unknown as typeof fetch
    globalThis.fetch = fetchMock
    await new ZoteroTransport(base, 1000).searchItems({ query: 'hi there', qmode: 'everything', limit: 3 })
    const url = (fetchMock.mock.calls[0]![0] as string)
    expect(url).toContain('/users/0/items?')
    expect(url).toContain('q=hi+there')
    expect(url).toContain('qmode=everything')
    expect(url).toContain('limit=3')
  })

  it('reads file:// attachments from disk and enforces the budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ideaget-att-'))
    const path = join(dir, 'paper.pdf')
    writeFileSync(path, 'pdf-bytes')
    const href = `file://${path}`
    const transport = new ZoteroTransport(base, 1000)
    await expect(transport.attachmentBytes(href, 100)).resolves.toEqual(new Uint8Array([...Buffer.from('pdf-bytes')]))
    await expect(transport.attachmentBytes(href, 4)).rejects.toMatchObject<IdeagetError>({ code: 'pdf-budget-exceeded' })
  })

  it('rejects unsupported attachment link schemes', async () => {
    const transport = new ZoteroTransport(base, 1000)
    await expect(transport.attachmentBytes('ftp://x/y.pdf', 100))
      .rejects.toMatchObject<IdeagetError>({ code: 'attachment-not-readable' })
  })
})
