/**
 * IdeagetService: the stable boundary of the ideaget host half — `ctx.ideaget`.
 * Owns provider construction (transport, probe log), the read-only Zotero
 * routes (search / get / markdown pipeline), and the tool + command
 * registrations. The agent/LLM plane is a reserved port: tools are registered
 * and typed now, but nothing here calls a model. Writes are also reserved
 * (see docs/01-feasibility.md for the version-matrix analysis).
 * @module ideaget/service
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { bestPdfAttachment, pdfAttachmentToMarkdown, type PaperMeta } from './content/pipeline.js'
import { parsePdfToAcademic } from './content/academic.js'
import { Config as ConfigSchema, resolveConfig, type Config, type ResolvedConfig } from './config.js'
import { IdeagetError } from './errors.js'
import { ProbeLog } from './probes.js'
import { ZoteroTransport } from './zotero/transport.js'
import {
  abstractOf,
  creatorsNames,
  creatorsText,
  itemRef,
  keywordsOf,
  parseCollectionRef,
  parseRef,
  tagsOf,
  titleOf,
  yearOf,
  type ZoteroItem,
  type ZoteroItemData,
} from './zotero/model.js'
import { extractReferences } from './content/references.js'
import { registerStatusCommand } from './command.js'
import { registerCollectionReadTool } from './tools/collection-read.js'
import { registerCollectionsTool } from './tools/collections.js'
import { registerGetTool } from './tools/get.js'
import { registerNoteAddTool } from './tools/note-add.js'
import { registerPaperJsonTool } from './tools/paper-json.js'
import { registerReadMdTool } from './tools/read-md.js'
import { registerSearchTool } from './tools/search.js'
import { registerStatusTool } from './tools/status.js'
import type {
  CollectionPaperView,
  CollectionReadResultView,
  CollectionSummaryView,
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

export interface CollectionReadArgs {
  collectionRef: string
  includeAbstract?: boolean
  includeKeywords?: boolean
  includeFulltext?: boolean
  includeReferences?: boolean
  maxChars?: number
  limit?: number
}

export interface NoteAddArgs {
  ref: string
  text: string
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

/** Parse a collection key, mapping malformed input onto the stable error code. */
function parseCollectionKey(ref: string): string {
  try {
    return parseCollectionRef(ref)
  } catch (error) {
    throw new IdeagetError('malformed-ref', error instanceof Error ? error.message : String(error))
  }
}

/** Minimal HTML escaping for note bodies. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** One Web JSON route; structural slice of the host `webServer` service. */
interface WebRouteLike {
  kind: 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** Browser JSON routes the ideaget workbench consumes (read-only). */
const WEB_API_PATH = '/ideaget'

/** Normalize raw Zotero items into the compact paper-list view. */
function mapItems(items: ZoteroItem[]): SearchItemView[] {
  return items.map((item) => ({
    ref: itemRef(item),
    title: titleOf(item.data),
    creators: creatorsText(item.data),
    year: yearOf(item.data.date),
    itemType: item.data.itemType ?? 'unknown',
    attachmentType: item.data.itemType === 'attachment' ? item.data.contentType : undefined,
  }))
}

/** Write one JSON response. */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/**
 * Register the `/ideaget` Web JSON routes when a web server is composed.
 * Optional-inject form keeps the plugin loadable in headless compositions.
 */
function mountWebRoutes(ctx: Context, service: IdeagetService): void {
  ctx.inject(['webServer'], (webCtx) => {
    const server = (webCtx as unknown as { webServer: { register(route: WebRouteLike): () => void } }).webServer
    return server.register({
      kind: 'prefix',
      path: WEB_API_PATH,
      handler: (req, res) => void service.handleIdeagetWeb(req, res),
    })
  })
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
    registerCollectionsTool(ctx, this)
    registerCollectionReadTool(ctx, this)
    registerNoteAddTool(ctx, this)
    registerPaperJsonTool(ctx, this)
    mountWebRoutes(ctx, this)
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
    return { query: args.query, qmode, total: items.length, items: mapItems(items) }
  }

