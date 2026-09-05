/**
 * `ideaget-rag/router`: agentic router plugin (first version).
 *
 * classify() maps a user question onto a query layer with keyword rules;
 * ask() runs the classified layer through the retrieval index and returns
 * ranked evidence chunks for the agent to synthesize. Answer generation stays
 * with the agent; the router owns retrieval routing only.
 * @module ideaget/rag/router
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { QueryLayer, RagHit } from '../shared.js'

export interface RouterConfig {
  /** Fusion weights (reserved for the dense leg; BM25-only today). */
  alpha: number
  beta: number
  gamma: number
  /** Evidence top-K for ask(). */
  topK: number
}

export const Config: Schema<RouterConfig> = Schema.object({
  alpha: Schema.number().default(0.4),
  beta: Schema.number().default(0.3),
  gamma: Schema.number().default(0.3),
  topK: Schema.natural().default(8),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    ragRouter: RouterService
  }
}

const LAYER_RULES: { layer: QueryLayer; pattern: RegExp }[] = [
  { layer: 'trend', pattern: /(趋势|hotspot|新兴|rising|兴起|evolv|近年|research hotspot|发展历程)/i },
  { layer: 'survey', pattern: /(综述|survey|overview|review|进展|state.?of.?the.?art|方向概览|总结.*方向)/i },
  { layer: 'relation', pattern: /(引用|cite|citation|哪些论文|dataset|数据集|evaluat|评估|比较|compared|引用了|被引|扩展|based on|提出.*方法)/i },
  { layer: 'concept', pattern: /(什么是|what is|概念|原理|mechanism|如何工作|how does|自注意力|attention|定义|比较.*方法|区别)/i },
]

function classify(question: string): QueryLayer {
  for (const rule of LAYER_RULES) {
    if (rule.pattern.test(question)) return rule.layer
  }
  if (/(哪一年|when|多少|how many|参数量|提出于)/i.test(question)) return 'fact'
  return 'fact'
}

export class RouterService extends Service {
  static inject = ['ragIndex', 'tools']

  static Config = Config

  private readonly config: RouterConfig
  private readonly ctxRef: Context

  constructor(ctx: Context, config: Partial<RouterConfig> = {}) {
    super(ctx, 'ragRouter')
    this.ctxRef = ctx
    this.config = {
      alpha: config.alpha ?? 0.4,
      beta: config.beta ?? 0.3,
      gamma: config.gamma ?? 0.3,
      topK: config.topK ?? 8,
    }
    registerRouterTools(ctx, this)
  }

  classify(question: string): Promise<QueryLayer> {
    return Promise.resolve(classify(question))
  }

  /** Route a question to its layer and retrieve evidence from the index. */
  async ask(question: string): Promise<{ layer: QueryLayer; hits: RagHit[] }> {
    const layer = classify(question)
    const rag = (this.ctxRef as unknown as { ragIndex: { search(q: string, l: QueryLayer, k: number): Promise<RagHit[]> } }).ragIndex
    const hits = await rag.search(question, layer, this.config.topK)
    return { layer, hits }
  }
}

export default RouterService

import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'

function registerRouterTools(ctx: Context, service: RouterService): void {
  const tools = (ctx as unknown as { tools?: { register(definition: object): unknown } }).tools
  if (tools === undefined) return

  const ASK_PARAMETERS = {
    question: { type: 'string', required: true, description: 'The research question.' },
    topK: { type: 'integer', default: 8 },
  } as const
  type AskArgs = InferArgs<typeof ASK_PARAMETERS>
  const HIT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
      paperKey: { type: 'string', required: true },
      title: { type: 'string' },
      score: { type: 'number', required: true },
      excerpt: { type: 'string', required: true },
    },
  } as const
  const ASK_OUTPUT = {
    type: 'object',
    additionalProperties: false,
    properties: {
      layer: { type: 'string', required: true },
      question: { type: 'string', required: true },
      hits: { type: 'array', required: true, items: HIT_SCHEMA },
    },
  } as const
  type AskOutput = InferValue<typeof ASK_OUTPUT>

  tools.register(defineTool({
    name: 'ideaget_paper_ask',
    description: 'Answer questions over the paper corpus: route the question to a query layer (fact/concept/relation/survey/trend), retrieve ranked evidence chunks, and return them for answer synthesis.',
    parameters: ASK_PARAMETERS,
    output: {
      schema: ASK_OUTPUT,
      render: (_args: AskArgs, value: AskOutput) => [{
        type: 'text',
        text: [
          `layer=${value.layer} · hits=${value.hits.length}`,
          ...value.hits.map((hit, i) => `[${i + 1}] (${hit.score}) ${hit.title ?? hit.paperKey}\n   ${hit.excerpt}`),
        ].join('\n'),
      }],
    },
    async execute(args: AskArgs): Promise<AskOutput> {
      const layer = await service.classify(args.question)
      const rag = (ctx as unknown as { ragIndex: { search(q: string, l: QueryLayer, k: number): Promise<RagHit[]> } }).ragIndex
      const hits = await rag.search(args.question, layer, args.topK ?? 8)
      return {
        layer,
        question: args.question,
        hits: hits.map(hit => ({
          paperKey: hit.chunk?.paperKey ?? '',
          title: (hit as RagHit & { title?: string }).title,
          score: hit.score,
          excerpt: hit.chunk?.text ?? '',
        })),
      }
    },
  }))
}
