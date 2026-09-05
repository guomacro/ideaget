/**
 * `ideaget-rag/rag`: hybrid retrieval index plugin (first version).
 *
 * Corpus source: `academic-paper/v1` JSON artifacts (produced by
 * `ideaget_zotero_paper_json`). Indexing scans the corpus directory and
 * persists a JSON index; retrieval is BM25 (sparse) with a pluggable dense
 * leg: when an embedding endpoint is configured (env `IDEAGET_EMBEDDING_*`
 * or plugin Config), queries can be embedded once a dense store lands — until
 * then scores stay BM25-only and the status reports it.
 *
 * No model is required for BM25; embeddings default off.
 * @module ideaget/rag/rag
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { QueryLayer, RagChunk, RagHit } from '../shared.js'

export interface RagIndexConfig {
  /** Embedding provider id: '' | 'url' (endpoint read from env/Config). */
  embeddingProvider: string
  /** Vector backend id: '' | 'faiss' | 'qdrant' (reserved). */
  vectorBackend: string
  /** OpenAI/Ollama-style embedding endpoint (env IDEAGET_EMBEDDING_URL). */
  embeddingUrl: string
  /** Embedding model name (env IDEAGET_EMBEDDING_MODEL). */
  embeddingModel: string
  /** Academic JSON artifact directory (default <cwd>/.ideaget/artifacts). */
  corpusDir: string
  /** Index persistence directory (default <cwd>/.ideaget/rag-index). */
  indexDir: string
  /** Chunk target size in characters. */
  chunkChars: number
  /** Chunk overlap in characters. */
  chunkOverlap: number
  /** Default top-K for retrieval. */
  defaultTopK: number
}

export const Config: Schema<RagIndexConfig> = Schema.object({
  embeddingProvider: Schema.string().default(''),
  vectorBackend: Schema.string().default(''),
  embeddingUrl: Schema.string().default(''),
  embeddingModel: Schema.string().default(''),
  corpusDir: Schema.string().default(''),
  indexDir: Schema.string().default(''),
  chunkChars: Schema.natural().default(2000),
  chunkOverlap: Schema.natural().default(100),
  defaultTopK: Schema.natural().default(8),
})

interface IndexedPaper { key: string; title?: string; ref?: string }

interface CorpusIndex {
  version: 1
  papers: IndexedPaper[]
  chunks: RagChunk[]
}

interface TokenStats { df: Map<string, number>; docLen: number[] }

declare module '@deepseek-ai/cordis' {
  interface Context {
    ragIndex: RagIndexService
  }
}

const K1 = 1.5
const B = 0.75

function tokensOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9\-_+]{1,}/g) ?? []).filter(token => token.length > 1)
}

function pick(env: string | undefined, configured: string | undefined, fallback: string): string {
  if (env !== undefined && env !== '') return env
  if (configured !== undefined && configured !== '') return configured
  return fallback
}

export class RagIndexService extends Service {
  static inject = ['tools']

  static Config = Config

  private readonly config: RagIndexConfig
  private index: CorpusIndex | null = null
  private stats: TokenStats | null = null

  constructor(ctx: Context, config: Partial<RagIndexConfig> = {}) {
    super(ctx, 'ragIndex')
    const env = process.env
    this.config = {
      embeddingProvider: pick(env.IDEAGET_EMBEDDING_PROVIDER, config.embeddingProvider, ''),
      embeddingUrl: pick(env.IDEAGET_EMBEDDING_URL, config.embeddingUrl, ''),
      embeddingModel: pick(env.IDEAGET_EMBEDDING_MODEL, config.embeddingModel, ''),
      vectorBackend: config.vectorBackend ?? '',
      corpusDir: pick(undefined, config.corpusDir, join(process.cwd(), '.ideaget', 'artifacts')),
      indexDir: pick(undefined, config.indexDir, join(process.cwd(), '.ideaget', 'rag-index')),
      chunkChars: config.chunkChars ?? 2000,
      chunkOverlap: config.chunkOverlap ?? 100,
      defaultTopK: config.defaultTopK ?? 8,
    }
    mkdirSync(this.config.indexDir, { recursive: true })
    registerRagTools(ctx, this)
  }

  directories(): { corpusDir: string; indexDir: string } {
    return { corpusDir: this.config.corpusDir, indexDir: this.config.indexDir }
  }

