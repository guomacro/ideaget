import { describe, expect, it } from 'vitest'
import {
  abstractOf,
  creatorsText,
  keywordsOf,
  parseRef,
  tagsOf,
  titleOf,
  yearOf,
  type ZoteroItemData,
} from '../src/zotero/model.js'

const baseData: ZoteroItemData = {
  key: 'ABCD1234',
  itemType: 'journalArticle',
  title: 'A Paper',
}

describe('parseRef', () => {
  it('accepts zotero:// refs and bare keys', () => {
    expect(parseRef('zotero://user/0/item/58YFQJWK')).toBe('58YFQJWK')
    expect(parseRef('zotero://group/123/item/58YFQJWK')).toBe('58YFQJWK')
    expect(parseRef('58YFQJWK')).toBe('58YFQJWK')
  })
  it('rejects malformed refs', () => {
    expect(() => parseRef('nonsense')).toThrow()
    expect(() => parseRef('zotero://user/0/item/short')).toThrow()
  })
})

describe('field helpers', () => {
  it('renders creators with initials', () => {
    const data: ZoteroItemData = {
      ...baseData,
      creators: [
        { creatorType: 'author', firstName: 'F.', lastName: 'Yang' },
        { creatorType: 'author', name: 'Collective' },
      ],
    }
    expect(creatorsText(data)).toBe('F. Yang, Collective')
  })
  it('extracts the year from Zotero dates', () => {
    expect(yearOf('2026-08-04')).toBe('2026')
    expect(yearOf('4 Aug 2026')).toBe('2026')
    expect(yearOf(undefined)).toBe('')
  })
  it('reads tags, abstract, and title fallback', () => {
    const data: ZoteroItemData = {
      ...baseData,
      tags: [{ tag: 'cs.RO' }],
      abstractNote: 'the abstract',
    }
    expect(tagsOf(data)).toEqual(['cs.RO'])
    expect(abstractOf(data)).toBe('the abstract')
    expect(titleOf({ itemType: 'note' })).toBe('[untitled note]')
  })
  it('parses Keywords lines from extra and falls back to tags', () => {
    const withExtra: ZoteroItemData = {
      ...baseData,
      extra: 'arXiv:2608.03701\nKeywords: robotics, latent reasoning; world models',
    }
    expect(keywordsOf(withExtra)).toEqual(['robotics', 'latent reasoning', 'world models'])
    expect(keywordsOf({ ...baseData, tags: [{ tag: 'cs.RO' }] })).toEqual(['cs.RO'])
  })
})
