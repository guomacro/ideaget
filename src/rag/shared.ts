/**
 * Shared contracts of the paper-RAG plugin framework (skeleton stage).
 * Method sets and payloads will be refined after the framework lands; keep
 * this file as the single cross-plugin vocabulary so services can evolve
 * without touching each other's signatures.
 * @module ideaget/rag/shared
 */

/** One text chunk with provenance back into the academic JSON artifact. */
export interface RagChunk {
  id: string
  paperKey: string
  section?: string
  page?: number
  text: string
}

/** A node in the paper graph (papers/authors/institutions/concepts/…). */
export interface GraphNode {
  id: string
  kind: string
  label: string
  props: Record<string, unknown>
}

/** A typed edge between two graph nodes. */
export interface GraphEdge {
  from: string
  to: string
  kind: string
  props?: Record<string, unknown>
}

/** One hybrid-retrieval hit with its fusion score. */
export interface RagHit {
  chunk?: RagChunk
  node?: GraphNode
  score: number
  source: 'vector' | 'bm25' | 'graph' | 'fused'
}

/** Query layers of the router (fact/concept/relation/survey/trend). */
export type QueryLayer = 'fact' | 'concept' | 'relation' | 'survey' | 'trend'

/** Scaffold guard: framework methods not implemented yet fail loud, never silent. */
export function notImplemented(area: string, method: string): never {
  throw new Error(`ideaget rag: ${area}.${method} is a scaffold (parameters land in a later iteration)`)
}
