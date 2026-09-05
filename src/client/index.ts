/**
 * ideaget browser half: mounts the standalone ideaget workbench — a
 * full-viewport replacement UI (left Zotero papers / middle chat / right
 * ideas) — into the top-level `shell.overlay` slot. It is deliberately
 * independent: no official session/conversation sync; the middle and right
 * columns are front-end scaffolds until the agent/backend ports land.
 *
 * The left rail's Zotero data comes from the host Web JSON route `/ideaget`
 * (registered by the host half). Typing note: the official client UI slot
 * packages cannot be installed standalone (unpublished peer closure), so the
 * `slots` service is typed structurally here — runtime behavior is unchanged.
 * @module ideaget/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { IdeagetStandaloneApp } from './components/IdeagetStandaloneApp.tsx'

export const inject = ['slots']

/** Structural slice of the host `slots` service this entry calls. */
export interface SlotsService {
  inject(name: string, contribute: () => unknown): () => void
  register(registration: object, component: unknown): unknown
}

/**
 * Mount the ideaget workbench overlay.
 * @param ctx - the browser plugin context (typed loosely; see module doc).
 */
export function apply(ctx: Context): void {
  const slots = (ctx as unknown as { slots: SlotsService }).slots
  slots.inject('shell.overlay', () =>
    slots.register({
      name: 'shell.overlay',
      id: 'ideaget-workbench',
      order: 1000,
    }, IdeagetStandaloneApp))
}