  /**
   * Paper-list JSON endpoint for the workbench left rail: latest library rows
   * with an empty query, metadata search otherwise. Attachment rows are
   * filtered out of the titles list.
   */
  async webPapers(query: string, limit: number, signal?: AbortSignal): Promise<{ items: SearchItemView[]; total: number }> {
    const bounded = Math.min(Math.max(limit, 1), 50)
    const items = await this.probes.trace('web.papers', () =>
      this.transport.searchItems({ query, qmode: query.trim() === '' ? 'titleCreatorYear' : 'everything', limit: bounded, signal }))
    const papers = items.filter(item => item.data.itemType !== 'attachment')
    return { items: mapItems(papers), total: papers.length }
  }

  /** Handle one `/ideaget` Web request (GET JSON API; read-only). */
  async handleIdeagetWeb(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
        sendJson(res, 405, { error: { code: 'method-not-allowed', message: 'ideaget Web API is read-only GET' } })
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const [segment] = url.pathname.slice(WEB_API_PATH.length).split('/').filter(Boolean)
      if (segment === 'status') {
        sendJson(res, 200, await this.zoteroStatus())
        return
      }
      if (segment === 'papers') {
        const query = (url.searchParams.get('q') ?? '').slice(0, 200)
        const limit = Number(url.searchParams.get('limit') ?? '20')
        const result = await this.webPapers(query, Number.isFinite(limit) ? limit : 20)
        sendJson(res, 200, { query, ...result })
        return
      }
      sendJson(res, 404, { error: { code: 'not-found', message: `unknown ideaget endpoint ${JSON.stringify(segment ?? '')}` } })
    } catch (error) {
      sendJson(res, 500, {
        error: {
          code: error instanceof IdeagetError ? error.code : 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
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

  /**
   * Parse one paper into an `academic-paper/v1` JSON artifact on disk
   * (rules-based, no model) and return its summary. Full JSON is meant for
   * RAG ingestion; the tool result stays small.
   */
  async produceAcademicArtifact(args: ReadMarkdownArgs & { artifactDir?: string }, signal?: AbortSignal):
    Promise<{ artifactPath: string; title: string; pages: number; chars: number; sections: string[]; references: number; tables: number; figures: number; notes: string[] }> {
    const key = parseKey(args.ref)
    const maxChars = Math.min(Math.max(args.maxChars ?? 400_000, 2_000), 2_000_000)
    const item = await this.probes.trace('academic.item', () => this.transport.itemByKey(key, signal))
    let parent = item
    let attachments: ZoteroItem[] = []
    if (item.data.itemType === 'attachment') {
      const parentKey = parentKeyOf(item)
      if (parentKey !== undefined) parent = await this.transport.itemByKey(parentKey, signal)
      attachments = [item]
    } else {
      attachments = await this.probes.trace('academic.attachments', () => this.transport.childrenOf(key, signal))
    }
    const data = parent.data
    const found = bestPdfAttachment(attachments)
    if (found === undefined) {
      throw new IdeagetError('no-text-attachment', 'this item has no stored PDF to parse')
    }
    const bytes = await this.probes.trace('academic.bytes', () =>
      this.transport.attachmentBytes(found.href, this.config.maxPdfBytes, signal))
    const result = await this.probes.trace('academic.parse', () => parsePdfToAcademic(bytes, {
      ref: itemRef(parent),
      title: data.title,
      authors: creatorsNames(data),
      year: yearOf(data.date),
      abstract: abstractOf(data),
      keywords: keywordsOf(data),
      doi: data.DOI,
      sourceFile: found.item.data.filename,
    }, { budgetChars: maxChars }))
    const dir = (args.artifactDir ?? this.config.artifactDir) === ''
      ? join(process.cwd(), '.ideaget', 'artifacts')
      : (args.artifactDir ?? this.config.artifactDir)
    mkdirSync(dir, { recursive: true })
    const artifactPath = join(dir, `${key}.academic.json`)
    writeFileSync(artifactPath, JSON.stringify(result, null, 2))
    return {
      artifactPath,
      title: result.paper.title ?? data.title ?? key,
      pages: result.body.pages,
      chars: result.stats.chars,
      sections: result.body.sections.filter(s => s.heading !== undefined).map(s => s.heading!),
      references: result.references.length,
      tables: result.stats.tables,
      figures: result.stats.figures,
      notes: result.notes,
    }
  }

  /** Every top-level collection with item counts (list view for pickers). */
  async listCollections(signal?: AbortSignal): Promise<{ collections: CollectionSummaryView[] }> {
    const rows = await this.probes.trace('collection.list', () => this.transport.listCollections(signal))
    const collections = rows
      .filter(row => typeof row.key === 'string' && row.key !== '')
      .map(row => ({
        ref: `zotero://user/0/collection/${row.key}`,
        name: row.data?.name ?? row.key,
        numItems: row.meta?.numItems,
      }))
    return { collections }
  }

  /** Read chosen fields of every paper inside one collection (bounded). */
  async readCollectionPapers(args: CollectionReadArgs, signal?: AbortSignal): Promise<CollectionReadResultView> {
    const key = parseCollectionKey(args.collectionRef)
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 20)
    const maxChars = Math.min(Math.max(args.maxChars ?? 60_000, 2_000), 400_000)
    const wantBody = args.includeFulltext === true || args.includeReferences === true
    const rows = await this.probes.trace('collection.items', () =>
      this.transport.collectionItems(key, limit, signal))
    const papers = rows.filter(row => {
      const kind = row.data?.itemType
      return kind !== 'attachment' && kind !== 'note'
    })
    const items: CollectionPaperView[] = []
    for (const [index, paper] of papers.entries()) {
      const data = paper.data
      const meta = metaOf(data)
      const view: CollectionPaperView = {
        ref: itemRef(paper),
        title: meta.title ?? titleOf(data),
        creators: meta.creators,
        year: meta.year,
        itemType: data.itemType ?? 'unknown',
        doi: meta.doi,
      }
      if (args.includeAbstract !== false && meta.abstract !== '') view.abstract = meta.abstract
      if (args.includeKeywords !== false && meta.keywords.length > 0) view.keywords = meta.keywords
      if (wantBody) {
        try {
          const children = await this.probes.trace(`collection.children.${index}`, () =>
            this.transport.childrenOf(paper.key, signal))
          const result = await this.probes.trace(`collection.paper.${index}`, () =>
            pdfAttachmentToMarkdown(meta, children, this.config.maxPdfBytes, maxChars, (href) =>
              this.transport.attachmentBytes(href, this.config.maxPdfBytes, signal)))
          if (args.includeFulltext === true) {
            view.body = result.markdown
            view.bodyTruncated = result.truncated
          }
          if (args.includeReferences === true) {
            const refs = extractReferences(result.markdown)
            if (refs.length > 0) view.references = refs
          }
        } catch (error) {
          view.error = error instanceof IdeagetError ? `${error.code}: ${error.message}` : String(error)
        }
      }
      items.push(view)
    }
    return {
      collection: { ref: `zotero://user/0/collection/${key}`, name: key },
      total: papers.length,
      offset: 0,
      items,
    }
  }

  /** Zotero 10+ local-authorize write: create a child note under one item. */
  async addNoteToItem(args: NoteAddArgs, signal?: AbortSignal): Promise<{ noteRef: string; remember: boolean }> {
    if (this.config.readOnly) {
      throw new IdeagetError('write-disabled', 'ideaget runs read-only; set config.readOnly=false to enable local writes')
    }
    const parentKey = parseKey(args.ref)
    const info = await this.probes.trace('zotero.serverInfo', () => this.transport.serverInfo(signal))
    if (!info.reachable || info.serverId === undefined) {
      throw new IdeagetError('zotero-unreachable', 'Zotero local API unreachable; cannot authorize a write')
    }
    if (info.writeMode !== 'local-write') {
      throw new IdeagetError('write-disabled', 'local item writes need Zotero 10+; the Web API channel is a reserved port')
    }
    const authorized = await this.probes.trace('zotero.authorize', () =>
      this.transport.localAuthorize('ideaget', info.serverId!, signal))
    const note = `<div>${escapeHtml(args.text)}</div>`
    const noteKey = await this.probes.trace('zotero.createNote', () =>
      this.transport.createChildNote(parentKey, note, authorized.key, info.serverId!, signal))
    return { noteRef: `zotero://user/0/item/${noteKey}`, remember: authorized.remember }
  }
}

export default IdeagetService
