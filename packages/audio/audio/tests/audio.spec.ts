import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Audio, {
  AudioError,
  type AudioProvider,
  type AudioTranscribeRequest,
  type AudioTranscript,
} from '@deepseek-ai/dsh-audio'

/** A scripted provider that records every request it receives and returns a fixed transcript. */
function makeProvider(id: string, overrides: Partial<AudioProvider> = {}): AudioProvider & {
  seenRequests: AudioTranscribeRequest[]
  seenSignals: (AbortSignal | undefined)[]
} {
  const seenRequests: AudioTranscribeRequest[] = []
  const seenSignals: (AbortSignal | undefined)[] = []
  const transcript: AudioTranscript = { text: 'hello world', language: 'en', durationSec: 1.5 }
  return {
    id,
    seenRequests,
    seenSignals,
    transcribe(request, signal) {
      seenRequests.push(request)
      seenSignals.push(signal)
      return Promise.resolve(transcript)
    },
    ...overrides,
  }
}

/** Mount the audio seam on a fresh root context. */
async function mountAudio(): Promise<{ ctx: Context; audio: Audio }> {
  const ctx = new Context()
  await ctx.plugin(Audio)
  return { ctx, audio: ctx.audio as Audio }
}

describe('Audio registration', () => {
  it('fails AUDIO_UNAVAILABLE on the route when no provider is registered', async () => {
    const { audio } = await mountAudio()
    await expect(audio.transcribe({ data: new Uint8Array([1]) }))
      .rejects.toThrow(expect.objectContaining({ code: 'AUDIO_UNAVAILABLE' }))
  })

  it('routes transcribe to the reserved provider and releases on dispose', async () => {
    const { audio } = await mountAudio()
    const provider = makeProvider('p')
    const dispose = audio.registerProvider(provider)

    const request: AudioTranscribeRequest = { data: new Uint8Array([1, 2]), fileName: 'a.mp3' }
    await expect(audio.transcribe(request)).resolves.toEqual({ text: 'hello world', language: 'en', durationSec: 1.5 })
    expect(provider.seenRequests[0]).toBe(request)

    dispose()
    await expect(audio.transcribe({ data: new Uint8Array([1]) }))
      .rejects.toThrow(expect.objectContaining({ code: 'AUDIO_UNAVAILABLE' }))
  })

  it('forwards the abort signal verbatim to the provider', async () => {
    const { audio } = await mountAudio()
    const provider = makeProvider('p')
    audio.registerProvider(provider)
    const controller = new AbortController()
    await audio.transcribe({ data: new Uint8Array([1]) }, controller.signal)
    expect(provider.seenSignals[0]).toBe(controller.signal)
  })

  it('rejects an empty provider id (AUDIO_INVALID_PROVIDER) and reserves nothing', async () => {
    const { audio } = await mountAudio()
    expect(() => audio.registerProvider(makeProvider('  ')))
      .toThrow(expect.objectContaining({ code: 'AUDIO_INVALID_PROVIDER' }))
    await expect(audio.transcribe({ data: new Uint8Array([1]) }))
      .rejects.toThrow(expect.objectContaining({ code: 'AUDIO_UNAVAILABLE' }))
  })

  it('rejects a second provider while the seam is held (AUDIO_CONFLICT)', async () => {
    const { audio } = await mountAudio()
    audio.registerProvider(makeProvider('first'))
    expect(() => audio.registerProvider(makeProvider('second')))
      .toThrow(expect.objectContaining({ code: 'AUDIO_CONFLICT' }))
  })

  it('allows re-registration after dispose releases the reservation', async () => {
    const { audio } = await mountAudio()
    const dispose = audio.registerProvider(makeProvider('first'))
    dispose()
    expect(() => audio.registerProvider(makeProvider('second'))).not.toThrow()
  })

  it('disposes the reservation when the contributing fiber is disposed', async () => {
    const { ctx, audio } = await mountAudio()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.audio.registerProvider(makeProvider('p'))
    }, { inject: ['audio'] }))
    await expect(audio.transcribe({ data: new Uint8Array([1]) })).resolves.toEqual({ text: 'hello world', language: 'en', durationSec: 1.5 })
    await fiber.dispose()
    await expect(audio.transcribe({ data: new Uint8Array([1]) }))
      .rejects.toThrow(expect.objectContaining({ code: 'AUDIO_UNAVAILABLE' }))
  })

  it('AudioError carries its structured code', () => {
    expect(new AudioError('m', 'AUDIO_INVALID_REQUEST').code).toBe('AUDIO_INVALID_REQUEST')
  })
})
