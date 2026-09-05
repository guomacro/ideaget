/**
 * `ideaget-rag/router`: agentic router plugin (skeleton). Later it classifies
 * the user question into a query layer, routes to graph/vector/graph hybrid,
 * fuses evidence and lets the agent compose the answer. Today it exposes the
 * routing surface only.
 * @module ideaget/rag/router
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { notImplemented, type QueryLayer } from '../shared.js'

export const Config: Schema<RouterConfig> = Schema.object({
  alpha: Schema.number().default(0.4),
  beta: Schema.number().default(0.3),
  gamma: Schema.number().default(0.3),
})

export interface RouterConfig {
  /** Fusion weights alpha/beta/gamma (refined later). */
  alpha: number
  beta: number
  gamma: number
}


declare module '@deepseek-ai/cordis' {
  interface Context {
    ragRouter: RouterService
  }
}

export class RouterService extends Service {
  static inject: string[] = []

  static Config = Config

  constructor(ctx: Context, config: Partial<RouterConfig> = {}) {
    super(ctx, 'ragRouter')
    void config
  }

  async classify(question: string): Promise<QueryLayer> {
    return notImplemented('router', 'classify')
  }

  async ask(question: string): Promise<{ layer: QueryLayer; hits: unknown[]; answer?: string }> {
    return notImplemented('router', 'ask')
  }
}

export default RouterService
