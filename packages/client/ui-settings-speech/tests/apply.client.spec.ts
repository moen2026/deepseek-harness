/** What the browser half registers, when a provider is cataloged, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { TtsReadiness } from '@deepseek-ai/dsh-client-ui-chat/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TtsCatalog } from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

/** One cataloged provider, as the synthesis Remote would report it. */
const PROVIDER_ID = 'kokoro-local' as TtsCatalog['providers'][number]['id']
const CATALOG: TtsCatalog = {
  providers: [{
    preparation: { phase: 'standby', steps: [] },
    id: PROVIDER_ID, name: 'Kokoro-82M (local)', location: 'host-local',
    voices: [{ id: 'zf_001', name: '晴岚' }],
  }],
  selection: { providerId: PROVIDER_ID, voiceId: 'zf_001', speed: 1 },
  maxTextChars: 4000,
  maxAudioBytes: 32 * 1024 * 1024,
  maxReferenceBytes: 16 * 1024 * 1024,
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('remote', { tts: { configure: vi.fn(async () => ({ ok: true as const, value: undefined })) } })
  ctx.provide('remote.tts', { configure: vi.fn(async () => ({ ok: true as const, value: undefined })) })
  const readiness = createSnapshotStore<TtsReadiness>({ catalog: null, connected: false, error: null })
  ctx.provide('readAloud', { readiness, speak: vi.fn(async () => vi.fn()) })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, readiness }
}

/** The Plugins page's item slot, as its owner declares it. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'plugins.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-speech apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'readAloud'])
  })

  it('registers the page while a provider is cataloged, titled in the active locale', async () => {
    const { ctx, slots, readiness } = await bench()
    declareRoot(slots)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    readiness.set({ catalog: CATALOG, connected: true, error: null })

    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const entry = slots.entries('plugins.item')[0]!
    expect(entry.options).toMatchObject({ id: 'speech', order: 45 })
    expect(resolveSlotLabel(entry.options.label)).toBe('语音')
    expect(entry.locale).toBe(NS)
    const face = (entry.inject as () => { hooks: { speechCard: unknown } })()
    expect(Object.keys(face.hooks)).toEqual(['speechCard'])

    // The page collapses again when the stream dies.
    readiness.set({ catalog: CATALOG, connected: false, error: null })
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(0) })

    await fiber.dispose()
  })

  it('registers nothing while no provider is cataloged', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(slots.entries('plugins.item')).toHaveLength(0)
    await fiber.dispose()
  })

  it('collapses the page on teardown', async () => {
    const { ctx, slots, readiness } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    readiness.set({ catalog: CATALOG, connected: true, error: null })
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })

    await fiber.dispose()

    expect(slots.entries('plugins.item')).toHaveLength(0)
  })
})
