/**
 * IdeagetStandaloneApp: the ideaget workbench — a full-viewport replacement
 * UI mounted into the top-level `shell.overlay` list slot (additive, no
 * official conflicts). It intentionally does NOT talk to the official
 * session/conversation machinery: sessions are not synced, and the middle /
 * right columns are front-end scaffolds (agent + backend reserved ports).
 *
 *   ┌ header: ideaget · Zotero status · [返回官方] ┐
 *   ├───────────┬──────────────────────┬───────────┤
 *   │ 左：Zotero │ 中：对话（占位）      │ 右：想法   │
 *   │ 论文标题   │                      │ 构建       │
 *   └───────────┴──────────────────────┴───────────┘
 *
 * The left rail talks to the host over the read-only Web JSON route
 * `/ideaget` (status + papers) registered by the host half.
 * @module ideaget/client/components/IdeagetStandaloneApp
 */

import { useEffect, useState, type CSSProperties } from 'react'

export interface PaperRow {
  ref: string
  title: string
  creators?: string
  year?: string
  itemType?: string
}

export interface ZoteroStatusRow {
  reachable: boolean
  zoteroVersion?: string
  writeMode?: string
  diagnosis?: string
}

const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 48,
  borderBottom: '1px solid var(--dsw-border, #e2e2e6)', background: 'var(--dsw-bg-header, #fafafa)',
}
const columnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 }

export function IdeagetStandaloneApp() {
  const [status, setStatus] = useState<ZoteroStatusRow | null>(null)
  const [papers, setPapers] = useState<PaperRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [ideas, setIdeas] = useState<string[]>([])
  const [ideaDraft, setIdeaDraft] = useState('')

  const loadPapers = async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/ideaget/papers?q=${encodeURIComponent(q)}&limit=30`)
      if (!response.ok) throw new Error(`papers endpoint returned ${response.status}`)
      const payload = (await response.json()) as { items?: PaperRow[] }
      setPapers(payload.items ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/ideaget/status')
        if (response.ok) setStatus((await response.json()) as ZoteroStatusRow)
      } catch {
        setStatus({ reachable: false, diagnosis: 'status endpoint unavailable' })
      }
    })()
    void loadPapers('')
    return () => {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitSearch = () => void loadPapers(query)
  const addIdea = () => {
    const draft = ideaDraft.trim()
    if (draft === '') return
    setIdeas(current => [...current, draft])
    setIdeaDraft('')
  }

  if (hidden) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column',
      background: 'var(--dsw-bg, #ffffff)', color: 'var(--dsw-text, #1a1a1a)',
    }} data-testid="ideaget-workbench">
      <header style={headerStyle}>
        <strong>ideaget</strong>
        <span style={{ fontSize: 13, color: '#888' }}>
          Zotero: {status === null ? '检测中…' : status.reachable ? `已连接 ${status.zoteroVersion ?? ''}` : `未连接 ${status.diagnosis ?? ''}`}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setHidden(true)}>返回官方 UI</button>
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <aside data-testid="ideaget-zotero-rail" style={{ ...columnStyle, width: 320, borderRight: '1px solid var(--dsw-border, #eee)' }}>
          <div style={{ padding: 8 }}>
            <h3 style={{ margin: '4px 0' }}>Zotero 论文</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') submitSearch() }}
                placeholder="搜索标题 / 作者 / 全文…"
                style={{ flex: 1 }}
                data-testid="zotero-search-input"
              />
              <button type="button" onClick={submitSearch} disabled={loading}>搜索</button>
            </div>
            {error !== null && <p style={{ color: '#b3261e', fontSize: 12 }}>{error}</p>}
          </div>
          <ul data-testid="zotero-paper-list" style={{ listStyle: 'none', margin: 0, padding: '0 8px' }}>
            {papers.length === 0 && !loading && <li style={{ color: '#999', fontSize: 13 }}>没有论文标题（Zotero 未连接或库为空）</li>}
            {papers.map(paper => (
              <li key={paper.ref} style={{ padding: '8px 0', borderBottom: '1px solid var(--dsw-border, #f0f0f0)' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{paper.title}</div>
                <div style={{ color: '#888', fontSize: 12 }}>{paper.year ?? 'n.d.'} · {paper.creators ?? ''}</div>
              </li>
            ))}
          </ul>
        </aside>
        <main data-testid="ideaget-chat" style={{ ...columnStyle, flex: 1, padding: 16 }}>
          <h3 style={{ margin: '0 0 8px' }}>对话</h3>
          <div style={{ flex: 1, border: '1px dashed var(--dsw-border, #ccc)', borderRadius: 6, padding: 12, color: '#777' }}>
            对话/任务流区域（前端占位；agent 端口保留，未接入后端）
          </div>
          <textarea
            placeholder="输入消息…（未接入，先不发送）"
            rows={3}
            style={{ marginTop: 8, resize: 'none' }}
            aria-label="chat input placeholder"
          />
        </main>
        <aside data-testid="ideaget-ideas" style={{ ...columnStyle, width: 320, borderLeft: '1px solid var(--dsw-border, #eee)', padding: 12 }}>
          <h3 style={{ margin: '4px 0' }}>想法构建</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={ideaDraft}
              onChange={event => setIdeaDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') addIdea() }}
              placeholder="记录一个想法…"
              style={{ flex: 1 }}
              aria-label="idea input"
            />
            <button type="button" onClick={addIdea}>添加</button>
          </div>
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
            {ideas.map((idea, index) => <li key={index} style={{ padding: '6px 0', borderBottom: '1px solid var(--dsw-border, #f0f0f0)' }}>{idea}</li>)}
          </ul>
        </aside>
      </div>
    </div>
  )
}
