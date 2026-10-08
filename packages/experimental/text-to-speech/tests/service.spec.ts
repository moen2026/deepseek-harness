/** Provider routing, cancellation, and fiber-owned registration lifetimes for synthesis. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import TextToSpeech from '../src/index.ts'
import type { TtsPreparationState, TtsProvider, TtsProviderId, TtsSynthesis, TtsVoiceInfo, TtsVoiceIntake } from '../src/types.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const result: TtsSynthesis = { audio: new Uint8Array([1, 2, 3, 4]), sampleRate: 24000 }
const input = new AbortController().signal
function provider(id: string, synthesize: TtsProvider['synthesize'] = async () => result): TtsProvider {
  return { info: { id: id as TtsProviderId, name: id, location: 'host-local',
    voices: [{ id: 'zf_001', name: '晴岚' }, { id: 'zm_009', name: '云舟' }] }, synthesize }
}

/** Mount the service behind Loader with a settings stub that writes patches back into its live entry config. */
async function mounted(ctx: Context, config: object) {
  const live = await liveConfig(ctx, TextToSpeech, config)
  const writes: object[] = []
  ctx.provide('settings', { update: async (_entry: string, patch: Record<string, unknown>) => { writes.push(patch); await live.update(patch) } } as never)
  return { speech: ctx.get('textToSpeech')!, writes, live }
}

it('shares Host preparation across observers and does not cancel work when observation ends', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'kokoro-local', voiceId: 'zf_001', speed: 1 })
  await base
  try {
    const service = ctx.get('textToSpeech')!, id = 'local' as TtsProviderId
    let state: TtsPreparationState = { phase: 'unprepared' }, notify = (): void => {}
    const prepare = vi.fn(), cancel = vi.fn(async () => {}), unsubscribe = vi.fn()
    const remove = service.register({ ...provider(id), preparation: {
      snapshot: () => state, prepare, cancel, subscribe: (listener) => { notify = listener; return unsubscribe },
    } })
    const lifetime = new AbortController(), stream = service.follow(lifetime.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ providers: [{ id, preparation: { phase: 'unprepared' } }] })
    service.prepare(id)
    expect(prepare).toHaveBeenCalledOnce()
    service.prepare(id, { downloadSource: 'https://mirror.example' })
    expect(prepare).toHaveBeenLastCalledWith({ downloadSource: 'https://mirror.example' })
    const next = stream.next()
    state = { phase: 'downloading', resource: 'model.onnx', completedBytes: 638, totalBytes: 936 }; notify()
    expect((await next).value).toMatchObject({ providers: [{ preparation: state }] })
    lifetime.abort()
    expect((await stream.next()).done).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
    await service.cancelPreparation(id)
    expect(cancel).toHaveBeenCalledOnce()
    await remove()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(() => { service.prepare(id) }).toThrow('unavailable')
    await expect(service.cancelPreparation(id)).rejects.toThrow('unavailable')
    await expect(service.follow(lifetime.signal)[Symbol.asyncIterator]().next()).rejects.toThrow()
  } finally { await base.dispose() }
})

it('re-publishes provider facts when a provider announces a catalog change', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'demo', speed: 1 })
  await base
  try {
    const service = ctx.get('textToSpeech')!
    let voices: readonly TtsVoiceInfo[] = [{ id: 'demo', name: 'demo' }]
    const remove = service.register({
      info: { id: 'local' as TtsProviderId, name: 'local', location: 'host-local', get voices() { return voices } },
      synthesize: async () => result,
    })
    const lifetime = new AbortController(), stream = service.follow(lifetime.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ providers: [{ voices: [{ id: 'demo' }] }] })
    voices = [{ id: 'demo', name: 'demo' }, { id: 'damon', name: 'damon' }]
    const next = stream.next()
    service.catalogChanged()
    expect((await next).value).toMatchObject({ providers: [{ voices: [{ id: 'demo' }, { id: 'damon' }] }] })
    lifetime.abort()
    expect((await stream.next()).done).toBe(true)
    await remove()
  } finally { await base.dispose() }
})

it('routes recording intake to the exact provider and preserves cancellation', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'demo', speed: 1 })
  await base
  try {
    const service = ctx.get('textToSpeech')!
    const submit = vi.fn(async (intake: TtsVoiceIntake) => ({ id: intake.voiceId, name: intake.voiceId }))
    const remove = service.register({ ...provider('local'), intake: submit })
    const intake: TtsVoiceIntake = { voiceId: 'cloned', audio: new Uint8Array([1, 2, 3]) }

    expect(await service.intakeVoice('local' as TtsProviderId, intake, input)).toEqual({ id: 'cloned', name: 'cloned' })
    expect(submit).toHaveBeenCalledWith(intake, expect.any(AbortSignal))
    await expect(service.intakeVoice('missing' as TtsProviderId, intake, input)).rejects.toThrow('unavailable')
    await expect(service.intakeVoice('local' as TtsProviderId, intake, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    expect(submit).toHaveBeenCalledTimes(1)
    await remove()
  } finally { await base.dispose() }
})

