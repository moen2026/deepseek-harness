/** The speech page's mirror: catalog folding, immediate writes, preview playback, teardown. */

import { describe, expect, it, vi } from 'vitest'
import type { TtsCatalog } from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import type { ReadAloudEngine, TtsReadiness } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import { SpeechCardController } from '../src/client/speech-card-controller.ts'

const CATALOG: TtsCatalog = {
  providers: [
    {
      preparation: { phase: 'standby', steps: [] },
      id: 'kokoro-local', name: 'Kokoro-82M (local)', location: 'host-local',
      voices: [{ id: 'zf_001', name: '晴岚' }, { id: 'zm_009', name: '云舟' }],
    },
    {
      preparation: { phase: 'ready' },
      id: 'openvoice-local', name: 'OpenVoice v2 (local)', location: 'host-local',
      voices: [{ id: 'demo', name: 'demo' }],
      intake: { accept: ['audio/wav', 'audio/flac'], maxBytes: 1024 },
    },
  ],
  selection: { providerId: 'kokoro-local', voiceId: 'zf_001', speed: 1 },
  maxTextChars: 4000,
  maxAudioBytes: 32 * 1024 * 1024,
} as never

/** The same catalog with the recording-accepting provider selected. */
const INTAKE_CATALOG = { ...CATALOG, selection: { providerId: 'openvoice-local', voiceId: 'demo', speed: 1 } } as never

/** Bind a fake `ctx.inject` that resolves each requested service from the context itself. */
function captureInject(ctx: object): void {
  (ctx as { inject: unknown }).inject = (names: readonly string[], resolve: (scope: unknown) => void) => {
    expect(names).toEqual(['remote.tts'])
    resolve(ctx)
    return { dispose: async () => undefined }
  }
}

/** The card plugin's context: one fresh Chat-provided readAloud service per test. */
function ctxWith() {
  const readiness = createSnapshotStore<TtsReadiness>({ catalog: null, connected: false, error: null })
  const engine = createSnapshotStore<ReadAloudEngine>('remote')
  const speak = vi.fn(async () => vi.fn())
  const speakBrowser = vi.fn((_text: string, _onEnd: () => void) => vi.fn())
  const ctx = {
    remote: {
      tts: {
        configure: vi.fn(() => Promise.resolve({ ok: true })),
        intakeVoice: vi.fn(async () => ({ ok: true as const, value: { id: 'cloned', name: 'cloned' } })),
      },
    },
    readAloud: { readiness, engine, speak, speakBrowser },
  } as never
  captureInject(ctx)
  return { ctx, readiness, engine, speak, speakBrowser }
}

