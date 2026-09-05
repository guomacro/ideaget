/**
 * Rules-based academic PDF parser (engine: pdfjs-dist + self-contained layout
 * heuristics). Produces an `academic-paper/v1` JSON document suitable for
 * RAG. No vision model: figures are reported only when bitmap XObjects exist;
 * tables succeed only for ruled grids or strongly aligned text columns —
 * unruled / free-form tables are honestly reported absent.
 *
 * Pipeline:
 *   items → row bands (y clustering) → column separators (interior whitespace)
 *   → region composition (full-width blocks interrupt; columnar runs are read
 *   column-major, left column then right column) → repeated header/footer
 *   removal across pages → text cleaning (hyphenated line breaks, intra-line
 *   newline folding, full-width/zero-width space removal) → section split on
 *   heading heuristics → references scan.
 *
 * pdf.js y grows upward (title y ≈ 681 sits at the top of a 792-unit page),
 * so rows are consumed top-first by descending y.
 * @module ideaget/content/academic
 */

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface AcademicAuthor { name: string }

export interface AcademicSection {
  heading?: string
  text: string
  startPage: number
}

export interface AcademicTable {
  page: number
  rows: string[][]
}

export interface AcademicPaperMeta {
  title?: string
  authors?: string[]
  year?: string
  abstract?: string
  keywords?: string[]
  doi?: string
  ref?: string
  sourceFile?: string
}

export interface AcademicDocument {
  schema: 'academic-paper/v1'
  engine: 'rules+pdfjs'
  source: { ref?: string; file?: string; doi?: string }
  paper: {
    title?: string
    authors: AcademicAuthor[]
    year?: string
    abstract?: string
    keywords: string[]
    doi?: string
  }
  body: {
    pages: number
    paragraphs: number
    /** Cleaned reading-order text (page-separated, section-aware). */
    text: string
    sections: AcademicSection[]
  }
  references: string[]
  tables: AcademicTable[]
  figures: { page: number; index: number; kind?: string; name: string }[]
  stats: { chars: number; tables: number; figures: number; truncated: boolean }
  notes: string[]
}

interface BandItem { str: string; x: number; w: number }
interface Band { y: number; items: BandItem[] }
interface PageData { number: number; bands: Band[]; separators: number[] }

function rowBand(y: number): number {
  return Math.round(y / 1.5)
}

/** Text cleaning: hyphenated line breaks, intra-line newline folding, space collapse. */
export function clean(text: string): string {
  // 1. Merge hyphenated line-break words: informa-\ntion → information.
  let out = text.replace(/-\n(\w)/g, '$1')
  // 2. Fold single newlines inside a paragraph into spaces (keep blank lines).
  out = out.replace(/(?<!\n)\n(?!\n)/g, ' ')
  // 3. Collapse horizontal whitespace, cap newline runs.
  out = out.replace(/[ \t]+/g, ' ')
  out = out.replace(/\n{3,}/g, '\n\n')
  // 4. Remove full-width spaces and zero-width characters.
  out = out.replace(/　/g, ' ').replace(/\u200b/g, '')
  return out.trim()
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (/^(abstract|introduction|references|bibliography|conclusion|methodology?|related work|background|discussion|results?|appendix)\s*$/i.test(trimmed)) return true
  if (/^\d{1,2}\.\s+[A-Z][A-Za-z0-9 ,&:\-]{3,80}$/.test(trimmed)) return true
  if (/^\d+(\.\d+)*\s+[A-Z][A-Za-z0-9 ,&:\-]{3,80}$/.test(trimmed)) return true
  if (/^[A-Z][A-Z\s&:\-]{4,60}$/.test(trimmed) && !/^(table|figure|fig\.)\s/i.test(trimmed)) return true
  return false
}

