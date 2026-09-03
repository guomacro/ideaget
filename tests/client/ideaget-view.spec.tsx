// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IdeagetView, type SourceRow } from '../../src/client/components/IdeagetView.tsx'

describe('IdeagetView', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
  })

  it('renders the three panes (rail / stream / details)', () => {
    act(() => { root.render(<IdeagetView />) })
    expect(container.querySelector('[data-testid="ideaget-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ideaget-rail"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ideaget-stream"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ideaget-details"]')).not.toBeNull()
  })

  it('shows the empty state when no sources are present', () => {
    act(() => { root.render(<IdeagetView />) })
    expect(container.textContent).toContain('还没有文献')
  })

  it('lists sources in the left rail', () => {
    const sources: SourceRow[] = [
      { ref: 'zotero://user/0/item/AAAA1111', title: 'LiLa-WAM', year: '2026' },
      { ref: 'zotero://user/0/item/BBBB2222', title: 'MagicAgent', year: undefined },
    ]
    act(() => { root.render(<IdeagetView sources={sources} />) })
    const rail = container.querySelector('[data-testid="ideaget-rail"]')
    expect(rail?.textContent).toContain('LiLa-WAM')
    expect(rail?.textContent).toContain('MagicAgent')
    expect(rail?.textContent).toContain('2026')
    expect(rail?.textContent).toContain('n.d.')
  })
})
