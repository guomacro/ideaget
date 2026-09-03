/**
 * PDF text extraction in Node via pdfjs-dist (legacy build, no canvas, no
 * worker). Row assembly groups text items by baseline y, word assembly joins
 * items by horizontal gap, and paragraph breaks insert a blank line when the
 * vertical gap exceeds the running line height — a heuristic clean enough for
 * an LLM-reading pipeline. Scanned (image-only) PDFs yield little or no text;
 * callers surface that honestly instead of fabricating content.
 *
 * Budget: page-wise accumulation against `budgetChars`; exceeding it stops
 * extraction and reports `truncated`.
 * @module ideaget/content/pdf-text
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface PdfTextResult {
  /** Extracted text, paragraphs separated by blank lines, CRLF normalized. */
  text: string
  /** Number of pages walked (may stop early on budget). */
  pages: number
  /** Characters emitted. */
  chars: number
  /** True when the budget cut extraction short. */
  truncated: boolean
}

interface PdfTextItem {
  str: string
  x: number
  y: number
  width: number
}

function collectRows(items: PdfTextItem[]): PdfTextItem[][] {
  const rows = new Map<number, { y: number; items: PdfTextItem[] }>()
  for (const item of items) {
    // Round to a 1.5px band so sub-line jitter does not split rows.
    const band = Math.round(item.y * 2) / 2
    const row = rows.get(band)
    if (row === undefined) {
      rows.set(band, { y: item.y, items: [item] })
    } else {
      row.items.push(item)
    }
  }
  const sorted = [...rows.values()].sort((a, b) => a.y - b.y)
  return sorted.map(row => row.items.sort((a, b) => a.x - b.x))
}

function rowText(row: PdfTextItem[]): string {
  let out = ''
  let prevEnd = 0
  for (const item of row) {
    if (out === '') {
      out = item.str
    } else if (item.x - prevEnd > 2) {
      out += ` ${item.str}`
    } else {
      out += item.str
    }
    prevEnd = item.x + item.width
  }
  return out.replace(/\s+/g, ' ').trim()
}

export async function extractPdfText(
  data: Uint8Array,
  budgetChars: number,
): Promise<PdfTextResult> {
  const document = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise
  const paragraphs: string[] = []
  let chars = 0
  let truncated = false
  let lineGapTotal = 0
  let lineGapCount = 0
  let previousRowY: number | undefined

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items: PdfTextItem[] = []
      for (const raw of content.items) {
        if (!('str' in raw)) continue // TextMarkedContent has no text
        if (typeof raw.str !== 'string' || raw.str.trim() === '') continue
        const transform = raw.transform
        items.push({
          str: raw.str,
          x: transform[4],
          y: transform[5],
          width: typeof raw.width === 'number' ? raw.width : 0,
        })
      }
      for (const row of collectRows(items)) {
        const text = rowText(row)
        if (text === '') continue
        const rowY = row[0]!.y
        if (previousRowY !== undefined) {
          const gap = Math.abs(previousRowY - rowY)
          lineGapTotal += gap
          lineGapCount += 1
          const averageGap = lineGapTotal / lineGapCount
          if (gap > averageGap * 1.6 + 3) paragraphs.push('')
        }
        paragraphs.push(text)
        chars += text.length
        previousRowY = rowY
        if (chars >= budgetChars) {
          truncated = true
          break
        }
      }
      if (truncated) break
    }
  } finally {
    await document.destroy()
  }

  // Collapse accidental runs of blank lines from the gap heuristic.
  const text = paragraphs
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, pages: truncated ? paragraphs.length : document.numPages, chars: text.length, truncated }
}
