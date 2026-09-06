/**
 * Enhanced lexical retrieval for the no-embedding RAG path.
 *
 * The dense (vector) leg of `rag/rag` requires an embedding provider; without
 * one the retrieval engine is purely lexical. `EnhancedLexicalStore` is that
 * engine: it lifts the formerly inline Okapi BM25 (K1=1.5, B=0.75) into a
 * standalone store and adds synonym-aware matching:
 *
 * - **Two-sided canonical folding**: document and query tokens pass through
 *   the same synonym/plural tables, so BM25 scores in *canonical* space. Pairs
 *   a pure lexical matcher cannot connect — `LLM` ↔ `large language model`,
 *   `fusion` ↔ `fuse`, `plan` ↔ `planning` — recall each other, without an
 *   OR-expansion layer (folding already aligns both sides).
 * - **Multi-word keys** (e.g. `large language model`) are phrase-matched
 *   before tokenization so they fold into one canonical token.
 * - **Conservative plural folding** (`-ies`/`-es`/`-s`, length-guarded) covers
 *   the common `models`/`tasks`/`methods` cases without touching ambiguous
 *   short words (`news`, `gas`, `is`).
 *
 * With an empty synonym table and plural folding off the store degenerates to
 * the exact legacy BM25 behaviour (unit-tested), so switching the engine on
 * by default changes nothing for corpora that need no synonym support.
 * @module ideaget/rag/lexical
 */

/** One synonym group: every `key` folds to `canonical` (single lowercase token).
 *  Keys may contain spaces (phrase-matched before tokenization). */
export interface LexicalSynonymGroup {
  canonical: string
  keys: string[]
}

export interface LexicalStoreOptions {
  /** Synonym groups; defaults to the built-in academic set. Pass [] for plain BM25. */
  synonyms?: LexicalSynonymGroup[]
  /** Conservative plural folding (default true). */
  pluralFold?: boolean
}

/** Built-in academic/CS synonym set (small and conservative on purpose: each
 *  group only merges spellings that are near-unambiguous inside a paper corpus). */
export const DEFAULT_SYNONYMS: LexicalSynonymGroup[] = [
  { canonical: 'llm', keys: ['llm', 'llms', 'language model', 'language models', 'large language model', 'large language models'] },
  { canonical: 'robot', keys: ['robot', 'robots', 'robotic', 'robotics'] },
  { canonical: 'fuse', keys: ['fuse', 'fuses', 'fused', 'fusing', 'fusion', 'fusions'] },
  { canonical: 'estimate', keys: ['estimate', 'estimates', 'estimated', 'estimating', 'estimation', 'estimations'] },
  { canonical: 'plan', keys: ['plan', 'plans', 'planned', 'planning', 'planner', 'planners'] },
  { canonical: 'schedule', keys: ['schedule', 'schedules', 'scheduled', 'scheduling'] },
  { canonical: 'manipulate', keys: ['manipulate', 'manipulated', 'manipulating', 'manipulation', 'manipulations', 'manipulator', 'manipulators', 'manipulative'] },
]

export interface LexicalHit { index: number; score: number }

const K1 = 1.5
const B = 0.75

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Length-guarded plural folding: only merges when the stem stays >= 4 chars,
 *  so short/ambiguous words (`news`, `gas`, `uses`) are left untouched. */
function pluralFold(token: string): string {
  if (token.length < 5) return token
  if (token.endsWith('ies')) {
    const stem = token.slice(0, -3)
    return stem.length >= 3 ? `${stem}y` : token
  }
  if (/[szx]es$/.test(token) || /(?:ch|sh)es$/.test(token)) {
    const stem = token.slice(0, -2)
    return stem.length >= 4 ? stem : token
  }
  if (token.endsWith('s')) {
    const stem = token.slice(0, -1)
    return stem.length >= 4 ? stem : token
  }
  return token
}

export class EnhancedLexicalStore {
  private readonly plural: boolean
  /** Surface form (single token) -> canonical token; includes self entries so
   *  canonical tokens skip the plural rule. */
  private readonly synonymOf = new Map<string, string>()
  /** Multi-word keys: regex over the raw lowercase text -> canonical token. */
  private readonly phrases: { pattern: RegExp; canonical: string }[] = []

