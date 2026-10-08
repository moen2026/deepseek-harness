import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as ImageHttp from '../src/index.ts'
import { IMAGE_HTTP_DEFAULT_TIMEOUT_MS } from '../src/index.ts'
import { createHttpGenerator } from '../src/generate.ts'
import { Image } from '@deepseek-ai/dsh-image'

const CONFIG = { url: 'https://example.invalid/v1/images/generations', model: 'image-1', authEnv: 'IMAGE_HTTP_TEST_KEY', timeoutMs: 1000 }

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.IMAGE_HTTP_TEST_KEY
})

describe('createHttpGenerator', () => {
  it('sends the model, the prompt, and the bearer header, and decodes the base64 answer', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    // A 1x1 red PNG, base64-encoded.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ data: [{ b64_json: png, revised_prompt: 'a red cat' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const generator = createHttpGenerator(CONFIG)

    const result = await generator({ prompt: 'a cat', size: '1024x1024' })
    expect(result.mediaType).toBe('image/png')
    expect(result.revisedPrompt).toBe('a red cat')
    expect(result.data[0]).toBe(0x89)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(CONFIG.url)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'image-1',
      prompt: 'a cat',
      response_format: 'b64_json',
      size: '1024x1024',
    })
  })

  it('omits optional refinements the request does not carry', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ data: [{ b64_json: 'aGk=' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const generator = createHttpGenerator(CONFIG)

    const result = await generator({ prompt: 'a cat' })
    expect(result).toEqual({ data: new TextEncoder().encode('hi'), mediaType: 'image/png' })

    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'image-1',
      prompt: 'a cat',
      response_format: 'b64_json',
    })
  })

  it('falls back to the default timeout and composes the caller signal', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: 'aGk=' }] })))
    const generator = createHttpGenerator({ url: CONFIG.url, model: CONFIG.model, authEnv: CONFIG.authEnv })

    const result = await generator({ prompt: 'a cat' }, new AbortController().signal)
    expect(result.data.byteLength).toBe(2)
  })

  it('forwards the requested image count', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ data: [{ b64_json: 'aGk=' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const generator = createHttpGenerator(CONFIG)

    await generator({ prompt: 'a cat', n: 2 })
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'image-1',
      prompt: 'a cat',
      response_format: 'b64_json',
      n: 2,
    })
  })

  it('fails IMAGE_PROVIDER_FAILED when the request itself fails', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket reset') }))
    const generator = createHttpGenerator(CONFIG)
    const message: unknown = expect.stringContaining('generation request failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the body is not JSON', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gateway</html>', { status: 200 })))
    const generator = createHttpGenerator(CONFIG)
    const message: unknown = expect.stringContaining('non-JSON')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the credential variable is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const generator = createHttpGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails IMAGE_PROVIDER_FAILED on a non-2xx response', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 502 })))
    const generator = createHttpGenerator(CONFIG)
    const message: unknown = expect.stringContaining('502')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the body is not generation JSON', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ nope: true })))
    const generator = createHttpGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
  })

  it('fails IMAGE_PROVIDER_FAILED when no answer entry carries base64 bytes', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ revised_prompt: 'x' }] })))
    const generator = createHttpGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
  })
})

describe('ImageHttp plugin', () => {
  it('registers an image-http provider that routes through the generator', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: 'aGk=' }] })))
    const ctx = new Context()
    await ctx.plugin(Image)
    await ctx.plugin(ImageHttp, CONFIG)
    const result = await ctx.image.generate({ prompt: 'a cat' })
    expect(result.mediaType).toBe('image/png')
    expect(result.data.byteLength).toBe(2)
  })

  it('mounts without an explicit timeout, falling back to the default', async () => {
    process.env.IMAGE_HTTP_TEST_KEY = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: 'aGk=' }] })))
    const ctx = new Context()
    await ctx.plugin(Image)
    // The schema fills the default on a plugin mount, so a direct apply is the only path
    // that exercises the omitted-timeout branch.
    ImageHttp.apply(ctx, { url: CONFIG.url, model: CONFIG.model, authEnv: CONFIG.authEnv })

    const result = await ctx.image.generate({ prompt: 'a cat' })
    expect(result.mediaType).toBe('image/png')
  })

  it('keeps the configured timeout default honest', () => {
    expect(IMAGE_HTTP_DEFAULT_TIMEOUT_MS).toBe(120_000)
  })
})