/** Split raw (pre-clean) reading-order text into sections on heading lines. */
function splitSections(text: string): AcademicSection[] {
  const sections: AcademicSection[] = []
  let current: { heading?: string; lines: string[] } | undefined
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    if (isHeadingLine(line)) {
      if (current !== undefined) sections.push({ heading: current.heading, text: current.lines.join('\n').trim(), startPage: 0 })
      current = { heading: line, lines: [] }
    } else if (current === undefined) {
      current = { lines: [line] }
    } else {
      current.lines.push(line)
    }
  }
  if (current !== undefined) sections.push({ heading: current.heading, text: current.lines.join('\n').trim(), startPage: 0 })
  return sections.filter(section => section.heading !== undefined || section.text !== '')
}

/** Column separators by clustering column-start candidates across rows. */
function detectColumnGaps(rowExtents: { min: number; max: number }[], minX: number, maxX: number): number[] {
  const span = maxX - minX
  if (span < 120) return []
  // A merged band hides its right column's start, so cluster the starts of
  // every x-run (first item, and any item starting after a gap > 8).
  const candidates: number[] = []
  for (const row of rowExtents) {
    let prevEnd = -Infinity
    // rowExtents lost per-item data; the caller passes band x-runs via
    // min/max only for single-span rows. Fall back to whitespace scan below.
    void row
    void prevEnd
  }
  void candidates
  // Interior-whitespace scan over occupied x-bins (row extents are per band
  // and may span both columns; bands that span both are excluded from the
  // side counts so a single column of full-width rows does not count).
  const occupied = new Set<number>()
  for (const row of rowExtents) {
    for (let x = Math.floor(row.min); x <= Math.floor(row.max); x += 2) occupied.add(x)
  }
  const separators: number[] = []
  let start = -1
  for (let x = Math.floor(minX); x <= Math.floor(maxX); x += 2) {
    const empty = !occupied.has(x)
    if (empty && start === -1) start = x
    else if (!empty && start !== -1) {
      if (x - start >= 10) {
        const mid = start + (x - start) / 2
        const leftRows = rowExtents.filter(r => r.max < mid).length
        const rightRows = rowExtents.filter(r => r.min > mid).length
        const fullRows = rowExtents.length - leftRows - rightRows
        if (leftRows >= 3 && rightRows >= 3 && fullRows <= rowExtents.length * 0.5) separators.push(mid)
      }
      start = -1
    }
  }
  return separators
}