it('refuses intake on a provider that accepts no recordings', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'demo', speed: 1 })
  await base
  try {
    const service = ctx.get('textToSpeech')!
    service.register(provider('local'))
    await expect(service.intakeVoice('local' as TtsProviderId, { voiceId: 'cloned', audio: new Uint8Array([1]) }, input))
      .rejects.toThrow('does not accept recordings')
  } finally { await base.dispose() }
})

it('persists explicit provider, voice, and speed changes through the profile and publishes them with readiness', async () => {
  const ctx = new Context()
  try {
    const { speech, writes } = await mounted(ctx, { defaultProvider: 'kokoro-local', voiceId: 'zf_001', speed: 1 })
    speech.register(provider('kokoro-local')); speech.register(provider('cloud'))
    const stream = speech.follow(new AbortController().signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ selection: { providerId: 'kokoro-local', voiceId: 'zf_001', speed: 1 } })
    const next = stream.next()
    await speech.configure({ providerId: 'cloud' as TtsProviderId })
    expect((await next).value).toMatchObject({ selection: { providerId: 'cloud', voiceId: 'zf_001' } })
    await speech.configure({ voiceId: 'zm_009' })
    await speech.configure({ speed: 1.5 })
    expect(speech.snapshot().selection).toEqual({ providerId: 'cloud', voiceId: 'zm_009', speed: 1.5 })
    expect(speech.resolve({ text: '你好' })).toMatchObject({ provider: { info: { id: 'cloud' } }, voiceId: 'zm_009', speed: 1.5 })
    expect(writes).toEqual([{ defaultProvider: 'cloud' }, { voiceId: 'zm_009' }, { speed: 1.5 }])
    await expect(speech.configure({ providerId: 'missing' as TtsProviderId })).rejects.toThrow('unavailable')
    await expect(speech.configure({ voiceId: 'af_heart' })).rejects.toThrow('does not support voice')
    await expect(speech.configure({ speed: 5 })).rejects.toThrow()
    expect(speech.snapshot().selection).toEqual({ providerId: 'cloud', voiceId: 'zm_009', speed: 1.5 })
  } finally { await ctx.fiber.dispose() }
})

it('refuses to configure without the settings service or a profile entry', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'zf_001', speed: 1 })
    const speech = ctx.get('textToSpeech')!
    speech.register(provider('local'))
    await expect(speech.configure({ voiceId: 'zm_009' })).rejects.toThrow('settings service')
    ctx.provide('settings', { update: vi.fn() } as never)
    await expect(speech.configure({ voiceId: 'zm_009' })).rejects.toThrow('profile entry')
    expect(speech.snapshot().selection).toEqual({ providerId: 'local', voiceId: 'zf_001', speed: 1 })
  } finally { await ctx.fiber.dispose() }
})

it('ends waiting observers and rejects registration after service disposal', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'kokoro-local', voiceId: 'zf_001', speed: 1 })
  await base
  const service = ctx.get('textToSpeech')!, stream = service.follow(new AbortController().signal)[Symbol.asyncIterator]()
  await stream.next()
  const waiting = stream.next()
  await base.dispose()
  expect((await waiting).done).toBe(true)
  expect(() => service.register(provider('late'))).toThrow('disposed')
})

