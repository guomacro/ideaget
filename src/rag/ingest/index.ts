/**
 * `ideaget-rag/ingest`: paper ingestion plugin (skeleton). Later it turns
 * academic JSON artifacts into chunks + embeddings and writes graph edges;
 * today it only defines the service boundary and Config shell.
 * @module ideaget/rag/ingest
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { notImplemented, type RagChunk } from '../shared.js'

export const Config: Schema<IngestConfig> = Schema.object({
  chunkDir: Schema.string().default(''),
  chunkChars: Schema.natural().default(2000),
})

export interface IngestConfig {
  /** Where chunk artifacts are written (empty = framework default). */
  chunkDir: string
  /** Chunk size in characters (windowing refined later). */
  chunkChars: number
}


declare module '@deepseek-ai/cordis' {
  interface Context {
    ragIngest: IngestService
  }
}

export class IngestService extends Service {
  static inject: string[] = []

  static Config = Config

  constructor(ctx: Context, config: Partial<IngestConfig> = {}) {
    super(ctx, 'ragIngest')
    void config
  }

  /** Split one academic document into chunks (skeleton). */
  async chunk(paperKey: string, text: string): Promise<RagChunk[]> {
    return notImplemented('ingest', 'chunk')
  }

  /** Ingest one paper end to end (skeleton). */
  async ingest(paperKey: string): Promise<void> {
    return notImplemented('ingest', 'ingest')
  }
}

export default IngestService