  embedding(): { provider: string; url: string; model: string } {
    return {
      provider: this.config.embeddingProvider,
      url: this.config.embeddingUrl,
      model: this.config.embeddingModel,
    }
  }

  /** Scan academic artifacts and persist a fresh index. */
  async indexCorpus(): Promise<{ papers: number; chunks: number }> {
    mkdirSync(this.config.corpusDir, { recursive: true })
    const files = readdirSync(this.config.corpusDir).filter(name => name.endsWith('.academic.json'))
    const papers: IndexedPaper[] = []
    const chunks: RagChunk[] = []
    for (const file of files) {
      let doc: { source?: { ref?: string }; paper?: { title?: string }; body?: { text?: string } }
      try {
        doc = JSON.parse(readFileSync(join(this.config.corpusDir, file), 'utf8'))
      } catch {
        continue
      }
      const text = doc.body?.text ?? ''
      if (text.trim() === '') continue
      const key = file.replace(/\.academic\.json$/, '')
      papers.push({ key, title: doc.paper?.title, ref: doc.source?.ref })
      const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p !== '')
      let n = 0
      for (const paragraph of paragraphs) {
        for (const piece of windowed(paragraph, this.config.chunkChars, this.config.chunkOverlap)) {
          chunks.push({ id: `${key}-c${n++}`, paperKey: key, text: piece })
        }
      }
    }
    this.index = { version: 1, papers, chunks }
    this.stats = computeStats(chunks)
    writeFileSync(join(this.config.indexDir, 'index.json'), JSON.stringify(this.index, null, 2))
    return { papers: papers.length, chunks: chunks.length }
  }

  private ensureIndex(): void {
    if (this.index !== null) return
    const path = join(this.config.indexDir, 'index.json')
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as CorpusIndex
      if (parsed.version === 1 && Array.isArray(parsed.chunks)) {
        this.index = parsed
        this.stats = computeStats(parsed.chunks)
        return
      }
    } catch {
      // fall through to a fresh build
    }
    void this.indexCorpus()
  }

  /** BM25 hybrid search over chunks (dense fusion lands with the store). */
  async search(query: string, layer: QueryLayer, topK: number = this.config.defaultTopK): Promise<RagHit[]> {
    void layer
    this.ensureIndex()
    if (this.index === null || this.stats === null) return []
    const terms = tokensOf(query)
    if (terms.length === 0) return []
    const chunks = this.index.chunks
    const { df, docLen } = this.stats
    const docCount = Math.max(chunks.length, 1)
    const avgdl = docLen.reduce((a, b) => a + b, 0) / docCount
    const idf = (term: string): number => {
      const n = df.get(term) ?? 0
      return Math.log(1 + (docCount - n + 0.5) / (n + 0.5))
    }
    const scored: { index: number; score: number }[] = []
    for (let i = 0; i < chunks.length; i++) {
      const doc = tokensOf(chunks[i]!.text)
      let score = 0
      for (const term of terms) {
        const tf = doc.filter(t => t === term).length
        if (tf === 0) continue
        score += idf(term) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen[i] ?? 1) / avgdl))
      }
      if (score > 0) scored.push({ index: i, score })
    }
    scored.sort((a, b) => b.score - a.score)
    const paperByKey = new Map(this.index.papers.map(p => [p.key, p]))
    return scored.slice(0, Math.max(1, Math.min(topK, 50))).map(hit => {
      const chunk = chunks[hit.index]!
      const paper = paperByKey.get(chunk.paperKey)
      return {
        chunk: { ...chunk, text: excerpt(chunk.text, 600) },
        node: undefined,
        score: Math.round(hit.score * 1000) / 1000,
        source: 'bm25' as const,
        title: paper?.title,
        ref: paper?.ref,
      }
    })
  }

  status(): { papers: number; chunks: number; indexed: boolean } {
    this.ensureIndex()
    return {
      papers: this.index?.papers.length ?? 0,
      chunks: this.index?.chunks.length ?? 0,
      indexed: this.index !== null,
    }
  }
}

export default RagIndexService

/** Split text into overlapping character windows on word boundaries. */
function windowed(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text]
  const pieces: string[] = []
  let start = 0
  const step = Math.max(1, size - overlap)
  while (start < text.length) {
    let end = Math.min(text.length, start + size)
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end)
      if (space > start + size * 0.6) end = space
    }
    pieces.push(text.slice(start, end).trim())
    if (end >= text.length) break
    start = end - overlap
  }
  return pieces.filter(p => p.length > 40)
}

