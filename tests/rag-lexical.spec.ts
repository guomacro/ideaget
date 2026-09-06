import { describe, expect, it } from 'vitest'
import { EnhancedLexicalStore, DEFAULT_SYNONYMS } from '../src/rag/lexical/index.ts'

const chunks = [
  { text: 'We study large language models for scheduling robot tasks.' },
  { text: 'This paper fuses noisy estimates from several sensors to reduce error.' },
  { text: 'Baking bread with yeast is a pleasant weekend activity.' },
  { text: 'A fusion center combines the signals from each station.' },
]

function enhanced(): EnhancedLexicalStore {
  const store = new EnhancedLexicalStore()
  store.build(chunks)
  return store
}

function plain(): EnhancedLexicalStore {
  // Empty synonym table + no plural folding == legacy plain BM25 semantics.
  const store = new EnhancedLexicalStore({ synonyms: [], pluralFold: false })
  store.build(chunks)
  return store
}

describe('EnhancedLexicalStore (no-embedding retrieval engine)', () => {
  it('tokenizes with two-sided canonical folding: phrases, synonyms, plurals', () => {
    const store = new EnhancedLexicalStore()
    expect(store.tokenize('LLM-based planning for LLMs')).toContain('llm') // hyphen head folds
    expect(store.tokenize('LLM-based planning for LLMs')).toContain('plan') // planning -> plan
    expect(store.tokenize('large language models')).toEqual(['llm']) // multi-word key -> one token
    expect(store.tokenize('world models and tasks')).toContain('model') // -s plural
    expect(store.tokenize('robotic manipulation')).toEqual(['robot', 'manipulate'])
    expect(new EnhancedLexicalStore({ synonyms: [], pluralFold: false }).tokenize('robotic')).toEqual(['robotic'])
  })

  it('recalls synonyms a plain lexical matcher cannot connect (LLM <-> large language models)', () => {
    const q = 'LLM planning' // no stop words; plain tokenizes to llm/planning
    const e = enhanced().search(q)
    const p = plain().search(q)
    expect(e.length).toBeGreaterThan(0)
    expect(e[0]!.index).toBe(0) // chunk A (large language models) is top
    expect(p.some(h => h.index === 0)).toBe(false) // plain has no 'llm'/'planning' in A
  })

  it('recalls fuses/estimates/sensors for a query using fusion/estimation', () => {
    const q = 'fusion estimation'
    const e = enhanced().search(q)
    const p = plain().search(q)
    expect(e[0]!.index).toBe(1) // chunk B (fuses/estimates) beats D (fusion only)
    expect(p.some(h => h.index === 1)).toBe(false) // plain matches raw 'fusion' in D, never B
  })

  it('multi-word keys do not over-match inside longer phrases', () => {
    const store = enhanced()
    // 'large language models' must not be stolen by the shorter 'language model'
    // key boundary rules: query with just 'language models' still folds to llm.
    expect(store.tokenize('language models')).toEqual(['llm'])
    expect(store.tokenize('large language models of planning')).toEqual(['llm', 'of', 'plan'])
  })

  it('never expands dictionary-external terms (no false positives)', () => {
    const e = enhanced().search('quantum entanglement teleportation')
    expect(e).toEqual([]) // none of these words exist in the corpus
  })

  it('plural folding is length-guarded: news/gas/uses stay untouched', () => {
    const store = new EnhancedLexicalStore()
    expect(store.tokenize('the news uses gas and taxis')).toEqual(['the', 'news', 'uses', 'gas', 'and', 'taxi'])
    // taxi(s) -> taxi is folded; news (4) / gas (3) / uses (stem 'us' < 4) are kept.
  })

  it('returns descending scores and degrades gracefully on empty corpora', () => {
    const store = enhanced()
    const hits = store.search('robot')
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.score).toBeLessThanOrEqual(hits[i - 1]!.score)
    const empty = new EnhancedLexicalStore()
    empty.build([])
    expect(empty.search('anything')).toEqual([])
    expect(empty.tokenize('')).toEqual([])
  })

  it('reports the built-in synonym group count', () => {
    expect(enhanced().groupCount()).toBe(DEFAULT_SYNONYMS.length)
    expect(plain().groupCount()).toBe(0)
  })

  it('plain mode reproduces legacy BM25 scores for untouched vocabulary', () => {
    // For a corpus with no synonym/plural forms, enhanced (default tables)
    // and plain must rank identically: folding only changes df/docLen when a
    // table entry actually fires.
    const clean = [
      { text: 'graph traversal over knowledge node and edge types' },
      { text: 'diffusion model generate image from prompt text' },
      { text: 'kernel method map input into feature space' },
    ]
    const storeA = new EnhancedLexicalStore()
    storeA.build(clean)
    const storeB = new EnhancedLexicalStore({ synonyms: [], pluralFold: false })
    storeB.build(clean)
    for (const query of ['graph node edge', 'image model', 'kernel feature']) {
      expect(storeA.search(query).map(h => h.index)).toEqual(storeB.search(query).map(h => h.index))
    }
  })
})
