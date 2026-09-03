/**
 * Zotero desktop local API transport (read side). Zotero 10.0.1 reality
 * probed live: `GET /api/` reports `Zotero-API-Version`, `Zotero-Schema-Version`,
 * `Zotero-Server-ID`, `X-Zotero-Version`; item JSON already carries
 * `links.enclosure.href` as a `file://` URL for stored attachments.
 *
 * Reads require no authentication. Writes are out of scope here (reserved
 * write port, see docs/01-feasibility.md): this file is read-only by
 * construction and never sends an authorization header.
 * @module ideaget/zotero/transport
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { IdeagetError, type IdeagetErrorCode } from '../errors.js'
import type { ZoteroItem } from './model.js'

/** Server capability record produced by the transport's version probe. */
export interface ZoteroServerInfo {
  reachable: boolean
  diagnosis?: string
  /** `X-Zotero-Version`, e.g. `10.0.1`. */
  zoteroVersion?: string
  /** `Zotero-API-Version` (always 3 today). */
  apiVersion?: string
  /** `Zotero-Schema-Version`, e.g. 44. */
  schemaVersion?: string
  /** `Zotero-Server-ID`; cache partitions must key on it. */
  serverId?: string
  /**
   * Local-write availability inferred from the Zotero version major (10+ per
   * the official local API doc). Reads never depend on this value.
   */
  writeMode: 'local-write' | 'readonly'
}

function errorCodeForStatus(status: number): IdeagetErrorCode {
  if (status === 403) return 'local-api-disabled'
  if (status === 404) return 'item-not-found'
  return 'zotero-unreachable'
}

/**
 * Thin JSON client over one Zotero local API base URL. `prefix` is the
 * library-scoped path prefix (`/users/0`); passing 0 selects the locally
 * logged-in user, which is what the local API serves.
 */
export class ZoteroTransport {
  private readonly prefix = '/users/0'

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  private async request(path: string, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await fetch(this.url(path), {
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: combined,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new IdeagetError('request-timeout', `Zotero request timed out after ${this.timeoutMs}ms`)
      }
      if (error instanceof Error && error.cause !== undefined
        && (error.cause as { code?: string }).code === 'ECONNREFUSED') {
        throw new IdeagetError(
          'zotero-unreachable',
          `Zotero is not running or the local API is off at ${this.baseUrl}`,
        )
      }
      throw new IdeagetError('zotero-unreachable', `Zotero request failed: ${String(error)}`)
    }
    if (!response.ok && response.status !== 302) {
      throw new IdeagetError(
        errorCodeForStatus(response.status),
        `Zotero ${path} returned ${response.status} ${response.statusText}`,
      )
    }
    return response
  }

  private async json<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await this.request(path, signal)
    return (await response.json()) as T
  }

  /** Version/capability probe: reachability, versions, server id, write mode. */
  async serverInfo(signal?: AbortSignal): Promise<ZoteroServerInfo> {
    try {
      // The base URL already ends in /api; the bare root answers the probe.
      const response = await this.request('/', signal)
      const version = response.headers.get('x-zotero-version') ?? undefined
      const major = version === undefined ? undefined : Number.parseInt(version.split('.')[0] ?? '', 10)
      return {
        reachable: true,
        zoteroVersion: version,
        apiVersion: response.headers.get('zotero-api-version') ?? undefined,
        schemaVersion: response.headers.get('zotero-schema-version') ?? undefined,
        serverId: response.headers.get('zotero-server-id') ?? undefined,
        writeMode: major !== undefined && major >= 10 ? 'local-write' : 'readonly',
      }
    } catch (error) {
      return {
        reachable: false,
        writeMode: 'readonly',
        diagnosis: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Quicksearch across metadata (and fulltext when `everything`). */
  async searchItems(options: {
    query: string
    qmode?: 'titleCreatorYear' | 'everything'
    limit?: number
    start?: number
    itemType?: string
    signal?: AbortSignal
  }): Promise<ZoteroItem[]> {
    const params = new URLSearchParams({ q: options.query, format: 'json' })
    params.set('qmode', options.qmode ?? 'titleCreatorYear')
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.start !== undefined) params.set('start', String(options.start))
    if (options.itemType !== undefined) params.set('itemType', options.itemType)
    return this.json<ZoteroItem[]>(`${this.prefix}/items?${params.toString()}`, options.signal)
  }

  /** One item by its storage key. */
  async itemByKey(key: string, signal?: AbortSignal): Promise<ZoteroItem> {
    const item = await this.json<ZoteroItem>(`${this.prefix}/items/${key}`, signal)
    if (item === null || typeof item !== 'object' || typeof item.key !== 'string') {
      throw new IdeagetError('item-not-found', `Zotero item ${key} not found`)
    }
    return item
  }

  /** Child items of one item (notes and attachments). */
  async childrenOf(key: string, signal?: AbortSignal): Promise<ZoteroItem[]> {
    return this.json<ZoteroItem[]>(`${this.prefix}/items/${key}/children`, signal)
  }

  /**
   * Resolve the stored-file bytes of an attachment. `enclosure.href` is a
   * `file://` URL from the local API; a plain HTTP href is fetched and
   * bounded. maxBytes guards the read; larger files fail loud.
   */
  async attachmentBytes(link: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (link.startsWith('file://')) {
      const path = fileURLToPath(link)
      const buffer = await readFile(path)
      if (buffer.byteLength > maxBytes) {
        throw new IdeagetError(
          'pdf-budget-exceeded',
          `attachment is ${buffer.byteLength} bytes, over the ${maxBytes} byte budget`,
        )
      }
      return new Uint8Array(buffer)
    }
    if (link.startsWith('http://') || link.startsWith('https://')) {
      const response = await this.requestForExternal(link, signal)
      const length = Number(response.headers.get('content-length') ?? '0')
      if (length > maxBytes) {
        throw new IdeagetError('pdf-budget-exceeded', `attachment is ${length} bytes, over the ${maxBytes} byte budget`)
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > maxBytes) {
        throw new IdeagetError('pdf-budget-exceeded', `attachment download exceeded the ${maxBytes} byte budget`)
      }
      return bytes
    }
    throw new IdeagetError('attachment-not-readable', `unsupported attachment link scheme: ${link.slice(0, 24)}`)
  }

  private async requestForExternal(url: string, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const response = await fetch(url, { redirect: 'follow', signal: combined })
    if (!response.ok) {
      throw new IdeagetError('attachment-not-readable', `attachment download returned ${response.status}`)
    }
    return response
  }
}