function computeStats(chunks: RagChunk[]): TokenStats {
  const df = new Map<string, number>()
  const docLen = chunks.map(chunk => {
    const terms = tokensOf(chunk.text)
    for (const seen of new Set(terms)) df.set(seen, (df.get(seen) ?? 0) + 1)
    return terms.length
  })
  return { df, docLen }
}

function excerpt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/** Model-facing tools of the retrieval index. */
import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'

function registerRagTools(ctx: Context, service: RagIndexService): void {
  const tools = (ctx as unknown as { tools?: { register(definition: object): unknown } }).tools
  if (tools === undefined) return

  const STATUS_OUTPUT = {
    type: 'object',
    additionalProperties: false,
    properties: {
      papers: { type: 'integer', required: true },
      chunks: { type: 'integer', required: true },
      indexed: { type: 'boolean', required: true },
      corpusDir: { type: 'string', required: true },
      indexDir: { type: 'string', required: true },
      embeddingProvider: { type: 'string', required: true },
    },
  } as const
  type StatusOutput = InferValue<typeof STATUS_OUTPUT>

  tools.register(defineTool({
    name: 'ideaget_rag_status',
    description: 'Report the paper-RAG index state: indexed papers/chunks, directories, embedding configuration.',
    parameters: {} as const,
    output: {
      schema: STATUS_OUTPUT,
      render: (_args: never, value: StatusOutput) => [{
        type: 'text',
        text: `RAG index: ${value.papers} papers, ${value.chunks} chunks\ncorpus: ${value.corpusDir}\nindex: ${value.indexDir}\nembedding: ${value.embeddingProvider === '' ? 'BM25 only' : value.embeddingProvider}`,
      }],
    },
    async execute(): Promise<StatusOutput> {
      const status = service.status()
      const dirs = service.directories()
      const embedding = service.embedding()
      return { ...status, ...dirs, embeddingProvider: embedding.provider }
    },
  }))

  const SEARCH_PARAMETERS = {
    query: { type: 'string', required: true, description: 'Natural-language or keyword query.' },
    layer: { type: 'string', enum: ['fact', 'concept', 'relation', 'survey', 'trend'], default: 'fact' },
    topK: { type: 'integer', default: 8 },
  } as const
  type SearchArgs = InferArgs<typeof SEARCH_PARAMETERS>
  const HIT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      paperKey: { type: 'string', required: true },
      title: { type: 'string' },
      ref: { type: 'string' },
      score: { type: 'number', required: true },
      excerpt: { type: 'string', required: true },
    },
  } as const
  const SEARCH_OUTPUT = {
    type: 'object',
    additionalProperties: false,
    properties: {
      indexed: { type: 'boolean', required: true },
      query: { type: 'string', required: true },
      hits: { type: 'array', required: true, items: HIT_SCHEMA },
    },
  } as const
  type SearchOutput = InferValue<typeof SEARCH_OUTPUT>

  tools.register(defineTool({
    name: 'ideaget_rag_search',
    description: 'Hybrid (BM25) search over the indexed academic papers. Returns ranked chunks with their paper, score, and a text excerpt. Use before answering questions about the paper corpus.',
    parameters: SEARCH_PARAMETERS,
    output: {
      schema: SEARCH_OUTPUT,
      render: (_args: SearchArgs, value: SearchOutput) => [{
        type: 'text',
        text: value.hits.length === 0
          ? `No hits for "${value.query}".`
          : value.hits.map((hit, i) => `[${i + 1}] (${hit.score}) ${hit.title ?? hit.paperKey}\n   ${hit.excerpt}`).join('\n'),
      }],
    },
    async execute(args: SearchArgs): Promise<SearchOutput> {
      const hits = await service.search(args.query, (args.layer ?? 'fact') as QueryLayer, args.topK ?? 8)
      return {
        indexed: service.status().indexed,
        query: args.query,
        hits: hits.map(hit => ({
          paperKey: hit.chunk?.paperKey ?? '',
          title: (hit as RagHit & { title?: string }).title,
          ref: (hit as RagHit & { ref?: string }).ref,
          score: hit.score,
          excerpt: hit.chunk?.text ?? '',
        })),
      }
    },
  }))
}
