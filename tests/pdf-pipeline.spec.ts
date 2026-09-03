import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { IdeagetError } from '../src/errors.js'
import { extractPdfText } from '../src/content/pdf-text.js'
import { pdfAttachmentToMarkdown, bestPdfAttachment } from '../src/content/pipeline.js'
import type { ZoteroItem } from '../src/zotero/model.js'

async function textPdf(paragraphs: string[], pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([400, 400])
    let y = 380
    for (const text of paragraphs) {
      page.drawText(text, { x: 40, y, size: 12, font, color: rgb(0, 0, 0) })
      y -= 18
    }
  }
  return doc.save()
}

function attachmentItem(filename: string): ZoteroItem {
  return {
    key: 'ABCD1234',
    version: 1,
    library: { type: 'user', id: 0 },
    data: {
      itemType: 'attachment',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
      filename,
    },
    links: { enclosure: { href: `file:///unused/${filename}` } },
  }
}

describe('extractPdfText', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog while the agent reads the paper.'
  const second = 'A second sentence fills the budget test with enough extractable characters to measure.'

  it('extracts text across pages', async () => {
    const pdf = await textPdf([sentence], 2)
    const result = await extractPdfText(pdf, 100_000)
    expect(result.text).toContain('quick brown fox')
    expect(result.chars).toBeGreaterThan(40)
    expect(result.pages).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('respects the character budget and reports truncation', async () => {
    const pdf = await textPdf([sentence, second], 3)
    const full = await extractPdfText(pdf, 100_000)
    const result = await extractPdfText(pdf, 10)
    expect(result.truncated).toBe(true)
    expect(result.chars).toBeLessThan(full.chars)
  })

  it('yields almost nothing for a blank page', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([400, 400])
    const result = await extractPdfText(await doc.save(), 100_000)
    expect(result.chars).toBeLessThan(40)
  })
})

describe('pdfAttachmentToMarkdown', () => {
  it('picks the best PDF and assembles markdown + meta', async () => {
    const body = 'The abstract body of the paper explains the method in enough detail for the extraction to succeed.'
    const pdf = await textPdf([body], 1)
    const attachments = [attachmentItem('a.pdf'), attachmentItem('b.pdf')]
    const readBytes = async (): Promise<Uint8Array> => pdf
    const result = await pdfAttachmentToMarkdown(
      { title: 'T', keywords: ['k1'], tags: [], abstract: 'abs' },
      attachments,
      1_000_000,
      100_000,
      readBytes,
    )
    expect(result.markdown).toContain('abstract body')
    expect(result.meta.title).toBe('T')
    expect(result.meta.keywords).toEqual(['k1'])
  })

  it('fails with no-text-attachment when no PDF exists', async () => {
    const attachments: ZoteroItem[] = [{
      key: 'NNNNNNNN',
      version: 1,
      library: { type: 'user', id: 0 },
      data: { itemType: 'note', note: '<p>hi</p>' },
    }]
    await expect(pdfAttachmentToMarkdown({ keywords: [], tags: [] }, attachments, 1, 1, async () => new Uint8Array()))
      .rejects.toMatchObject<IdeagetError>({ code: 'no-text-attachment' })
  })

  it('fails with pdf-parse-failed for unreadable bytes', async () => {
    const attachments = [attachmentItem('a.pdf')]
    await expect(pdfAttachmentToMarkdown(
      { keywords: [], tags: [] },
      attachments,
      1_000_000,
      100_000,
      async () => new Uint8Array([1, 2, 3, 4]),
    )).rejects.toMatchObject<IdeagetError>({ code: 'pdf-parse-failed' })
  })

  it('fails loud when the attachment exceeds the byte budget', async () => {
    const attachments = [attachmentItem('big.pdf')]
    // In the real flow the byte budget is enforced by the transport reader;
    // the pipeline must propagate that IdeagetError untouched.
    const readBytes = async (): Promise<Uint8Array> => {
      throw new IdeagetError('pdf-budget-exceeded', 'attachment is 2048 bytes, over the 1024 byte budget')
    }
    await expect(pdfAttachmentToMarkdown(
      { keywords: [], tags: [] },
      attachments,
      1024,
      100_000,
      readBytes,
    )).rejects.toMatchObject<IdeagetError>({ code: 'pdf-budget-exceeded' })
  })
})

describe('bestPdfAttachment', () => {
  it('skips non-PDF and linked-only attachments', () => {
    const attachments: ZoteroItem[] = [
      attachmentItem('x.pdf'),
      {
        key: 'YYYYYYYY',
        version: 1,
        library: { type: 'user', id: 0 },
        data: { itemType: 'attachment', contentType: 'text/html', linkMode: 'imported_url' },
      },
    ]
    expect(bestPdfAttachment(attachments)?.item.key).toBe('ABCD1234')
  })
})
