/**
 * `ideaget-rag/rag`: hybrid retrieval index plugin (skeleton). Later it owns
 * multi-granularity vectors + BM25 + fusion/rerank and the five query layers;
 * today it defines the search surface only.
 * @module ideaget/rag/rag
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { notImplemented, type QueryLayer, type RagHit } from '../shared.js'

export const Config: Schema<RagIndexConfig> = Schema.object({
  embeddingProvider: Schema.string().default(''),
  vectorBackend: Schema.string().default(''),
})

export interface RagIndexConfig {
  /** Embedding provider id ('' = none yet, BM25 only). */
  embeddingProvider: string
  /** Vector backend kind ('' | 'faiss' | 'qdrant'). */
  vectorBackend: string
}


declare module '@deepseek-ai/cordis' {
  interface Context {
    ragIndex: RagIndexService
  }
}

export class RagIndexService extends Service {
  static inject: string[] = []

  static Config = Config

  constructor(ctx: Context, config: Partial<RagIndexConfig> = {}) {
    super(ctx, 'ragIndex')
    void config
  }

  async indexChunks(chunks: unknown[]): Promise<void> {
    return notImplemented('rag', 'indexChunks')
  }

  /** Hybrid search for one layer (skeleton). */
  async search(query: string, layer: QueryLayer, topK: number): Promise<RagHit[]> {
    return notImplemented('rag', 'search')
  }
}

export default RagIndexService
