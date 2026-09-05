/**
 * Public canonical views returned by IdeagetService methods and the tools —
 * also the wire contract the future client will mount over Typert Remote.
 * Optionality mirrors the tool output schemas so one shape satisfies both.
 * @module ideaget/types
 */

export interface ZoteroStatusView {
  reachable: boolean
  diagnosis?: string
  zoteroVersion?: string
  apiVersion?: string
  schemaVersion?: string
  serverId?: string
  writeMode: 'local-write' | 'readonly'
}

export interface SearchItemView {
  ref: string
  title: string
  creators?: string
  year?: string
  itemType: string
  attachmentType?: string
}

export interface SearchResultView {
  query: string
  qmode: string
  total: number
  items: SearchItemView[]
}

export interface NoteView {
  ref: string
  title: string
  text: string
  truncated: boolean
}

export interface AttachmentView {
  ref: string
  title: string
  contentType?: string
  linkMode?: string
  path?: string
}

export interface GetResultView {
  ref: string
  title: string
  creators: string
  year?: string
  itemType: string
  doi?: string
  abstract?: string
  keywords: string[]
  tags: string[]
  notes?: NoteView[]
  attachments?: AttachmentView[]
  numChildren?: number
}

export interface PaperMarkdownView {
  markdown: string
  title: string
  creators?: string
  year?: string
  abstract?: string
  keywords?: string[]
  doi?: string
  pages: number
  chars: number
  truncated: boolean
  attachmentName?: string
}

export interface CollectionSummaryView {
  ref: string
  name: string
  numItems?: number
}

export interface CollectionPaperView {
  ref: string
  title: string
  creators?: string
  year?: string
  itemType: string
  doi?: string
  abstract?: string
  keywords?: string[]
  references?: string[]
  body?: string
  bodyTruncated?: boolean
  /** Per-paper pipeline error (other papers still return). */
  error?: string
}

export interface CollectionReadResultView {
  collection: CollectionSummaryView
  total: number
  offset: number
  items: CollectionPaperView[]
}
