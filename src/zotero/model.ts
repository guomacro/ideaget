/**
 * Zotero object model: minimal typed slice of the Web/local API v3 JSON plus
 * normalization helpers. Loose on purpose — Zotero fields vary by item type —
 * but the helpers below are the single home for field semantics (year,
 * creators, keywords) so tools and the pipeline read one normalized view.
 * @module ideaget/zotero/model
 */

export interface ZoteroCreator {
  creatorType?: string
  firstName?: string
  lastName?: string
  name?: string
}

export interface ZoteroTag {
  tag: string
}

export interface ZoteroItemData {
  key?: string
  itemType?: string
  title?: string
  creators?: ZoteroCreator[]
  abstractNote?: string
  date?: string
  DOI?: string
  url?: string
  extra?: string
  tags?: ZoteroTag[]
  collections?: string[]
  language?: string
  /** Child-note body (HTML-ish rich text as Zotero stores it). */
  note?: string
  /** Attachment fields. */
  contentType?: string
  linkMode?: string
  filename?: string
  path?: string
  [field: string]: unknown
}

export interface ZoteroItem {
  key: string
  version: number
  library: { type: string; id: number; name?: string }
  data: ZoteroItemData
  meta?: { numChildren?: number; creatorSummary?: string; parsedDate?: string }
  links?: {
    self?: { href?: string }
    up?: { href?: string }
    enclosure?: { href?: string; type?: string; title?: string; length?: number }
  }
}

/** Normalize a user-supplied ref (`zotero://…/item/KEY`, bare `KEY`) to a key. */
export function parseRef(ref: string): string {
  // Zotero keys are exactly 8 chars of uppercase letters and digits; both the
  // URI form and the bare form accept only that alphabet.
  const match = /^zotero:\/\/[^/]+\/\d+\/item\/([A-Z0-9]+)$/.exec(ref.trim())
  if (match !== null) return match[1]!
  const bare = /^([A-Z0-9]{8})$/.exec(ref.trim())
  if (bare !== null) return bare[1]!
  throw new Error(`malformed Zotero ref: ${JSON.stringify(ref)}`)
}

/** `creators` rendered as "A. Last, B. Last". */
export function creatorsText(data: ZoteroItemData): string {
  const parts = (data.creators ?? []).map((creator) => {
    if (creator.name !== undefined && creator.name !== '') return creator.name
    const given = creator.firstName ?? ''
    const last = creator.lastName ?? ''
    if (given === '' && last === '') return ''
    const initial = given === '' ? '' : `${given.trim().charAt(0).toUpperCase()}. `
    return `${initial}${last}`
  })
  return parts.filter(part => part !== '').join(', ')
}

/** Calendar year out of Zotero's free-form `date` field. */
export function yearOf(date: string | undefined): string {
  if (date === undefined) return ''
  const match = /\b(19|20)\d{2}\b/.exec(date)
  return match?.[0] ?? ''
}

export function tagsOf(data: ZoteroItemData): string[] {
  return (data.tags ?? []).map(tag => tag.tag)
}

export function abstractOf(data: ZoteroItemData): string {
  return data.abstractNote ?? ''
}

/**
 * Keywords beyond tags: Zotero has no built-in `keywords` field. This parser
 * looks for common `Keywords:` / `keywords:` lines inside `extra` (arXiv and
 * journal imports carry them) and falls back to tags.
 */
export function keywordsOf(data: ZoteroItemData): string[] {
  const fromExtra: string[] = []
  const extra = data.extra ?? ''
  for (const line of extra.split('\n')) {
    const match = /^\s*(?:keywords?|subject(?:s)?|kwd)\s*:\s*(.+)\s*$/i.exec(line)
    if (match !== null) {
      for (const token of match[1]!.split(/[;,]/)) {
        const clean = token.trim()
        if (clean !== '' && !fromExtra.includes(clean)) fromExtra.push(clean)
      }
    }
  }
  if (fromExtra.length > 0) return fromExtra
  return tagsOf(data)
}

/** A stable display ref for one item, e.g. `zotero://user/0/item/58YFQJWK`. */
export function itemRef(item: ZoteroItem): string {
  return `zotero://user/0/item/${item.key}`
}

/** A printable title fallback for items without one. */
export function titleOf(data: ZoteroItemData): string {
  return data.title ?? `[untitled ${data.itemType ?? 'item'}]`
}
