// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdeagetStandaloneApp } from '../../src/client/components/IdeagetStandaloneApp.tsx'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('IdeagetStandaloneApp', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? new URL(input, 'http://localhost') : new URL(input instanceof URL ? input.href : String(input))
      if (url.pathname === '/ideaget/status') {
        return jsonResponse({ reachable: true, zoteroVersion: '10.0.1', writeMode: 'local-write' })
      }
      if (url.pathname === '/ideaget/papers') {
        return jsonResponse({
          items: [
            { ref: 'zotero://user/0/item/AAAA1111', title: 'LiLa-WAM', creators: 'F. Yang', year: '2026' },
            { ref: 'zotero://user/0/item/BBBB2222', title: 'MagicAgent', year: undefined },
          ],
          total: 2,
        })
      }
      return jsonResponse({ error: { message: 'not found' } })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
    vi.restoreAllMocks()
  })

  async function flush() {
    await act(async () => {
      await new Promise(resolve => setImmediate(resolve))
    })
  }

  it('renders the three workbench columns', async () => {
    act(() => { root.render(<IdeagetStandaloneApp />) })
    await flush()
    expect(container.querySelector('[data-testid="ideaget-workbench"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ideaget-zotero-rail"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ideaget-chat"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ideaget-ideas"]')).not.toBeNull()
  })

  it('loads and lists Zotero paper titles from the host route', async () => {
    act(() => { root.render(<IdeagetStandaloneApp />) })
    await flush()
    const list = container.querySelector('[data-testid="zotero-paper-list"]')
    expect(list?.textContent).toContain('LiLa-WAM')
    expect(list?.textContent).toContain('MagicAgent')
    expect(list?.textContent).toContain('2026')
    expect(container.textContent).toContain('已连接')
  })

  it('adds ideas locally on the right column', async () => {
    act(() => { root.render(<IdeagetStandaloneApp />) })
    await flush()
    const input = container.querySelector('input[aria-label="idea input"]') as HTMLInputElement
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === '添加')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '验证一个假设')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { button?.click() })
    await flush()
    expect(container.textContent).toContain('验证一个假设')
  })
})
