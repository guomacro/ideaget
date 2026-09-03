/**
 * IdeagetService: the stable boundary of the ideaget host half — `ctx.ideaget`.
 * Owns provider construction (transport, probe log), the read-only Zotero
 * routes (search / get / markdown pipeline), and the tool + command
 * registrations. The agent/LLM plane is a reserved port: tools are registered
 * and typed now, but nothing here calls a model. Writes are also reserved
 * (see docs/01-feasibility.md for the version-matrix analysis).
 * @module ideaget/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { pdfAttachmentToMarkdown, type PaperMeta } from './content/pipeline.js'
import { Config as ConfigSchema, resolveConfig, type Config, type ResolvedConfig } from './config.js'
import { IdeagetError } from './errors.js'
import { ProbeLog } from './probes.js'
import { ZoteroTransport } from './zotero/transport.js'
import {
  abstractOf,
  creatorsText,
  itemRef,
  keywordsOf,
  parseRef,
  tagsOf,
  titleOf,
  yearOf,
  type ZoteroItem,
  type ZoteroItemData,
} from './zotero/model.js'
import { registerStatusCommand } from './command.js'
import { registerGetTool } from './tools/get.js'
import { registerReadMdTool } from './tools/read-md.js'
import { registerSearchTool } from './tools/search.js'
import { registerStatusTool } from './tools/status.js'
import type {
  GetResultView,
  PaperMarkdownView,
  SearchItemView,
  SearchResultView,
  ZoteroStatusView,
} from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    ideaget: IdeagetService
  }
}

/** Structural arg shapes the tools' inferred args satisfy. */
export interface SearchArgs {
  query: string
  qmode?: 'titleCreatorYear' | 'everything'
  limit?: number
}

export interface GetArgs {
  ref: string
  includeChildren?: boolean
}

export interface ReadMarkdownArgs {
  ref: string
  maxChars?: number
}

function metaOf(data: ZoteroItemData): PaperMeta {
  return {
    title: data.title,
    creators: creatorsText(data),
    year: yearOf(data.date),
    abstract: abstractOf(data),
    keywords: keywordsOf(data),
    tags: tagsOf(data),
    doi: data.DOI,
  }
}

/** Extract an 8-char key from a `links.up` href, if present. */
function parentKeyOf(item: ZoteroItem): string | undefined {
  const href = item.links?.up?.href
  if (href === undefined) return undefined
  const match = /\/items\/([A-Z0-9]{8})(?:\/|$)/.exec(href)
  return match?.[1]
}

/** Parse a ref into a key, mapping malformed input onto the stable error code. */
function parseKey(ref: string): string {
  try {
    return parseRef(ref)
  } catch (error) {
    throw new IdeagetError('malformed-ref', error instanceof Error ? error.message : String(error))
  }
}

export class IdeagetService extends Service {
  static inject = ['tools']

  static Config = ConfigSchema

  private readonly config: ResolvedConfig
  private readonly transport: ZoteroTransport
  private readonly probes: ProbeLog

  constructor(ctx: Context, config: Partial<Config> = {}) {
    super(ctx, 'ideaget')
    // Schemastery fills schema defaults for partial input (its call typing
    // demands the full Config; every field has a default, so the cast is
    // runtime-safe), then resolveConfig normalizes the base URL.
    this.config = resolveConfig(ConfigSchema(config as Config))
    this.probes = new ProbeLog(this.config.probeDir, this.config.probeVerbose)
    this.transport = new ZoteroTransport(this.config.zoteroApiBaseUrl, this.config.requestTimeoutMs)
    registerStatusCommand(ctx, this)
    registerStatusTool(ctx, this)
    registerSearchTool(ctx, this)
    registerGetTool(ctx, this)
    registerReadMdTool(ctx, this)
  }

  /** Probe directory actually in use ('' means disabled; probes never fail). */
  probeDirectory(): string {
    return this.config.probeDir === '' ? '(disabled)' : this.config.probeDir
  }

  async zoteroStatus(signal?: AbortSignal): Promise<ZoteroStatusView> {
    const info = await this.probes.trace('zotero.serverInfo', () => this.transport.serverInfo(signal))
    return {
      reachable: info.reachable,
      diagnosis: info.diagnosis,
      zoteroVersion: info.zoteroVersion,
      apiVersion: info.apiVersion,
      schemaVersion: info.schemaVersion,
      serverId: info.serverId,
      writeMode: info.writeMode,
    }
  }

