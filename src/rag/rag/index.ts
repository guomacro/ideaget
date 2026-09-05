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
import { createEmbeddingProvider, readiness, type EmbeddingProvider } from '../embedding/index.js'

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
  /** Chunks per embedding request. */
  embedBatch: number
  /** Per embedding request timeout (ms). */
  embedTimeoutMs: number
  /** Dense (cosine) weight in fusion when vectors exist. */
  denseWeight: number
  /** Sparse (BM25) weight in fusion when vectors exist. */
  sparseWeight: number
  /** Gemini model id (env IDEAGET_GEMINI_MODEL; default gemini-embedding-001). */
  geminiModel: string
  /** Gemini API key (env GEMINI_API_KEY or GOOGLE_API_KEY). */
  geminiApiKey: string
  /** Gemini API base (env IDEAGET_GEMINI_BASE_URL). */
  geminiBaseUrl: string
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
  embedBatch: Schema.natural().default(16),
  embedTimeoutMs: Schema.natural().default(120000),
  denseWeight: Schema.number().default(0.6),
  sparseWeight: Schema.number().default(0.4),
  geminiModel: Schema.string().default('gemini-embedding-001'),
  geminiApiKey: Schema.string().default(''),
  geminiBaseUrl: Schema.string().default('https://generativelanguage.googleapis.com/v1beta'),
})

interface IndexedPaper { key: string; title?: string; ref?: string }

interface CorpusIndex {
  version: 1
  papers: IndexedPaper[]
  chunks: RagChunk[]
  /** Dense vectors aligned to chunks; present when an endpoint is configured. */
  vectors?: number[][]
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
  private readonly embedder: EmbeddingProvider | null
  private index: CorpusIndex | null = null
  private stats: TokenStats | null = null
  private lastDenseError: string | undefined

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
      embedBatch: config.embedBatch ?? 16,
      embedTimeoutMs: config.embedTimeoutMs ?? 120000,
      denseWeight: config.denseWeight ?? 0.6,
      sparseWeight: config.sparseWeight ?? 0.4,
      geminiModel: pick(env.IDEAGET_GEMINI_MODEL, config.geminiModel, 'gemini-embedding-001'),
      geminiApiKey: pick(env.GEMINI_API_KEY, pick(env.GOOGLE_API_KEY, config.geminiApiKey, ''), ''),
      geminiBaseUrl: pick(env.IDEAGET_GEMINI_BASE_URL, config.geminiBaseUrl, 'https://generativelanguage.googleapis.com/v1beta'),
    }
    this.embedder = createEmbeddingProvider({
      provider: this.config.embeddingProvider as '' | 'url' | 'gemini',
      url: this.config.embeddingUrl,
      model: this.config.embeddingProvider === 'gemini' ? this.config.geminiModel : this.config.embeddingModel,
      batch: this.config.embedBatch,
      timeoutMs: this.config.embedTimeoutMs,
      apiKey: this.config.geminiApiKey,
      geminiBaseUrl: this.config.geminiBaseUrl,
    })
    if (this.config.embeddingProvider !== '' && this.embedder === null) {
      this.lastDenseError = readiness({
        provider: this.config.embeddingProvider as '' | 'url' | 'gemini',
        url: this.config.embeddingUrl,
        model: this.config.embeddingModel,
        batch: this.config.embedBatch,
        timeoutMs: this.config.embedTimeoutMs,
        apiKey: this.config.geminiApiKey,
        geminiBaseUrl: this.config.geminiBaseUrl,
      }) ?? 'embedding provider unavailable'
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
      url: this.config.embeddingProvider === 'gemini' ? this.config.geminiBaseUrl : this.config.embeddingUrl,
      model: this.config.embeddingProvider === 'gemini' ? this.config.geminiModel : this.config.embeddingModel,
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
    const index: CorpusIndex = { version: 1, papers, chunks }
    if (this.denseOn()) {
      try {
        index.vectors = await this.embedTexts(chunks.map(c => c.text))
      } catch (error) {
        index.vectors = undefined
        this.lastDenseError = error instanceof Error ? error.message : String(error)
      }
    }
    this.index = index
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

  /** Hybrid search: BM25 always; cosine fusion when dense vectors exist. */
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
    const sparse: { index: number; score: number }[] = []
    for (let i = 0; i < chunks.length; i++) {
      const doc = tokensOf(chunks[i]!.text)
      let score = 0
      for (const term of terms) {
        const tf = doc.filter(t => t === term).length
        if (tf === 0) continue
        score += idf(term) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen[i] ?? 1) / avgdl))
      }
      if (score > 0) sparse.push({ index: i, score })
    }
    const paperByKey = new Map(this.index.papers.map(p => [p.key, p]))

    const dense = this.index.vectors
    let denseError: string | undefined
    let queryVector: number[] | undefined
    if (this.denseOn() && dense !== undefined && dense.length === chunks.length) {
      try {
        queryVector = (await this.embedTexts([query]))[0]
      } catch (error) {
        denseError = error instanceof Error ? error.message : String(error)
      }
    } else if (this.denseOn() && dense === undefined) {
      denseError = 'vectors missing - run indexCorpus with the embedding endpoint configured'
    }
    const maxSparse = sparse.length > 0 ? Math.max(...sparse.map(s => s.score)) : 0
    const scored = sparse.map(s => ({ index: s.index, score: s.score }))
    if (queryVector !== undefined && dense !== undefined) {
      for (const s of scored) {
        const cos = cosine(queryVector!, dense[s.index]!)
        const cosN = (cos + 1) / 2
        const bm25N = maxSparse > 0 ? s.score / maxSparse : 0
        s.score = this.config.denseWeight * cosN + this.config.sparseWeight * bm25N
      }
      scored.sort((a, b) => b.score - a.score)
    } else {
      scored.sort((a, b) => b.score - a.score)
    }
    const source = queryVector !== undefined ? 'fused' : 'bm25'
    const hits = scored.slice(0, Math.max(1, Math.min(topK, 50))).map(hit => {
      const chunk = chunks[hit.index]!
      const paper = paperByKey.get(chunk.paperKey)
      return {
        chunk: { ...chunk, text: excerpt(chunk.text, 600) },
        node: undefined,
        score: Math.round(hit.score * 1000) / 1000,
        source: source as 'fused' | 'bm25',
        title: paper?.title,
        ref: paper?.ref,
      }
    })
    this.lastDenseError = denseError
    return hits
  }

  /** Reason the dense leg is (or is not) active; read after search(). */
  denseDiagnosis(): { provider: string; on: boolean; error?: string; vectors: boolean } {
    return {
      provider: this.config.embeddingProvider,
      on: this.denseOn(),
      error: this.lastDenseError,
      vectors: (this.index?.vectors?.length ?? 0) > 0,
    }
  }

  status(): { papers: number; chunks: number; indexed: boolean } {
    this.ensureIndex()
    return {
      papers: this.index?.papers.length ?? 0,
      chunks: this.index?.chunks.length ?? 0,
      indexed: this.index !== null,
    }
  }


  private denseOn(): boolean {
    return this.embedder !== null
  }

  /** Embed texts through the active provider (contract-identical across
   *  backends so downstream fusion results stay consistent). */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (this.embedder === null) throw new Error('embedding provider is not configured')
    return this.embedder.embedTexts(texts)
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

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
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
