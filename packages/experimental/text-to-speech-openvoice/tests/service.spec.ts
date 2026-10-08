/** Service-backed registration, roster discovery, and synthesis routing for the OpenVoice provider. */
import { createServer } from 'node:http'
import { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import TextToSpeech from '@deepseek-ai/dsh-experimental-text-to-speech'
import type { TtsProviderId } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'
import { OpenVoiceClient } from '../src/provider.ts'

/** One minimal complete PCM WAV container carrying only a sample rate. */
function wav(sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44)
  new DataView(bytes.buffer).setUint32(24, sampleRate, true)
  return bytes
}

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true, loaded: true, voices: roster }))
    return
  }
  if (request.url?.startsWith('/references')) {
    const name = new URL(request.url, 'http://placeholder').searchParams.get('name') ?? ''
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      if (name === 'ghost') {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'reserved voice name' }))
        return
      }
      lastReference = { name, audio: Buffer.concat(chunks) }
      roster = [...roster, name]
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true }))
    })
    return
  }
  if (request.url === '/synthesize') {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += String(chunk) })
    request.on('end', () => {
      const body = JSON.parse(raw) as { text: string; voice: string; speed: number }
      if (body.voice === 'ghost') {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'unknown voice: ghost' }))
        return
      }
      lastSynthesis = body
      response.setHeader('content-type', 'audio/wav')
      response.end(Buffer.from(wav(44100)))
    })
    return
  }
  response.statusCode = 400
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ error: 'unknown voice: ghost' }))
})

let origin: string
let roster: string[]
let lastReference: { name: string; audio: Buffer } | undefined
let lastSynthesis: { text: string; voice: string; speed: number }

beforeEach(async () => {
  roster = ['demo', 'damon']
  lastReference = undefined
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(() => { return new Promise<void>(resolve => server.close(() => { resolve() })) })

it('registers the service-backed provider with the discovered cloned-voice roster', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TextToSpeech, { defaultProvider: 'openvoice-local', voiceId: 'demo', speed: 1 })
    const fiber = ctx.plugin(Provider, { serviceOrigin: origin })
    await fiber
    await vi.waitFor(() => {
      expect(ctx.textToSpeech.listProviders()).toMatchObject([{
        id: 'openvoice-local', name: 'OpenVoice v2 (local)', location: 'host-local',
        voices: [{ id: 'demo', name: 'demo' }, { id: 'damon', name: 'damon' }],
      }])
    })
    await fiber.dispose()
    expect(ctx.textToSpeech.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})

it('registers under a configured display name for a second service instance', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TextToSpeech, { defaultProvider: 'cosyvoice-local', voiceId: 'demo', speed: 1 })
    const fiber = ctx.plugin(Provider, { serviceOrigin: origin, providerId: 'cosyvoice-local', displayName: 'CosyVoice v2 (local)' })
    await fiber
    await vi.waitFor(() => {
      expect(ctx.textToSpeech.listProviders()).toMatchObject([{
        id: 'cosyvoice-local', name: 'CosyVoice v2 (local)', location: 'host-local',
        voices: [{ id: 'demo', name: 'demo' }, { id: 'damon', name: 'damon' }],
      }])
    })
    await fiber.dispose()
    expect(ctx.textToSpeech.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})

it('routes synthesis through the service and returns its WAV with the parsed sample rate', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TextToSpeech, { defaultProvider: 'openvoice-local', voiceId: 'damon', speed: 1.2 })
    await ctx.plugin(Provider, { serviceOrigin: origin })
    const speech = ctx.get('textToSpeech')!
    const result = await speech.synthesize(speech.resolve({ text: '你好，世界' }), new AbortController().signal)
    expect(result).toEqual({ audio: wav(44100), sampleRate: 44100 })
    expect(lastSynthesis).toEqual({ text: '你好，世界', voice: 'damon', speed: 1.2 })
  } finally { await ctx.fiber.dispose() }
})

it('republishes the refreshed roster after a probe so a dropped recording becomes selectable', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TextToSpeech, { defaultProvider: 'openvoice-local', voiceId: 'demo', speed: 1 })
    await ctx.plugin(Provider, { serviceOrigin: origin })
    const speech = ctx.get('textToSpeech')!
    await vi.waitFor(() => { expect(speech.listProviders()[0]?.voices).toHaveLength(2) })
    const lifetime = new AbortController(), stream = speech.follow(lifetime.signal)[Symbol.asyncIterator]()
    await stream.next()
    roster = [...roster, 'cloned']
    const next = stream.next()
    await speech.synthesize(speech.resolve({ text: '你好' }), new AbortController().signal)
    expect((await next).value).toMatchObject({
      providers: [{ voices: [{ id: 'demo' }, { id: 'damon' }, { id: 'cloned' }] }],
    })
    lifetime.abort()
  } finally { await ctx.fiber.dispose() }
})

it('surfaces service rejections and refuses out-of-budget text', async () => {
  const client = new OpenVoiceClient(Provider.Config({ serviceOrigin: origin }))
  await expect(client.synthesize({ text: '', voiceId: 'demo', speed: 1 }, new AbortController().signal))
    .rejects.toThrow('1..4000')
  await expect(client.synthesize({ text: '你好', voiceId: 'ghost', speed: 1 }, new AbortController().signal))
    .rejects.toThrow('unknown voice')
})

it('stores a recording as a reference through the service and republishes the roster', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TextToSpeech, { defaultProvider: 'openvoice-local', voiceId: 'demo', speed: 1 })
    await ctx.plugin(Provider, { serviceOrigin: origin })
    const speech = ctx.get('textToSpeech')!
    await vi.waitFor(() => { expect(speech.listProviders()[0]?.voices).toHaveLength(2) })
    const audio = new Uint8Array([82, 73, 70, 70])

    const voice = await speech.intakeVoice('openvoice-local' as TtsProviderId, { voiceId: '我的录音', audio }, new AbortController().signal)

    expect(voice).toEqual({ id: '我的录音', name: '我的录音' })
    expect(lastReference).toEqual({ name: '我的录音', audio: Buffer.from(audio) })
    expect(speech.listProviders()[0]?.voices).toMatchObject([{ id: 'demo' }, { id: 'damon' }, { id: '我的录音' }])
  } finally { await ctx.fiber.dispose() }
})

it('refuses empty and service-rejected reference uploads without side effects', async () => {
  const client = new OpenVoiceClient(Provider.Config({ serviceOrigin: origin }))
  const signal = new AbortController().signal

  await expect(client.uploadReference({ voiceId: 'empty', audio: new Uint8Array(0) }, signal))
    .rejects.toThrow('1..')
  await expect(client.uploadReference({ voiceId: 'ghost', audio: new Uint8Array([1, 2, 3]) }, signal))
    .rejects.toThrow('HTTP 400')
  expect(roster).toEqual(['demo', 'damon'])
})
