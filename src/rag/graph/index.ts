/**
 * `ideaget-rag/graph`: paper knowledge-graph plugin (first version, JSON
 * backend). Nodes/edges persist to a JSON file; `traverse` runs bounded BFS
 * over typed edges. A Neo4j backend can replace the store later behind the
 * same surface.
 * @module ideaget/rag/graph
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { GraphEdge, GraphNode } from '../shared.js'

export interface GraphConfig {
  /** Backend kind: 'json' (default) | 'neo4j' (reserved). */
  backend: 'json' | 'neo4j'
  /** JSON graph directory (default <cwd>/.ideaget/paper-graph). */
  graphDir: string
}

export const Config: Schema<GraphConfig> = Schema.object({
  backend: Schema.union(['json', 'neo4j']).default('json'),
  graphDir: Schema.string().default(''),
})

interface JsonGraph { nodes: Record<string, GraphNode>; edges: GraphEdge[] }

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperGraph: GraphService
  }
}

export class GraphService extends Service {
  static inject: string[] = []

  static Config = Config

  private readonly file: string
  private graph: JsonGraph = { nodes: {}, edges: [] }

  constructor(ctx: Context, config: Partial<GraphConfig> = {}) {
    super(ctx, 'paperGraph')
    const graphDir = config.graphDir ?? ''
    const dir = graphDir === '' ? join(process.cwd(), '.ideaget', 'paper-graph') : graphDir
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'graph.json')
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as JsonGraph
        if (parsed.nodes !== undefined && parsed.edges !== undefined) this.graph = parsed
      } catch {
        // corrupt store: start empty (fail-loud would be better; noted)
      }
    }
    void config.backend
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.graph, null, 2))
  }

  async upsertNode(node: GraphNode): Promise<void> {
    this.graph.nodes[node.id] = node
    this.persist()
  }

  async upsertEdge(edge: GraphEdge): Promise<void> {
    const index = this.graph.edges.findIndex(e => e.from === edge.from && e.to === edge.to && e.kind === edge.kind)
    if (index === -1) this.graph.edges.push(edge)
    else this.graph.edges[index] = edge
    this.persist()
  }

  /** Bounded BFS from one seed node along optional edge kinds. */
  async traverse(seed: string, kind: string | undefined, hops: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const maxHops = Math.max(0, Math.min(hops, 5))
    const visitedNodes = new Set<string>([seed])
    const visitedEdges = new Set<string>()
    const frontier = [seed]
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    if (this.graph.nodes[seed] !== undefined) nodes.push(this.graph.nodes[seed]!)
    for (let hop = 0; hop < maxHops; hop++) {
      const next: string[] = []
      for (const current of frontier) {
        for (const edge of this.graph.edges) {
          const matches = edge.from === current && (kind === undefined || edge.kind === kind)
          if (!matches) continue
          const edgeId = `${edge.from}|${edge.kind}|${edge.to}`
          if (visitedEdges.has(edgeId)) continue
          visitedEdges.add(edgeId)
          edges.push(edge)
          if (!visitedNodes.has(edge.to)) {
            visitedNodes.add(edge.to)
            const node = this.graph.nodes[edge.to]
            if (node !== undefined) nodes.push(node)
            next.push(edge.to)
          }
        }
      }
      if (next.length === 0) break
      frontier.length = 0
      frontier.push(...next)
    }
    return { nodes, edges }
  }
}

export default GraphService