  private chunks = 0
  private docLen: number[] = []
  private df = new Map<string, number>()
  private postings = new Map<string, Map<number, number>>()

  constructor(options: LexicalStoreOptions = {}) {
    this.plural = options.pluralFold ?? true
    const groups = options.synonyms ?? DEFAULT_SYNONYMS
    const multi: { key: string; canonical: string }[] = []
    for (const group of groups) {
      const canonical = group.canonical.trim().toLowerCase()
      if (canonical === '') continue
      this.synonymOf.set(canonical, canonical)
      for (const raw of group.keys) {
        const key = raw.trim().toLowerCase()
        if (key === '' || key === canonical) continue
        this.synonymOf.set(key, canonical)
        if (key.includes(' ')) multi.push({ key, canonical })
      }
    }
    // Longest keys first so `large language model` wins over `language model`.
    multi.sort((a, b) => b.key.split(/\s+/).length - a.key.split(/\s+/).length
      || b.key.length - a.key.length)
    for (const { key, canonical } of multi) {
      this.phrases.push({ pattern: new RegExp(`\\b${escapeRegExp(key)}\\b`, 'g'), canonical })
    }
  }

  /** Number of canonical synonym groups in effect (0 == plain BM25). */
  groupCount(): number {
    return new Set(this.synonymOf.values()).size
  }

  /** Tokenize text into canonical terms (phrase keys first, then per-token
   *  synonym folding, then plural folding). */
  tokenize(text: string): string[] {
    let lowered = text.toLowerCase()
    for (const { pattern, canonical } of this.phrases) {
      lowered = lowered.replace(pattern, ` ${canonical} `)
    }
    const tokens = lowered.match(/[a-z0-9][a-z0-9\-_+]{1,}/g) ?? []
    const out: string[] = []
    for (const token of tokens) {
      if (token.length <= 1) continue
      out.push(this.fold(token))
    }
    return out
  }

  /** Build term statistics (df / doc length / postings) in canonical space. */
  build(chunks: { text: string }[]): void {
    this.chunks = chunks.length
    this.docLen = []
    this.df = new Map()
    this.postings = new Map()
    chunks.forEach((chunk, index) => {
      const terms = this.tokenize(chunk.text)
      this.docLen.push(terms.length)
      const tf = new Map<string, number>()
      for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1)
      for (const [term, termFreq] of tf) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1)
        let post = this.postings.get(term)
        if (post === undefined) {
          post = new Map()
          this.postings.set(term, post)
        }
        post.set(index, termFreq)
      }
    })
  }

  /** Okapi BM25 over canonical terms; all scored docs, descending. */
  search(query: string): LexicalHit[] {
    const terms = this.tokenize(query)
    if (terms.length === 0 || this.chunks === 0) return []
    const docCount = this.chunks
    const avgdl = this.docLen.reduce((a, b) => a + b, 0) / docCount
    const scores = new Map<number, number>()
    for (const term of terms) {
      const n = this.df.get(term) ?? 0
      if (n === 0) continue
      const idf = Math.log(1 + (docCount - n + 0.5) / (n + 0.5))
      const post = this.postings.get(term)
      if (post === undefined) continue
      for (const [index, tf] of post) {
        const denom = tf + K1 * (1 - B + B * (this.docLen[index] ?? 1) / avgdl)
        const score = idf * (tf * (K1 + 1)) / denom
        scores.set(index, (scores.get(index) ?? 0) + score)
      }
    }
    return [...scores.entries()]
      .map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score)
  }

  private fold(token: string): string {
    const exact = this.synonymOf.get(token)
    if (exact !== undefined) return exact
    // `llm-based` / `llms-based`: fold on the hyphenated head when it is a
    // known surface form; otherwise keep the token as-is.
    const hyphen = token.indexOf('-')
    if (hyphen > 0) {
      const head = this.synonymOf.get(token.slice(0, hyphen))
      if (head !== undefined) return head
    }
    return this.plural ? pluralFold(token) : token
  }
}

export default EnhancedLexicalStore