describe('SpeechCardController', () => {
  it('folds the catalog into the page projection', () => {
    const { ctx, readiness } = ctxWith()
    const controller = new SpeechCardController(ctx)
    readiness.set({ catalog: CATALOG, connected: true, error: null })

    expect(controller.store.getSnapshot()).toEqual({
      connected: true,
      providers: [
        {
          id: 'kokoro-local', name: 'Kokoro-82M (local)',
          voices: [{ id: 'zf_001', name: '晴岚' }, { id: 'zm_009', name: '云舟' }],
          intake: null,
        },
        {
          id: 'openvoice-local', name: 'OpenVoice v2 (local)',
          voices: [{ id: 'demo', name: 'demo' }],
          intake: { accept: ['audio/wav', 'audio/flac'], maxBytes: 1024 },
        },
      ],
      engine: 'remote',
      providerId: 'kokoro-local',
      voiceId: 'zf_001',
      speed: 1,
      previewing: false,
      uploading: false,
      error: null,
    })
    controller.dispose()
  })

  it('keeps the empty projection while no catalog has arrived', () => {
    const { ctx } = ctxWith()
    const controller = new SpeechCardController(ctx)

    expect(controller.store.getSnapshot()).toMatchObject({ connected: false, providers: [], providerId: null })
    controller.dispose()
  })

  it('applies a selection change through the Remote namespace', async () => {
    const { ctx } = ctxWith() as { ctx: { remote: { tts: { configure: ReturnType<typeof vi.fn> } } } }
    const controller = new SpeechCardController(ctx as never)

    await controller.configure({ voiceId: 'zm_009' })

    expect(ctx.remote.tts.configure).toHaveBeenCalledWith({ voiceId: 'zm_009' })
    controller.dispose()
  })

  it('resolves a voice the new provider catalogs when switching providers', async () => {
    const { ctx, readiness } = ctxWith() as {
      ctx: { remote: { tts: { configure: ReturnType<typeof vi.fn> } } }
      readiness: SnapshotStore<TtsReadiness>
    }
    const controller = new SpeechCardController(ctx as never)
    readiness.set({ catalog: CATALOG, connected: true, error: null })

    await controller.configure({ providerId: 'openvoice-local' })

    expect(ctx.remote.tts.configure).toHaveBeenCalledWith({ providerId: 'openvoice-local', voiceId: 'demo' })
    expect(controller.store.getSnapshot()).toMatchObject({
      providerId: 'openvoice-local', voiceId: 'demo', speed: 1, error: null,
    })
    controller.dispose()
  })

  it('switches to the browser engine without a Host write', async () => {
    const { ctx, engine } = ctxWith() as {
      ctx: { remote: { tts: { configure: ReturnType<typeof vi.fn> } } }
      engine: SnapshotStore<ReadAloudEngine>
    }
    const controller = new SpeechCardController(ctx as never)

    await controller.configure({ providerId: 'browser' })

    expect(engine.getSnapshot()).toBe('browser')
    expect(ctx.remote.tts.configure).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toMatchObject({ engine: 'browser', error: null })
    controller.dispose()
  })

  it('returns to Host synthesis when a provider is chosen again', async () => {
    const { ctx, engine, readiness } = ctxWith() as {
      ctx: { remote: { tts: { configure: ReturnType<typeof vi.fn> } } }
      engine: SnapshotStore<ReadAloudEngine>
      readiness: SnapshotStore<TtsReadiness>
    }
    const controller = new SpeechCardController(ctx as never)
    readiness.set({ catalog: CATALOG, connected: true, error: null })

    await controller.configure({ providerId: 'browser' })
    await controller.configure({ providerId: 'openvoice-local' })

    expect(engine.getSnapshot()).toBe('remote')
    expect(ctx.remote.tts.configure).toHaveBeenCalledWith({ providerId: 'openvoice-local', voiceId: 'demo' })
    expect(controller.store.getSnapshot()).toMatchObject({ engine: 'remote', providerId: 'openvoice-local', voiceId: 'demo' })
    controller.dispose()
  })

  it('keeps the current voice when the new provider catalogs it and passes an unknown target through', async () => {
    const { ctx, readiness } = ctxWith() as {
      ctx: { remote: { tts: { configure: ReturnType<typeof vi.fn> } } }
      readiness: SnapshotStore<TtsReadiness>
    }
    const controller = new SpeechCardController(ctx as never)
    readiness.set({ catalog: CATALOG, connected: true, error: null })

    await controller.configure({ providerId: 'kokoro-local' })
    expect(ctx.remote.tts.configure).toHaveBeenCalledWith({ providerId: 'kokoro-local', voiceId: 'zf_001' })

    await controller.configure({ providerId: 'missing' })
    expect(ctx.remote.tts.configure).toHaveBeenLastCalledWith({ providerId: 'missing' })
    controller.dispose()
  })

  it('records a rejected write instead of throwing', async () => {
    const ctx = {
      remote: { tts: { configure: vi.fn(async () => ({ ok: false as const, error: new RemoteError('gateway/internal', 'speech provider is unavailable', undefined as never) })) } },
      readAloud: {
        readiness: createSnapshotStore({ catalog: null, connected: false, error: null }),
        engine: createSnapshotStore<ReadAloudEngine>('remote'), speak: vi.fn(), speakBrowser: vi.fn(),
      },
    } as never
    captureInject(ctx)
    const controller = new SpeechCardController(ctx)

    await controller.configure({ speed: 1.5 })

    expect(controller.store.getSnapshot().error).toBe('speech provider is unavailable')
    controller.dispose()
  })

  it('plays a preview through the Chat plugin and stops it on dispose', async () => {
    const cancel = vi.fn()
    const { ctx, speak } = ctxWith()
    speak.mockImplementation(async () => cancel)
    const controller = new SpeechCardController(ctx)
    const state = (): { previewing: boolean } => controller.store.getSnapshot()

    const running = controller.preview()
    expect(state().previewing).toBe(true)
    await running
    expect(speak).toHaveBeenCalledOnce()
    expect(state().previewing).toBe(true)
    controller.dispose()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('previews through the browser engine and cancels it on dispose', async () => {
    const cancelPlay = vi.fn()
    const { ctx, engine, speak, speakBrowser } = ctxWith()
    speakBrowser.mockReturnValue(cancelPlay)
    const controller = new SpeechCardController(ctx)
    engine.set('browser')
    const state = (): { previewing: boolean } => controller.store.getSnapshot()

    await controller.preview()
    expect(speakBrowser).toHaveBeenCalledWith('你好，这是当前语音的试听。', expect.any(Function))
    expect(speak).not.toHaveBeenCalled()
    expect(state().previewing).toBe(true)

    const settle = speakBrowser.mock.calls[0]![1]
    settle()
    expect(state().previewing).toBe(false)

    await controller.preview()
    controller.dispose()
    expect(cancelPlay).toHaveBeenCalledOnce()
  })

  it('records a failed preview without throwing', async () => {
    const { ctx, speak } = ctxWith()
    speak.mockRejectedValue(new Error('tts/synthesis-failed'))
    const controller = new SpeechCardController(ctx)

    await controller.preview()

    expect(controller.store.getSnapshot().error).toBe('tts/synthesis-failed')
    controller.dispose()
  })

  it('stores a picked recording through the selected provider and selects the stored voice', async () => {
    const { ctx, readiness } = ctxWith() as {
      ctx: { remote: { tts: { configure: ReturnType<typeof vi.fn>; intakeVoice: ReturnType<typeof vi.fn> } } }
      readiness: SnapshotStore<TtsReadiness>
    }
    const controller = new SpeechCardController(ctx as never)
    readiness.set({ catalog: INTAKE_CATALOG, connected: true, error: null })
    const audio = new Uint8Array([1, 2, 3, 4])

    await controller.upload(new File([audio], '我的录音.wav'))

    expect(ctx.remote.tts.intakeVoice).toHaveBeenCalledWith(
      { providerId: 'openvoice-local', voiceId: '我的录音', audioBase64: bytesToBase64(audio) },
      expect.any(AbortSignal),
    )
    expect(ctx.remote.tts.configure).toHaveBeenCalledWith({ voiceId: 'cloned' })
    expect(controller.store.getSnapshot()).toMatchObject({ uploading: false, error: null, voiceId: 'cloned' })
    controller.dispose()
  })

  it('refuses a recording the selected provider cannot accept', async () => {
    const { ctx, readiness } = ctxWith() as {
      ctx: { remote: { tts: { configure: ReturnType<typeof vi.fn>; intakeVoice: ReturnType<typeof vi.fn> } } }
      readiness: SnapshotStore<TtsReadiness>
    }
    const controller = new SpeechCardController(ctx as never)
    readiness.set({ catalog: CATALOG, connected: true, error: null })

    await controller.upload(new File([new Uint8Array([1])], 'clip.wav'))
    expect(controller.store.getSnapshot().error).toBe('The selected provider does not accept recordings')

    readiness.set({ catalog: INTAKE_CATALOG, connected: true, error: null })
    await controller.upload(new File([new Uint8Array(1025)], 'big.wav'))
    expect(controller.store.getSnapshot().error).toBe('The recording exceeds the 1024 byte limit')
    expect(ctx.remote.tts.intakeVoice).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('records an intake rejection without selecting the voice', async () => {
    const { ctx, readiness } = ctxWith() as {
      ctx: { remote: { tts: { configure: ReturnType<typeof vi.fn>; intakeVoice: ReturnType<typeof vi.fn> } } }
      readiness: SnapshotStore<TtsReadiness>
    }
    const controller = new SpeechCardController(ctx as never)
    readiness.set({ catalog: INTAKE_CATALOG, connected: true, error: null })
    ctx.remote.tts.intakeVoice.mockResolvedValueOnce({
      ok: false, error: new RemoteError('tts/intake-failed', 'disk full', undefined as never),
    })

    await controller.upload(new File([new Uint8Array([1, 2])], 'clip.wav'))

    expect(controller.store.getSnapshot().error).toBe('disk full')
    expect(ctx.remote.tts.configure).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('injects the actions and the bound snapshot store', () => {
    const { ctx } = ctxWith()
    const controller = new SpeechCardController(ctx)
    const face = controller.inject()

    expect(Object.keys(face.actions).sort()).toEqual(['configure', 'preview', 'upload'])
    expect(face.hooks.speechCard).toBe(controller.store)
    controller.dispose()
  })
})
