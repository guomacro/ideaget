/**
 * ideaget browser half: registers the `ideaget` conversation view target
 * (the three-pane research workbench) through the standard slots mechanism.
 * The slot declaration (`conversation.view`) and the `slots` service belong
 * to the host web composition at runtime; this entry only contributes.
 *
 * Typing note: the official client UI packages cannot be installed as
 * standalone devDependencies (their peer closure includes unpublished
 * workspace packages), so the `slots` service is typed here against minimal
 * local structural contracts. Runtime behavior is unchanged — the host web
 * tree provides the real service and slot declarations.
 *
 * Reserved ports (not wired yet, see docs/03-frontend-design.md): locale
 * dictionaries, the Plugins-tab settings card, and the Typert Remote status
 * namespace — the left rail's live data arrives through the view's inject
 * face once the host Remote is mounted.
 * @module ideaget/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { IdeagetView } from './components/IdeagetView.tsx'

export const inject = ['slots']

/** Structural slice of the host `slots` service this entry calls. */
export interface SlotsService {
  inject(name: string, contribute: () => unknown): () => void
  register(registration: object, component: unknown): unknown
}

/**
 * Mount the ideaget conversation view.
 * @param ctx - the browser plugin context (typed loosely; see module doc).
 */
export function apply(ctx: Context): void {
  const slots = (ctx as unknown as { slots: SlotsService }).slots
  slots.inject('conversation.view', () =>
    slots.register({
      name: 'conversation.view',
      id: 'ideaget',
      order: 70,
    }, IdeagetView))
}
