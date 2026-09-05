/**
 * `ideaget-rag/ingest`: paper ingestion plugin (first version). Locates the
 * academic JSON artifact of a paper and hands it to the retrieval index for
 * chunking/indexing when the rag plugin is composed; records an ingest log.
 * Full pipeline (embeddings, graph edges) arrives with the rag/graph hooks.
 * @module ideaget/rag/ingest
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export interface IngestConfig {
  /** Academic JSON artifact directory (default <cwd>/.ideaget/artifacts). */
  corpusDir: string
  /** Ingest log directory (default <cwd>/.ideaget/ingest). */
  outDir: string
}

export const Config: Schema<IngestConfig> = Schema.object({
  corpusDir: Schema.string().default(''),
  outDir: Schema.string().default(''),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    ragIngest: IngestService
  }
}

export class IngestService extends Service {
  static inject: string[] = []

  static Config = Config

  private readonly corpusDir: string
  private readonly outDir: string

  constructor(ctx: Context, config: Partial<IngestConfig> = {}) {
    super(ctx, 'ragIngest')
    const corpusDir = config.corpusDir ?? ''
    const outDir = config.outDir ?? ''
    this.corpusDir = corpusDir === '' ? join(process.cwd(), '.ideaget', 'artifacts') : corpusDir
    this.outDir = outDir === '' ? join(process.cwd(), '.ideaget', 'ingest') : outDir
    mkdirSync(this.outDir, { recursive: true })
  }

  /** Ingest one paper by artifact key: locate the JSON, trigger rag indexing
   *  when the retrieval plugin is composed, and record the log row. */
  async ingest(paperKey: string): Promise<{ paperKey: string; artifactFound: boolean; ragIndexed?: { papers: number; chunks: number }; logPath: string }> {
    const artifactPath = join(this.corpusDir, `${paperKey}.academic.json`)
    const artifactFound = existsSync(artifactPath)
    let ragIndexed: { papers: number; chunks: number } | undefined
    if (artifactFound) {
      // Structural read; empty artifact bodies are skipped by the index.
      void JSON.parse(readFileSync(artifactPath, 'utf8'))
      const rag = (this.ctx as unknown as { get(name: string): unknown }).get('ragIndex') as
        | { indexCorpus(): Promise<{ papers: number; chunks: number }> }
        | undefined
      if (rag !== undefined) ragIndexed = await rag.indexCorpus()
    }
    const logPath = join(this.outDir, 'ingest.json')
    let rows: unknown[] = []
    if (existsSync(logPath)) {
      try { rows = JSON.parse(readFileSync(logPath, 'utf8')) as unknown[] } catch { rows = [] }
    }
    rows.push({ paperKey, at: new Date().toISOString(), artifactFound, ragIndexed })
    writeFileSync(logPath, JSON.stringify(rows, null, 2))
    return { paperKey, artifactFound, ragIndexed, logPath }
  }
}

export default IngestService
