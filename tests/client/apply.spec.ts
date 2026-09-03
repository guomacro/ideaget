import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../../src/client/index.ts'
import { IdeagetView } from '../../src/client/components/IdeagetView.tsx'

interface Captured {
  name: string
  registration: object
  component: unknown
}

describe('ideaget client apply', () => {
  it('declares the slots service dependency', () => {
    expect(inject).toEqual(['slots'])
  })

  it('registers the ideaget conversation view target through slots', () => {
    const captured: Captured[] = []
    const fakeSlots = {
      inject(name: string, contribute: () => unknown): () => void {
        const registration = contribute() as object
        captured.push({ name, registration, component: (registration as { component?: unknown }).component ?? null })
        return () => {}
      },
      register(registration: object, component: unknown): object {
        return { ...registration, component }
      },
    }
    const ctx = { slots: fakeSlots } as unknown as Context
    apply(ctx)
    expect(captured).toHaveLength(1)
    expect(captured[0]!.name).toBe('conversation.view')
    const registration = captured[0]!.registration as { name: string; id: string; order: number }
    expect(registration.name).toBe('conversation.view')
    expect(registration.id).toBe('ideaget')
    expect(registration.order).toBe(70)
    expect(captured[0]!.component).toBe(IdeagetView)
  })
})
