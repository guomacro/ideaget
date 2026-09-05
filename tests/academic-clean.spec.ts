import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { clean, parsePdfToAcademic } from '../src/content/academic.js'

async function twoColumnPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792])
    page.drawText('Journal of Testing Papers', { x: 180, y: 760, size: 11, font })
    page.drawText('Page footer fixed', { x: 30, y: 20, size: 9, font })
    // Two columns with staggered baselines so each row band holds one column
    // (real two-column bodies rarely share exact baselines).
    for (let i = 0; i < 6; i++) {
      const leftY = 680 - i * 70
      const rightY = 680 - i * 70 - 35
      page.drawText(`LEFT sentence number ${i} about left column content.`, { x: 40, y: leftY, size: 9, font })
      page.drawText(`RIGHT sentence number ${i} about right column content.`, { x: 330, y: rightY, size: 9, font })
    }
  }
  return doc.save()
}

describe('clean', () => {
  it('merges hyphenated line breaks before folding newlines', () => {
    expect(clean('informa-\ntion theory')).toBe('information theory')
  })
  it('folds single newlines into spaces and keeps paragraph breaks', () => {
    expect(clean('first line\nsecond line\n\nnew paragraph')).toBe('first line second line\n\nnew paragraph')
  })
  it('removes full-width and zero-width spaces', () => {
    expect(clean('a\u200bb\u3000c')).toBe('ab c')
  })
})

describe('parsePdfToAcademic (rules layout)', () => {
  it('removes repeated page headers, keeps column-major order, folds prose', async () => {
    const bytes = await twoColumnPdf(3)
    const doc = await parsePdfToAcademic(new Uint8Array(bytes), { title: 'Synthetic' }, { budgetChars: 100_000 })
    expect(doc.body.text).not.toContain('Journal of Testing Papers')
    expect(doc.body.text).not.toContain('Page footer fixed')
    const leftFirst = doc.body.text.indexOf('LEFT sentence number 0')
    const rightFirst = doc.body.text.indexOf('RIGHT sentence number 0')
    expect(leftFirst).toBeGreaterThanOrEqual(0)
    expect(rightFirst).toBeGreaterThan(leftFirst)
    // Cleaned prose: the whole left column then the whole right column read
    // left sentence 5 before right sentence 0 would only hold in column-major.
    const leftLast = doc.body.text.indexOf('LEFT sentence number 5')
    const rightZero = doc.body.text.indexOf('RIGHT sentence number 0')
    expect(rightZero).toBeGreaterThan(leftLast)
    expect(doc.body.text).toContain('about left column content')
  })
})
