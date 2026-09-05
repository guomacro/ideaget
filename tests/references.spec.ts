import { describe, expect, it } from 'vitest'
import { extractReferences } from '../src/content/references.js'

describe('extractReferences', () => {
  it('finds citation-like lines in a trailing References section', () => {
    const markdown = [
      'The method is described in the body.',
      '',
      '# References',
      '[1] Yang F, Su Y. LiLa-WAM: Lightweight latent reasoning. arXiv, 2026.',
      '[2] Ren X, et al. MagicAgent: Towards generalized agent planning. 2026.',
      'Some trailing paragraph without a year here.',
    ].join('\n')
    const refs = extractReferences(markdown)
    expect(refs).toHaveLength(2)
    expect(refs[0]).toContain('LiLa-WAM')
    expect(refs[1]).toContain('MagicAgent')
  })

  it('returns empty when no reference section exists', () => {
    expect(extractReferences('Just some body text with 2026 dates inside.\n')).toEqual([])
  })

  it('stops at the next heading and bounds output', () => {
    const lines = ['# References']
    for (let i = 0; i < 60; i++) {
      lines.push(`[${i}] Author ${i}. Some cited work, 202${i % 10}.`)
    }
    const refs = extractReferences(lines.join('\n'), 40)
    expect(refs.length).toBeLessThanOrEqual(40)
  })

  it('handles an unnumbered plain References line (raw PDF text)', () => {
    const markdown = 'Body text.\n\nReferences\nSmith J. A paper title with a year 2020.\nMore body.'
    const refs = extractReferences(markdown)
    expect(refs).toContain('Smith J. A paper title with a year 2020.')
  })
})