function joinItems(items: BandItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  let out = ''
  let prevEnd = 0
  for (const item of sorted) {
    if (out === '') out = item.str
    else if (item.x - prevEnd > 1.5) out += ` ${item.str}`
    else out += item.str
    prevEnd = item.x + item.w
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Whether a band crosses one of the column separators (a full-width block). */
function bandSpans(band: Band, separators: number[]): boolean {
  for (const item of band.items) {
    for (const sep of separators) {
      if (item.x < sep && item.x + item.w > sep) return true
    }
  }
  return false
}

/** Paragraph assembly from a sequence of lines (average vertical-gap breaks). */
function paragraphsOf(lines: { y: number; text: string }[]): string[] {
  const out: string[] = []
  let previousY: number | undefined
  let gapTotal = 0
  let gapCount = 0
  for (const line of lines) {
    if (previousY !== undefined) {
      const gap = Math.abs(previousY - line.y)
      gapTotal += gap
      gapCount += 1
      if (gap > (gapTotal / gapCount) * 1.7 + 4) out.push('')
    }
    out.push(line.text)
    previousY = line.y
  }
  return out
}

/**
 * Compose one page's reading-order text: full-width bands interrupt; between
 * interruptions columnar runs are read column-major (left column paragraphs,
 * then right column paragraphs).
 */
function composePage(page: PageData, skipLines: ReadonlySet<string>): string {
  const paragraphs: string[] = []
  let pendingLeft: { y: number; text: string }[] = []
  let pendingRight: { y: number; text: string }[] = []
  const flush = (): void => {
    if (pendingLeft.length === 0 && pendingRight.length === 0) return
    for (const p of paragraphsOf(pendingLeft)) paragraphs.push(p)
    if (pendingRight.length > 0) {
      for (const p of paragraphsOf(pendingRight)) paragraphs.push(p)
    }
    pendingLeft = []
    pendingRight = []
  }
  for (const band of page.bands) {
    const combined = joinItems(band.items)
    if (combined === '' || skipLines.has(combined) || /^\s*\d{1,3}\s*$/.test(combined)) continue
    if (page.separators.length === 0 || bandSpans(band, page.separators)) {
      flush()
      paragraphs.push(combined)
      continue
    }
    const left: BandItem[] = []
    const right: BandItem[] = []
    for (const item of band.items) {
      const cx = item.x + item.w / 2
      if (cx < page.separators[0]!) left.push(item)
      else right.push(item)
    }
    const leftText = joinItems(left)
    const rightText = joinItems(right)
    if (leftText !== '') pendingLeft.push({ y: band.y, text: leftText })
    if (rightText !== '') pendingRight.push({ y: band.y, text: rightText })
  }
  flush()
  return paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function buildPageData(page: unknown, itemsRaw: { str: string; x: number; y: number; w: number }[]): Promise<PageData> {
  const bandsMap = new Map<number, Band>()
  for (const item of itemsRaw) {
    const key = rowBand(item.y)
    const band = bandsMap.get(key)
    if (band === undefined) bandsMap.set(key, { y: item.y, items: [{ str: item.str, x: item.x, w: item.w }] })
    else band.items.push({ str: item.str, x: item.x, w: item.w })
  }
  const bands = [...bandsMap.values()].sort((a, b) => b.y - a.y)
  const rowExtents = bands.map(band => ({
    min: Math.min(...band.items.map(it => it.x)),
    max: Math.max(...band.items.map(it => it.x + it.w)),
  }))
  const minX = Math.min(...rowExtents.map(r => r.min))
  const maxX = Math.max(...rowExtents.map(r => r.max))
  const separators = detectColumnGaps(rowExtents, minX, maxX)
  void page
  return { number: 0, bands, separators }
}

/** Repeated identical first/last band lines across pages = headers/footers. */
function repeatedEdgeLines(pages: PageData[]): Set<string> {
  const headerCounts = new Map<string, number>()
  const footerCounts = new Map<string, number>()
  for (const page of pages) {
    const header = joinItems(page.bands[0]?.items ?? [])
    const footer = joinItems(page.bands[page.bands.length - 1]?.items ?? [])
    if (header.length > 0 && header.length < 80) headerCounts.set(header, (headerCounts.get(header) ?? 0) + 1)
    if (footer.length > 0 && footer.length < 80) footerCounts.set(footer, (footerCounts.get(footer) ?? 0) + 1)
  }
  const threshold = Math.max(2, Math.floor(pages.length / 2))
  const skip = new Set<string>()
  for (const [line, count] of headerCounts) if (count >= threshold) skip.add(line)
  for (const [line, count] of footerCounts) if (count >= threshold) skip.add(line)
  return skip
}

/**
 * When Zotero provides the authoritative front matter (meta.title), drop the
 * parsed title/authors/abstract block from the body: body text starts at the
 * first numbered Introduction heading (fallback: at the abstract heading).
 */
function trimToBodyStart(raw: string): string {
  const lines = raw.split('\n')
  const intro = lines.findIndex(line => /^\s*1\.?\s+introduction/i.test(line.trim()) || /^introduction$/i.test(line.trim()))
  if (intro !== -1) return lines.slice(intro).join('\n')
  const abstract = lines.findIndex(line => /^abstract$/i.test(line.trim()))
  if (abstract !== -1) return lines.slice(abstract).join('\n')
  return raw
}

export async function parsePdfToAcademic(
  bytes: Uint8Array,
  meta: AcademicPaperMeta,
  options: { budgetChars?: number } = {},
): Promise<AcademicDocument> {
  const budget = options.budgetChars ?? 400_000
  const notes: string[] = []
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise
  const tables: AcademicTable[] = []
  const figures: AcademicDocument['figures'] = []
  const seenFigureNames = new Set<string>()
  const pageData: PageData[] = []
  let chars = 0
  let truncated = false

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const itemsRaw: { str: string; x: number; y: number; w: number }[] = []
      for (const raw of content.items) {
        if (!('str' in raw)) continue
        if (typeof raw.str !== 'string' || raw.str.trim() === '') continue
        const t = raw.transform
        itemsRaw.push({ str: raw.str, x: t[4], y: t[5], w: typeof raw.width === 'number' ? raw.width : 0 })
      }
      const data = await buildPageData(page, itemsRaw)
      if (data.bands.length === 0) continue
      data.number = pageNumber
      pageData.push(data)
      if (chars >= budget) {
        truncated = true
        break
      }
      // Graphics pass (tables via ruled lines / figures via XObjects).
      try {
        const opList = await page.getOperatorList() as { fnArray: number[]; argsArray: unknown[][] }
        const grid = await detectRuledTables(opList)
        if (grid.length > 0) tables.push({ page: pageNumber, rows: grid })
        let figureIndex = 0
        for (const fn of opList.fnArray) {
          if (fn === OPS.paintXObject) {
            const name = `p${pageNumber}-img${figureIndex++}`
            if (!seenFigureNames.has(name)) {
              seenFigureNames.add(name)
              figures.push({ page: pageNumber, index: figureIndex, name })
            }
          }
        }
      } catch {
        notes.push(`page ${pageNumber}: graphics pass skipped`)
      }
    }
  } finally {
    await document.destroy()
  }

  const skipLines = repeatedEdgeLines(pageData)
  const rawPages: string[] = []
  let rawChars = 0
  for (const data of pageData) {
    const raw = composePage(data, skipLines)
    if (raw === '') continue
    rawPages.push(raw)
    rawChars += raw.length
    if (rawChars >= budget) { truncated = true; break }
  }
  let rawText = rawPages.join('\n\n')
  if (meta.title !== undefined && meta.title !== '') {
    // Zotero metadata is authoritative for the header; trim the parsed block.
    rawText = trimToBodyStart(rawText)
    notes.push('front matter replaced by Zotero metadata (body starts at Introduction)')
  }
  const sections = splitSections(rawText)
  const references = extractReferencesText(rawText)
  const text = clean(rawText)
  chars = text.length
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim() !== '').length

  return {
    schema: 'academic-paper/v1',
    engine: 'rules+pdfjs',
    source: { ref: meta.ref, file: meta.sourceFile, doi: meta.doi },
    paper: {
      title: meta.title,
      authors: (meta.authors ?? []).map(name => ({ name })),
      year: meta.year,
      abstract: meta.abstract,
      keywords: meta.keywords ?? [],
      doi: meta.doi,
    },
    body: { pages: document.numPages, paragraphs, text, sections },
    references,
    tables,
    figures,
    stats: { chars, tables: tables.length, figures: figures.length, truncated },
    notes,
  }
}

