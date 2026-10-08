/** Authenticated synthesis domain methods validate text before selecting a synthesizer. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import TextToSpeech from '@deepseek-ai/dsh-experimental-text-to-speech'
import type { TtsProviderId } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import TtsController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })
const id = 'kokoro-local' as TtsProviderId
function wav(): Uint8Array {
  const b = Buffer.alloc(52)
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(24000, 28); b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(8, 40)
  return new Uint8Array(b)
}
function fixture(maxTextChars = 10, maxAudioBytes = 64, maxReferenceBytes = 16 * 1024 * 1024) {
  const ctx = new Context(); roots.push(ctx)
  const tts = new TextToSpeech(ctx, TextToSpeech.Config({ defaultProvider: id, voiceId: 'zf_001', speed: 1 }))
  const synthesize = vi.fn(async () => ({ audio: wav(), sampleRate: 24000 }))
  const intake = vi.fn(async (voice: { voiceId: string }) => ({ id: voice.voiceId, name: voice.voiceId }))
  tts.register({
    info: { id, name: 'test', location: 'host-local', voices: [{ id: 'zf_001', name: '晴岚' }] }, synthesize, intake,
  })
  return { api: new TtsController(ctx, { maxTextChars, maxAudioBytes, maxReferenceBytes }), synthesize, intake }
}

it('lists limits without synthesis and resolves composition defaults', async () => {
  const { api, synthesize } = fixture()
  expect(api.catalog()).toMatchObject({ selection: { providerId: id, voiceId: 'zf_001' }, maxTextChars: 10, providers: [{ id }] })
  expect(synthesize).not.toHaveBeenCalled()
  api.prepare(id)
  await api.cancelPreparation(id)
  const lifetime = new AbortController(), observation = api.follow(lifetime.signal)[Symbol.asyncIterator]()
  expect((await observation.next()).value).toMatchObject({ providers: [{ id, preparation: { phase: 'ready' } }] })
  lifetime.abort(); await observation.next()
  expect(await api.synthesize({ text: '你好', providerId: id }, new AbortController().signal)).toMatchObject({ sampleRate: 24000 })
  expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'zf_001', speed: 1 }), expect.any(AbortSignal))
})

it('forwards an explicit download source to the registered preparation owner', async () => {
  const ctx = new Context(); roots.push(ctx)
  const tts = new TextToSpeech(ctx, TextToSpeech.Config({ defaultProvider: id }))
  const prepare = vi.fn()
  tts.register({ info: { id, name: 'local', location: 'host-local', voices: [{ id: 'zf_001', name: '晴岚' }], downloadSources: ['https://github.com'] },
    preparation: { snapshot: () => ({ phase: 'unprepared' }), subscribe: () => () => {}, prepare, cancel: async () => {} },
    synthesize: async () => ({ audio: wav(), sampleRate: 24000 }),
  })
  const api = new TtsController(ctx, { maxTextChars: 10, maxAudioBytes: 64, maxReferenceBytes: 1024 })
  expect(api.catalog().providers[0]?.downloadSources).toEqual(['https://github.com'])
  api.prepare(id, { downloadSource: 'https://github.com' })
  expect(prepare).toHaveBeenCalledWith({ downloadSource: 'https://github.com' })
})

it('rejects oversized text without synthesis', async () => {
  const { api, synthesize } = fixture()
  await expect(api.synthesize({ text: 'x'.repeat(11) }, new AbortController().signal)).rejects.toThrow('character limit')
  expect(synthesize).not.toHaveBeenCalled()
})

it('preserves cancellation and reports synthesizer failures', async () => {
  const { api, synthesize } = fixture()
  await expect(api.configure({ voiceId: 'zm_009' })).rejects.toThrow('settings service')
  await expect(api.synthesize({ text: '你好' }, AbortSignal.abort(new Error('cancel')))).rejects.toThrow('cancel')
  synthesize.mockRejectedValueOnce(new Error('offline'))
  await expect(api.synthesize({ text: '你好' }, new AbortController().signal)).rejects.toMatchObject({ code: 'tts/synthesis-failed', message: 'offline' })
  synthesize.mockRejectedValueOnce('failed')
  await expect(api.synthesize({ text: '你好' }, new AbortController().signal)).rejects.toMatchObject({ message: 'failed' })
  expect(synthesize).toHaveBeenCalledTimes(2)
})

it('enforces the encoded audio byte limit on provider results', async () => {
  const { api, synthesize } = fixture(10, 44)
  await expect(api.synthesize({ text: '你好' }, new AbortController().signal)).rejects.toThrow('byte limit')
  expect(synthesize).toHaveBeenCalledTimes(1)
})

it('stores an accepted recording and refuses oversized or malformed payloads', async () => {
  const { api, intake } = fixture(10, 64, 8)
  const signal = new AbortController().signal
  const audio = Buffer.from('voice')

  await expect(api.intakeVoice({ providerId: id, voiceId: 'cloned', audioBase64: audio.toString('base64') }, signal))
    .resolves.toEqual({ id: 'cloned', name: 'cloned' })
  expect(intake).toHaveBeenCalledWith({ voiceId: 'cloned', audio }, expect.any(AbortSignal))

  await expect(api.intakeVoice({ providerId: id, voiceId: 'cloned', audioBase64: 'dm9pY2U' }, signal))
    .rejects.toMatchObject({ code: 'tts/intake-failed', message: 'Recording must use canonical base64 encoding' })
  await expect(api.intakeVoice({ providerId: id, voiceId: 'cloned', audioBase64: Buffer.alloc(9).toString('base64') }, signal))
    .rejects.toMatchObject({ code: 'tts/intake-failed', message: 'Recording exceeds the configured byte limit' })
  await expect(api.intakeVoice({ providerId: id, voiceId: 'cloned', audioBase64: Buffer.alloc(11).toString('base64') }, signal))
    .rejects.toMatchObject({ code: 'tts/invalid-recording' })
  expect(intake).toHaveBeenCalledTimes(1)
})

it('reports provider intake failures and preserves cancellation', async () => {
  const { api, intake } = fixture()
  intake.mockRejectedValueOnce(new Error('disk full'))

  await expect(api.intakeVoice({ providerId: id, voiceId: 'cloned', audioBase64: 'YQ==' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'tts/intake-failed', message: 'disk full' })
  await expect(api.intakeVoice({ providerId: id, voiceId: 'cloned', audioBase64: 'YQ==' }, AbortSignal.abort(new Error('cancel'))))
    .rejects.toThrow('cancel')
})
