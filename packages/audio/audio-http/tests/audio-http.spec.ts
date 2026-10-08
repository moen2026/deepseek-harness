import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as AudioHttp from '../src/index.ts'
import { AUDIO_HTTP_DEFAULT_TIMEOUT_MS } from '../src/index.ts'
import { createHttpTranscriber, uploadMediaType } from '../src/transcribe.ts'
import { Audio } from '@deepseek-ai/dsh-audio'

const CONFIG = { url: 'https://example.invalid/v1/audio/transcriptions', model: 'whisper-1', authEnv: 'AUDIO_HTTP_TEST_KEY', timeoutMs: 1000 }

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.AUDIO_HTTP_TEST_KEY
})

describe('uploadMediaType', () => {
  it('prefers the declared media type over the file name extension', () => {
    expect(uploadMediaType({ data: new Uint8Array(), fileName: 'a.mp3', mediaType: 'audio/custom' })).toBe('audio/custom')
  })

  it('maps known extensions and falls back to octet-stream', () => {
    expect(uploadMediaType({ data: new Uint8Array(), fileName: 'a.WAV' })).toBe('audio/wav')
    expect(uploadMediaType({ data: new Uint8Array(), fileName: 'a.unknown' })).toBe('application/octet-stream')
    expect(uploadMediaType({ data: new Uint8Array() })).toBe('application/octet-stream')
  })
})

describe('createHttpTranscriber', () => {
  it('sends the model, the audio bytes, and the bearer header, and maps the answer', async () => {
    process.env.AUDIO_HTTP_TEST_KEY = 'secret'
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ text: 'hello', language: 'en', duration: 2.5 }))
    vi.stubGlobal('fetch', fetchMock)
    const transcriber = createHttpTranscriber(CONFIG)

    const transcript = await transcriber({ data: new Uint8Array([1, 2]), fileName: 'a.mp3', language: 'en' })
    expect(transcript).toEqual({ text: 'hello', language: 'en', durationSec: 2.5 })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(CONFIG.url)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('language')).toBe('en')
    expect((form.get('file') as File).name).toBe('a.mp3')
  })

  it('fails AUDIO_PROVIDER_FAILED when the credential variable is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const transcriber = createHttpTranscriber(CONFIG)
    await expect(transcriber({ data: new Uint8Array() }))
      .rejects.toThrow(expect.objectContaining({ code: 'AUDIO_PROVIDER_FAILED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails AUDIO_PROVIDER_FAILED on a non-2xx response', async () => {
    process.env.AUDIO_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 502 })))
    const transcriber = createHttpTranscriber(CONFIG)
    const message: unknown = expect.stringContaining('502')
    await expect(transcriber({ data: new Uint8Array() }))
      .rejects.toThrow(expect.objectContaining({ code: 'AUDIO_PROVIDER_FAILED', message }))
  })

  it('fails AUDIO_PROVIDER_FAILED when the body is not transcription JSON', async () => {
    process.env.AUDIO_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ nope: true })))
    const transcriber = createHttpTranscriber(CONFIG)
    await expect(transcriber({ data: new Uint8Array() }))
      .rejects.toThrow(expect.objectContaining({ code: 'AUDIO_PROVIDER_FAILED' }))
  })
})

describe('AudioHttp plugin', () => {
  it('registers an audio-http provider that routes through the transcriber', async () => {
    process.env.AUDIO_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ text: 'hi' })))
    const ctx = new Context()
    await ctx.plugin(Audio)
    await ctx.plugin(AudioHttp, CONFIG)
    const transcript = await ctx.audio.transcribe({ data: new Uint8Array([1]), fileName: 'a.mp3' })
    expect(transcript).toEqual({ text: 'hi' })
  })

  it('keeps the configured timeout default honest', () => {
    expect(AUDIO_HTTP_DEFAULT_TIMEOUT_MS).toBe(60_000)
  })
})