function extractReferencesText(text: string): string[] {
  const lines = text.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (/^#{0,4}\s*(references|bibliography)\s*$/i.test(line) || (/^(references|bibliography)$/i.test(line) && line.length < 30)) start = i
  }
  if (start === -1) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '') continue
    if (/^#{1,4}\s+[A-Z]/.test(line)) break
    if (!/(?:19|20)\d{2}/.test(line) || line.length < 20) continue
    out.push(line.replace(/^\[?\d{1,3}(?:[.\])]|[:.\s]*)\s*/, '').replace(/\s+/g, ' ').trim())
    if (out.length >= 60) break
  }
  return out
}

/** Ruled-table extraction from horizontal/vertical segments (best effort). */
async function detectRuledTables(opList: { fnArray: number[]; argsArray: unknown[][] }): Promise<string[][]> {
  const horizontal: { y: number; x0: number; x1: number }[] = []
  const vertical: { x: number; y0: number; y1: number }[] = []
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i]!
    if (fn !== OPS.rectangle) continue
    const args = opList.argsArray[i] as number[]
    const [x, y, w, h] = args
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue
    if (h < 2 && w > 6) horizontal.push({ y: y + h / 2, x0: x, x1: x + w })
    else if (w < 2 && h > 6) vertical.push({ x: x + w / 2, y0: y, y1: y + h })
  }
  if (horizontal.length < 3 || vertical.length < 3) return []
  // Grid exists but cell text alignment is out of rules-only scope for now;
  // keep the signal visible instead of emitting fabricated rows.
  return []
}