  async searchItems(args: SearchArgs, signal?: AbortSignal): Promise<SearchResultView> {
    const qmode = args.qmode ?? 'titleCreatorYear'
    const limit = Math.min(Math.max(args.limit ?? 5, 1), this.config.maxSearchResults)
    const items = await this.probes.trace('tool.search', () =>
      this.transport.searchItems({ query: args.query, qmode, limit, signal }))
    const view: SearchItemView[] = items.map((item) => ({
      ref: itemRef(item),
      title: titleOf(item.data),
      creators: creatorsText(item.data),
      year: yearOf(item.data.date),
      itemType: item.data.itemType ?? 'unknown',
      attachmentType: item.data.itemType === 'attachment' ? item.data.contentType : undefined,
    }))
    return { query: args.query, qmode, total: items.length, items: view }
  }

  async getItem(args: GetArgs, signal?: AbortSignal): Promise<GetResultView> {
    const key = parseKey(args.ref)
    const item = await this.probes.trace('tool.get.item', () => this.transport.itemByKey(key, signal))
    const data = item.data
    const view: GetResultView = {
      ref: itemRef(item),
      title: titleOf(data),
      creators: creatorsText(data),
      year: yearOf(data.date),
      itemType: data.itemType ?? 'unknown',
      doi: data.DOI,
      abstract: abstractOf(data),
      keywords: keywordsOf(data),
      tags: tagsOf(data),
      numChildren: item.meta?.numChildren,
    }
    if (args.includeChildren !== false) {
      const children = await this.probes.trace('tool.get.children', () =>
        this.transport.childrenOf(key, signal))
      const notes = children.filter(child => child.data.itemType === 'note')
      const attachments = children.filter(child => child.data.itemType === 'attachment')
      if (notes.length > 0) {
        view.notes = notes.map((note) => ({
          ref: itemRef(note),
          title: note.data.title ?? '(untitled note)',
          text: note.data.note ?? '',
          truncated: (note.data.note ?? '').length > 8000,
        }))
      }
      if (attachments.length > 0) {
        view.attachments = attachments.map((attachment) => ({
          ref: itemRef(attachment),
          title: attachment.data.title ?? attachment.data.filename ?? '(attachment)',
          contentType: attachment.data.contentType,
          linkMode: attachment.data.linkMode,
          path: typeof attachment.data.path === 'string' ? attachment.data.path : undefined,
        }))
      }
    }
    return view
  }

  async readMarkdown(args: ReadMarkdownArgs, signal?: AbortSignal): Promise<PaperMarkdownView> {
    const key = parseKey(args.ref)
    const maxChars = Math.min(Math.max(args.maxChars ?? 120_000, 2_000), 1_000_000)
    const item = await this.probes.trace('pipeline.item', () => this.transport.itemByKey(key, signal))
    let parent: ZoteroItem = item
    let attachments: ZoteroItem[] = []
    if (item.data.itemType === 'attachment') {
      const parentKey = parentKeyOf(item)
      if (parentKey !== undefined) {
        parent = await this.probes.trace('pipeline.parent', () => this.transport.itemByKey(parentKey, signal))
      }
      attachments = [item]
    } else {
      attachments = await this.probes.trace('pipeline.attachments', () =>
        this.transport.childrenOf(key, signal))
    }
    const parentData = parent.data
    const result = await this.probes.trace('pipeline.pdf', () =>
      pdfAttachmentToMarkdown(
        metaOf(parentData),
        attachments,
        this.config.maxPdfBytes,
        maxChars,
        (href) => this.transport.attachmentBytes(href, this.config.maxPdfBytes, signal),
      ))
    if (result.markdown === '') {
      throw new IdeagetError('pdf-parse-failed', 'the PDF produced no readable text')
    }
    return {
      markdown: result.markdown,
      title: result.meta.title ?? titleOf(parentData),
      creators: result.meta.creators,
      year: result.meta.year,
      abstract: result.meta.abstract,
      keywords: result.meta.keywords.length > 0 ? result.meta.keywords : undefined,
      doi: result.meta.doi,
      pages: result.pages,
      chars: result.chars,
      truncated: result.truncated,
      attachmentName: result.attachmentName,
    }
  }
}

export default IdeagetService
