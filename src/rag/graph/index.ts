/**
 * `ideaget-rag/graph`: paper knowledge-graph plugin (skeleton). Later it owns
 * node/edge model + a pluggable backend (Neo4j Cypher or lightweight JSON
 * graph); today it defines the traversal surface only.
 * @module ideaget/rag/graph
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { notImplemented, type GraphEdge, type GraphNode } from '../shared.js'

export const Config: Schema<GraphConfig> = Schema.object({
  backend: Schema.union(['json','neo4j']).default('json'),
})

export interface GraphConfig {
  /** Backend kind: 'json' | 'neo4j' (endpoint settings refined later). */
  backend: 'json' | 'neo4j'
}


declare module '@deepseek-ai/cordis' {
  interface Context {
    paperGraph: GraphService
  }
}

export class GraphService extends Service {
  static inject: string[] = []

  static Config = Config

  constructor(ctx: Context, config: Partial<GraphConfig> = {}) {
    super(ctx, 'paperGraph')
    void config
  }

  async upsertNode(node: GraphNode): Promise<void> {
    return notImplemented('graph', 'upsertNode')
  }

  async upsertEdge(edge: GraphEdge): Promise<void> {
    return notImplemented('graph', 'upsertEdge')
  }

  /** 1..n-hop traversal from one seed node (skeleton). */
  async traverse(seed: string, kind: string | undefined, hops: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    return notImplemented('graph', 'traverse')
  }
}

export default GraphService
