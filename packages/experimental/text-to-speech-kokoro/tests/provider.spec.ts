/** Provider activation remains lazy and rejects relative deployment paths. */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import TextToSpeech from '@deepseek-ai/dsh-experimental-text-to-speech'
import { afterEach, expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'
import { KokoroWorker } from '../src/provider.ts'

afterEach(() => { vi.restoreAllMocks() })

it('registers lazily and joins synthesis before withdrawal completes', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(TextToSpeech, { defaultProvider: 'kokoro-local', voiceId: 'zf_001', speed: 1 })
    const synthesize = vi.spyOn(KokoroWorker.prototype, 'synthesize')
    const fiber = ctx.plugin(Provider, { dataRoot: process.cwd() })
    await fiber
    expect(synthesize).not.toHaveBeenCalled()
    const speech = ctx.get('textToSpeech')!
    expect(speech.listProviders()).toMatchObject([{ id: 'kokoro-local', location: 'host-local' }])
    expect(speech.listProviders()[0]?.voices?.length).toBeGreaterThan(50)
    expect(speech.listProviders()[0]?.voices?.[0]).toMatchObject({ id: 'af_maple' })
    expect(speech.listProviders()[0]?.setupEstimate).toEqual({
      recommendedDiskBytes: 800_000_000, expectedMemoryBytes: 600_000_000,
      minimumMinutes: 2, maximumMinutes: 15,
    })
    await expect(speech.synthesize(speech.resolve({ text: '你好' }), new AbortController().signal)).rejects.toThrow('Prepare')
    synthesize.mockResolvedValue({ audio: new Uint8Array(52), sampleRate: 24000 })
    expect((await speech.synthesize(speech.resolve({ text: '你好' }), new AbortController().signal)).sampleRate).toBe(24000)
    await fiber.dispose()
    expect(speech.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})

it('refuses relative runtime, model and cache paths before registration', () => {
  for (const field of ['dataRoot', 'modelDirectory', 'espeakDataDir']) {
    expect(() => { Provider.apply(new Context(), Provider.Config({ dataRoot: process.cwd(), [field]: 'relative' })) })
      .toThrow('absolute')
  }
  expect(() => Provider.Config({ dataRoot: process.cwd(), threads: 0 })).toThrow()
})

it.each([
  { modelOrigins: [] }, { modelOrigins: ['https://user:secret@example.com'] },
  { modelOrigin: 'file:///models' }, { modelProbeTimeoutMs: 0 }, { modelProbeTimeoutMs: 2_147_483_648 },
  { voice: 'zf_001 ' }, { speed: 0.4 }, { maxPending: 0 }, { providerId: '' },
])('rejects invalid deployment configuration %j', (config) => {
  expect(() => Provider.Config({ dataRoot: process.cwd(), ...config })).toThrow()
})
