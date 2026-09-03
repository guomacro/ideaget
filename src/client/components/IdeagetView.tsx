/**
 * IdeagetView: the three-pane research workbench inside the conversation area
 * (a `conversation.view` target named `ideaget`):
 *
 *   左栏 来源/想法 rail · 中栏 对话/任务流 · 右栏 证据与详情
 *
 * Pure presentation today: sources arrive through the inject face (reserved
 * host Remote port, see docs/03-frontend-design.md); the middle pane stays a
 * stream placeholder until the agent/task ports land. Components never touch
 * Cordis ctx — data and callbacks come through props.
 * @module ideaget/client/components/IdeagetView
 */

import type { CSSProperties } from 'react'

export interface SourceRow {
  ref: string
  title: string
  year?: string
}

export interface IdeagetViewProps {
  /** Session-accumulated sources for the left rail. */
  sources?: SourceRow[]
}

const regionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', padding: '8px', overflowY: 'auto' }

export function IdeagetView({ sources = [] }: IdeagetViewProps) {
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }} data-testid="ideaget-view">
      <aside data-testid="ideaget-rail" style={{ ...regionStyle, width: 240, borderRight: '1px solid var(--dsw-border, #ddd)' }}>
        <h3 style={{ margin: '4px 0' }}>来源 / Ideas</h3>
        {sources.length === 0 ? (
          <p style={{ color: '#888', fontSize: 13 }}>
            还没有文献。Agent 搜索 Zotero 后，结果会累积在这里。
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {sources.map((source) => (
              <li key={source.ref} style={{ padding: '6px 0', borderBottom: '1px solid var(--dsw-border, #eee)' }}>
                <div style={{ fontWeight: 600 }}>{source.title}</div>
                <div style={{ color: '#888', fontSize: 12 }}>{source.year ?? 'n.d.'} · {source.ref}</div>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main data-testid="ideaget-stream" style={{ ...regionStyle, flex: 1 }}>
        <p style={{ color: '#888' }}>
          对话/任务流区域——消息与任务卡片将在此渲染（agent 端口保留中）。
        </p>
      </main>
      <aside data-testid="ideaget-details" style={{ ...regionStyle, width: 320, borderLeft: '1px solid var(--dsw-border, #ddd)' }}>
        <h3 style={{ margin: '4px 0' }}>证据与详情</h3>
        <p style={{ color: '#888', fontSize: 13 }}>
          选中来源后显示元数据、摘要、证据段落与关键词。
        </p>
      </aside>
    </div>
  )
}
