/**
 * Markdown content pipeline: one parent item (or attachment item) →
 * best PDF attachment bytes → clean-ish Markdown text + normalized metadata
 * (title / creators / year / abstract / keywords). Image extraction is a
 * reserved port (page rendering needs a rasterizer decision; see
 * docs/04-backend-module-design.md) — this stage emits only text today and
 * reports attachment facts honestly.
 * @module ideaget/content/pipeline
 */

import { IdeagetError } from '../errors.js'
import { extractPdfText } from './pdf-text.js'
import type { ZoteroItem } from '../zotero/model.js'

export interface PaperMeta {
  title?: string
  creators?: string
  year?: string
  abstract?: string
  keywords: string[]
  tags: string[]
  doi?: string
}

export interface PaperMarkdown {
  /** Extracted body text as paragraphs (not a fabricated document). */
  markdown: string
  meta: PaperMeta
  pages: number
  chars: number
  truncated: boolean
  attachmentName?: string
  attachmentPath?: string
}

/** Pick the best stored PDF among attachment child items. */
export function bestPdfAttachment(attachments: ZoteroItem[]): { item: ZoteroItem; href: string } | undefined {
  const pdfs = attachments.filter((child) => {
    const data = child.data
    return data.itemType === 'attachment'
      && data.contentType === 'application/pdf'
      && (data.linkMode === 'imported_file' || data.linkMode === 'imported_url')
  })
  if (pdfs.length === 0) return undefined
  pdfs.sort((a, b) => (b.data.filename ?? '').localeCompare(a.data.filename ?? ''))
  const chosen = pdfs[0]!
  const href = chosen.links?.enclosure?.href ?? chosen.data.path
  if (typeof href !== 'string' || href === '') return undefined
  return { item: chosen, href }
}

/**
 * Run the pipeline over one parent item's attachments.
 * @param parentMeta - normalized metadata for the markdown meta block.
 * @param attachments - the item's attachment children.
 * @param maxPdfBytes - attachment size budget.
 * @param budgetChars - extracted-text budget.
 */
export async function pdfAttachmentToMarkdown(
  parentMeta: PaperMeta,
  attachments: ZoteroItem[],
  maxPdfBytes: number,
  budgetChars: number,
  readBytes: (href: string) => Promise<Uint8Array>,
): Promise<PaperMarkdown> {
  const found = bestPdfAttachment(attachments)
  if (found === undefined) {
    throw new IdeagetError('no-text-attachment', 'this item has no stored PDF attachment to read')
  }
  const { item, href } = found
  const bytes = await readBytes(href)
  let result
  try {
    result = await extractPdfText(bytes, budgetChars)
  } catch (error) {
    if (error instanceof IdeagetError) throw error
    throw new IdeagetError('pdf-parse-failed', `PDF text extraction failed: ${String(error)}`, { cause: error })
  }
  if (result.chars < 40) {
    throw new IdeagetError(
      'pdf-parse-failed',
      'extracted almost no text — the PDF is likely scanned (image-only) or damaged; OCR is not enabled',
    )
  }
  return {
    markdown: result.text,
    meta: parentMeta,
    pages: result.pages,
    chars: result.chars,
    truncated: result.truncated,
    attachmentName: item.data.filename,
  }
}