describe('speech providers', () => {
  it('resolves composition defaults and explicit provider choices without fallback', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'zm_009', speed: 1 })
    await base
    const service = ctx.get('textToSpeech')!
    const a = provider('local'), b = provider('cloud')
    const removeA = service.register(a), removeB = service.register(b)
    expect(service.listProviders()).toEqual([a.info, b.info])
    const spec = service.resolve({ text: '你好' })
    expect(spec).toEqual({ text: '你好', voiceId: 'zm_009', speed: 1, provider: a })
    expect(service.resolve({ text: 'hi', providerId: b.info.id, voiceId: 'zf_001', speed: 2 }))
      .toEqual({ text: 'hi', voiceId: 'zf_001', speed: 2, provider: b })
    expect(await service.synthesize(spec, input)).toEqual(result)
    expect(() => service.register(a)).toThrow('already registered')
    expect(() => service.resolve({ text: 'x', providerId: 'missing' as TtsProviderId })).toThrow('unavailable')
    await removeA(); await removeA()
    await expect(service.synthesize(spec, input)).rejects.toThrow('no longer registered')
    await removeB(); await base.dispose()
  })

  it('withdraws a provider before joining accepted work and keeps a replacement registration', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'zf_001', speed: 1 })
    await base
    const service = ctx.get('textToSpeech')!
    let enter!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const p = provider('local', async (_value, signal) => {
      enter()
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return result
    })
    const remove = service.register(p)
    const operation = service.synthesize(service.resolve({ text: '你好' }), input)
    const rejection = expect(operation).rejects.toThrow('unloaded')
    await entered
    const removing = remove()
    expect(service.listProviders()).toEqual([])
    const next = provider('local')
    const removeNext = service.register(next)
    await removing; await rejection; await remove()
    expect(service.listProviders()).toEqual([next.info])
    await removeNext(); await base.dispose()
  })

  it('rejects pre-aborted and withdrawn queued work before the synthesizer starts', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', voiceId: 'zf_001', speed: 1 })
    await base
    const service = ctx.get('textToSpeech')!
    let calls = 0
    const remove = service.register(provider('local', async () => { calls++; return result }))
    const spec = service.resolve({ text: '你好' })
    await expect(service.synthesize(spec, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    const run = service.synthesize(spec, input)
    const rejected = expect(run).rejects.toThrow('unloaded')
    await remove(); await rejected
    expect(calls).toBe(0)
    await base.dispose()
  })

  it('removes a registration with its contributing fiber', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'kokoro-local', voiceId: 'zf_001', speed: 1 })
    await base
    const fiber = ctx.inject(['textToSpeech'], (owner) => {
      owner.effect(() => owner.textToSpeech.register(provider('kokoro-local')))
    })
    await fiber
    expect(ctx.get('textToSpeech')!.listProviders()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.get('textToSpeech')!.listProviders()).toEqual([])
    await base.dispose()
  })
})

it('rejects unsupported voice and speed selections before persistence or synthesis', async () => {
  const ctx = new Context()
  try {
    const { speech, writes } = await mounted(ctx, { defaultProvider: 'local', voiceId: 'zf_001', speed: 1 })
    const synthesize = vi.fn(async () => result)
    speech.register(provider('local', synthesize))
    const cloud = provider('cloud', synthesize)
    speech.register({ ...cloud, info: { ...cloud.info, voices: [{ id: 'zf_073', name: '若溪' }] } })
    await expect(speech.configure({ voiceId: 'zf_073' })).rejects.toThrow('does not support voice')
    await expect(speech.configure({ providerId: cloud.info.id })).rejects.toThrow('does not support voice')
    expect(writes).toEqual([])
    expect(() => speech.resolve({ text: 'x', voiceId: 'zf_073' })).toThrow('does not support voice')
    expect(() => speech.resolve({ text: 'x', speed: 4 })).toThrow('does not support speed')
    expect(synthesize).not.toHaveBeenCalled()
    await speech.configure({ providerId: cloud.info.id, voiceId: 'zf_073', speed: 1.5 })
    expect(speech.resolve({ text: 'x' })).toMatchObject({ provider: { info: { id: 'cloud' } }, voiceId: 'zf_073', speed: 1.5 })
  } finally { await ctx.fiber.dispose() }
})

it('resolves the sole registered provider when defaultProvider is unset and refuses ambiguous rosters', async () => {
  const resolved = TextToSpeech.Config({ voiceId: 'zf_001', speed: 1 })
  expect(resolved.defaultProvider.get()).toBeUndefined()
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { voiceId: 'zf_001', speed: 1 })
  await base
  try {
    const service = ctx.get('textToSpeech')!
    expect(() => service.snapshot()).toThrow('defaultProvider')
    expect(() => service.resolve({ text: '你好' })).toThrow('defaultProvider')
    const remove = service.register(provider('local'))
    expect(service.snapshot().selection).toMatchObject({ providerId: 'local', voiceId: 'zf_001', speed: 1 })
    expect(service.resolve({ text: '你好' })).toMatchObject({ provider: { info: { id: 'local' } } })
    const removeSecond = service.register(provider('cloud'))
    expect(() => service.snapshot()).toThrow('defaultProvider')
    expect(() => service.resolve({ text: '你好' })).toThrow('defaultProvider')
    await remove(); await removeSecond()
  } finally { await base.dispose() }
})

it('ends observers when the service unloads after a persisted selection', async () => {
  const ctx = new Context()
  try {
    const { speech, live } = await mounted(ctx, { defaultProvider: 'local', voiceId: 'zf_001', speed: 1 })
    speech.register(provider('local'))
    await speech.configure({ voiceId: 'zm_009' })
    const stream = speech.follow(new AbortController().signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ selection: { voiceId: 'zm_009' } })
    const waiting = stream.next()
    await live.fiber.dispose()
    expect(await waiting).toEqual({ done: true, value: undefined })
  } finally { await ctx.fiber.dispose() }
})
