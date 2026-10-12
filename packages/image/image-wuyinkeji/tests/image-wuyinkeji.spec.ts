import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Image } from '@deepseek-ai/dsh-image'
import * as ImageWuyinkeji from '../src/index.ts'
import {
  IMAGE_WUYINKEJI_DEFAULT_MODEL,
  IMAGE_WUYINKEJI_DEFAULT_POLL_INTERVAL_MS,
  IMAGE_WUYINKEJI_DEFAULT_TIMEOUT_MS,
} from '../src/index.ts'
import { createWuyinkejiGenerator, WUYINKEJI_DEFAULT_BASE_URL } from '../src/generate.ts'

const CONFIG = { authEnv: 'IMAGE_WUYINKEJI_TEST_KEY', pollIntervalMs: 1, timeoutMs: 1000 }
const IMAGE_URL = 'https://cdn.example.invalid/out.png'

/** Canned answers for the three request kinds one generation makes, overridable per test. */
interface ApiOverrides {
  submit?: () => Response
  detail?: () => Response
  download?: () => Response
}

/** Route each fetch call to a canned submission, result-detail, or download answer. */
function stubApi(overrides: ApiOverrides = {}) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) => {
    if (url.includes('/api/async/image_')) {
      return overrides.submit?.() ?? Response.json({ code: 200, data: { id: 'task-1' } })
    }
    if (url.includes('/api/async/detail')) {
      return overrides.detail?.() ?? Response.json({ code: 200, data: { status: 2, result: [IMAGE_URL], message: '' } })
    }
    return overrides.download?.() ?? new Response(new Uint8Array([0x89, 0x50]), { headers: { 'content-type': 'image/png' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.IMAGE_WUYINKEJI_TEST_KEY
})

describe('createWuyinkejiGenerator', () => {
  it('submits the prompt, polls until the task settles, and downloads the image', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    let polls = 0
    const fetchMock = stubApi({
      detail: () => {
        polls += 1
        return Response.json({ code: 200, data: { status: polls === 1 ? 1 : 2, result: [IMAGE_URL], message: '' } })
      },
    })
    const generator = createWuyinkejiGenerator(CONFIG)

    const result = await generator({ prompt: 'a cat', size: '1024x1024' })
    expect(result.mediaType).toBe('image/png')
    expect(result.data[0]).toBe(0x89)
    expect(polls).toBe(2)

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const [submitUrl, submitInit] = fetchMock.mock.calls[0]!
    expect(submitUrl).toBe(`${WUYINKEJI_DEFAULT_BASE_URL}/api/async/image_gpt_2.5?key=secret`)
    expect((submitInit.headers as Record<string, string>).authorization).toBe('secret')
    expect(JSON.parse(submitInit.body as string)).toEqual({ prompt: 'a cat', aspectRatio: '1024*1024' })

    const [detailUrl, detailInit] = fetchMock.mock.calls[1]!
    expect(detailUrl).toBe(`${WUYINKEJI_DEFAULT_BASE_URL}/api/async/detail?key=secret&id=task-1`)
    expect((detailInit.headers as Record<string, string>).authorization).toBe('secret')

    expect(fetchMock.mock.calls[3]![0]).toBe(IMAGE_URL)
  })

  it('omits the aspect ratio when neither the request size nor the config carries one', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiGenerator(CONFIG)

    await generator({ prompt: 'a cat' })
    const [, submitInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(submitInit.body as string)).toEqual({ prompt: 'a cat' })
  })

  it('falls back to the configured aspect ratio when the request carries no size', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiGenerator({ ...CONFIG, aspectRatio: '16:9' })

    await generator({ prompt: 'a cat' })
    const [, submitInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(submitInit.body as string)).toEqual({ prompt: 'a cat', aspectRatio: '16:9' })

    await generator({ prompt: 'a cat', size: '   ' })
    const [, blankSizeInit] = fetchMock.mock.calls[3]!
    expect(JSON.parse(blankSizeInit.body as string)).toEqual({ prompt: 'a cat', aspectRatio: '16:9' })
  })

  it('submits to the NanoBanana2Lite endpoint and reduces a pixel size to its ratio', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiGenerator({ ...CONFIG, model: 'nano-banana-2-lite' })

    const result = await generator({ prompt: 'a cat', size: '1024x1536' })
    expect(result.mediaType).toBe('image/png')
    const [submitUrl, submitInit] = fetchMock.mock.calls[0]!
    expect(submitUrl).toBe(`${WUYINKEJI_DEFAULT_BASE_URL}/api/async/image_nanoBanana2Lite?key=secret`)
    expect(JSON.parse(submitInit.body as string)).toEqual({ prompt: 'a cat', aspectRatio: '2:3' })

    await generator({ prompt: 'a cat', size: '1920x1080' })
    const [, wideInit] = fetchMock.mock.calls[3]!
    expect(JSON.parse(wideInit.body as string)).toEqual({ prompt: 'a cat', aspectRatio: '16:9' })
  })

  it('keeps a colon hint and an unrecognized hint as sent for NanoBanana2Lite', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiGenerator({ ...CONFIG, model: 'nano-banana-2-lite' })

    await generator({ prompt: 'a cat', size: '16:9' })
    const [, colonInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(colonInit.body as string)).toEqual({ prompt: 'a cat', aspectRatio: '16:9' })

    await generator({ prompt: 'a cat', size: 'auto' })
    const [, autoInit] = fetchMock.mock.calls[3]!
    expect(JSON.parse(autoInit.body as string)).toEqual({ prompt: 'a cat', aspectRatio: 'auto' })
  })

  it('forwards reference-image URLs to NanoBanana2Lite as urls', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiGenerator({ ...CONFIG, model: 'nano-banana-2-lite' })

    await generator({ prompt: 'a cat', referenceImages: ['https://ref.example/a.png', 'https://ref.example/b.png'] })
    const [, submitInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(submitInit.body as string))
      .toEqual({ prompt: 'a cat', urls: ['https://ref.example/a.png', 'https://ref.example/b.png'] })
  })

  it('never sends reference images to GPT-Image-2.5', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiGenerator(CONFIG)

    await generator({ prompt: 'a cat', referenceImages: ['https://ref.example/a.png'] })
    const [, submitInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(submitInit.body as string)).toEqual({ prompt: 'a cat' })
  })

  it('falls back for NanoBanana2Lite to the configured ratio or omits the field', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiGenerator({ ...CONFIG, model: 'nano-banana-2-lite', aspectRatio: '1:1' })

    await generator({ prompt: 'a cat', size: '  ' })
    const [, fallbackInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(fallbackInit.body as string)).toEqual({ prompt: 'a cat', aspectRatio: '1:1' })

    const bare = createWuyinkejiGenerator({ ...CONFIG, model: 'nano-banana-2-lite' })
    await bare({ prompt: 'a cat' })
    const [, bareInit] = fetchMock.mock.calls[3]!
    expect(JSON.parse(bareInit.body as string)).toEqual({ prompt: 'a cat' })
  })

  it('surfaces a settled failure with the task message', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: { status: 3, message: 'content rejected' } }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('content rejected')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the credential variable is missing', async () => {
    const fetchMock = stubApi()
    const generator = createWuyinkejiGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails IMAGE_PROVIDER_FAILED on a non-2xx submission response', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => new Response('no', { status: 502 }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('502')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the submission body is not JSON', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => new Response('<html>gateway</html>', { status: 200 }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('non-JSON')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the submission is rejected', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => Response.json({ code: 401, msg: 'invalid key' }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('invalid key')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the submission carries no task id', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => Response.json({ code: 200, data: {} }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
  })

  it('fails IMAGE_PROVIDER_FAILED when a result-detail poll returns a non-JSON body', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => new Response('<html>gateway</html>', { status: 200 }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('non-JSON')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the result-detail endpoint rejects the task id', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 404, msg: 'task not found' }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('task not found')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the settled task carries no image URL', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: { status: 2, result: [], message: '' } }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the download fails', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ download: () => new Response('gone', { status: 404 }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('404')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when polling outlives the overall timeout', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: { status: 1, result: [], message: '' } }) })
    const generator = createWuyinkejiGenerator({ ...CONFIG, pollIntervalMs: 5, timeoutMs: 60 })
    const message: unknown = expect.stringContaining('timed out')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('resolves the media type from the URL extension when the download carries no content type', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({
      detail: () => Response.json({ code: 200, data: { status: 2, result: ['https://cdn.example.invalid/out.jpg'], message: '' } }),
      download: () => new Response(new Uint8Array([0xff, 0xd8])),
    })
    const generator = createWuyinkejiGenerator(CONFIG)
    const result = await generator({ prompt: 'a cat' })
    expect(result.mediaType).toBe('image/jpeg')
  })

  it('fails IMAGE_PROVIDER_FAILED when the credential variable is empty', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = ''
    const fetchMock = stubApi()
    const generator = createWuyinkejiGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies the built-in timing defaults when the config omits them', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi()
    const generator = createWuyinkejiGenerator({ authEnv: CONFIG.authEnv })
    const result = await generator({ prompt: 'a cat' })
    expect(result.mediaType).toBe('image/png')
  })

  it('fails IMAGE_PROVIDER_FAILED when the submission fetch rejects', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => { throw new TypeError('fetch failed') } })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('submission request failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the result-detail fetch rejects', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => { throw new TypeError('fetch failed') } })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('result-detail request failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the download fetch rejects', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ download: () => { throw new TypeError('fetch failed') } })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('image download failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the download body read fails', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const body = new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')) } })
    stubApi({ download: () => new Response(body) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('image download body read failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when a response body read is interrupted', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const body = new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')) } })
    stubApi({ submit: () => new Response(body) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('submission endpoint body read failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the submission data is not an object', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => Response.json({ code: 200, data: 'task-1' }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the submission carries an empty task id', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => Response.json({ code: 200, data: { id: '' } }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
  })

  it('fails IMAGE_PROVIDER_FAILED when a submission body is JSON but not an object', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('non-JSON')
    for (const body of ['[1,2]', 'null', '"task"']) {
      stubApi({ submit: () => new Response(body) })
      await expect(generator({ prompt: 'a cat' }))
        .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
    }
  })

  it('fails IMAGE_PROVIDER_FAILED when the result-detail endpoint responds non-2xx', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => new Response('no', { status: 500 }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('500')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the result-detail response carries no task data', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: 'settled' }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('no task data')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the settled result carries no usable URL', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('no image URL')
    const results: unknown[] = ['https://cdn.example.invalid/out.png', ['']]
    for (const result of results) {
      stubApi({ detail: () => Response.json({ code: 200, data: { status: 2, result, message: '' } }) })
      await expect(generator({ prompt: 'a cat' }))
        .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
    }
  })

  it('fails IMAGE_PROVIDER_FAILED on an unknown task status', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: { status: 7 } }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('unknown status 7')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('names an unknown error when a failed task carries no message', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: { status: 3 } }) })
    const generator = createWuyinkejiGenerator(CONFIG)
    const message: unknown = expect.stringContaining('unknown error')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('maps an aborted submission onto a typed failure through the caller signal', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => { throw new DOMException('This operation was aborted', 'AbortError') } })
    const generator = createWuyinkejiGenerator(CONFIG)
    const controller = new AbortController()
    controller.abort()
    const message: unknown = expect.stringContaining('AbortError')
    await expect(generator({ prompt: 'a cat' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('interrupts the poll wait when the caller signal aborts first', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const controller = new AbortController()
    stubApi({
      detail: () => {
        controller.abort()
        return Response.json({ code: 200, data: { status: 1, result: [], message: '' } })
      },
    })
    const generator = createWuyinkejiGenerator({ ...CONFIG, pollIntervalMs: 100 })
    const message: unknown = expect.stringContaining('polling was interrupted')
    await expect(generator({ prompt: 'a cat' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('interrupts the poll wait when the caller signal aborts during the wait', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const controller = new AbortController()
    stubApi({
      detail: () => {
        setTimeout(() => { controller.abort() }, 5)
        return Response.json({ code: 200, data: { status: 1, result: [], message: '' } })
      },
    })
    const generator = createWuyinkejiGenerator({ ...CONFIG, pollIntervalMs: 2_000 })
    await expect(generator({ prompt: 'a cat' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))
  })

  it('scrubs the credential from transport failure messages', async () => {
    const key = 's/e c'
    process.env.IMAGE_WUYINKEJI_TEST_KEY = key
    stubApi({
      submit: () => {
        const url = `https://api.wuyinkeji.com/api/async/image_gpt_2.5?key=${key}&copy=${encodeURIComponent(key)}`
        throw new TypeError(`Failed to parse URL from ${url}`)
      },
    })
    const generator = createWuyinkejiGenerator(CONFIG)
    const error: unknown = await generator({ prompt: 'a cat' }).then(
      () => { throw new Error('expected the generation to fail') },
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('***')
    expect(message).not.toContain(key)
    expect(message).not.toContain(encodeURIComponent(key))
  })

  it('derives webp and the png fallback when no content type is present', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const generator = createWuyinkejiGenerator(CONFIG)
    stubApi({
      detail: () => Response.json({ code: 200, data: { status: 2, result: ['https://cdn.example.invalid/out.webp'], message: '' } }),
      download: () => new Response(new Uint8Array([1])),
    })
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('image/webp')

    stubApi({
      detail: () => Response.json({ code: 200, data: { status: 2, result: ['https://cdn.example.invalid/out'], message: '' } }),
      download: () => new Response(new Uint8Array([1])),
    })
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('image/png')
  })

  it('falls back to the URL extension when the content type is not an image', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({
      detail: () => Response.json({ code: 200, data: { status: 2, result: ['https://cdn.example.invalid/out.png'], message: '' } }),
      download: () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'text/html' } }),
    })
    const generator = createWuyinkejiGenerator(CONFIG)
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('image/png')
  })
})

describe('ImageWuyinkeji plugin', () => {
  it('registers an image-wuyinkeji provider that routes through the generator', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi()
    const ctx = new Context()
    await ctx.plugin(Image)
    await ctx.plugin(ImageWuyinkeji, CONFIG)
    const result = await ctx.image.generate({ prompt: 'a cat' })
    expect(result.mediaType).toBe('image/png')
    expect(result.data[0]).toBe(0x89)
  })

  it('mounts without explicit timing, falling back to the defaults', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    stubApi()
    const ctx = new Context()
    await ctx.plugin(Image)
    // The schema fills the timing defaults on a plugin mount, so a direct apply is the only path
    // that exercises the omitted-timing branch.
    ImageWuyinkeji.apply(ctx, { authEnv: CONFIG.authEnv })

    const result = await ctx.image.generate({ prompt: 'a cat' })
    expect(result.mediaType).toBe('image/png')
  })

  it('wires a configured baseURL and aspect ratio through to the endpoint', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const ctx = new Context()
    await ctx.plugin(Image)
    await ctx.plugin(ImageWuyinkeji, { ...CONFIG, baseURL: 'https://alt.example.invalid/', aspectRatio: '16:9' })
    await ctx.image.generate({ prompt: 'a cat' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://alt.example.invalid/api/async/image_gpt_2.5?key=secret')
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'a cat', aspectRatio: '16:9' })
  })

  it('wires the NanoBanana2Lite model through to its endpoint', async () => {
    process.env.IMAGE_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const ctx = new Context()
    await ctx.plugin(Image)
    await ctx.plugin(ImageWuyinkeji, { ...CONFIG, model: 'nano-banana-2-lite' })
    await ctx.image.generate({ prompt: 'a cat', size: '1:1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${WUYINKEJI_DEFAULT_BASE_URL}/api/async/image_nanoBanana2Lite?key=secret`)
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'a cat', aspectRatio: '1:1' })
  })

  it('keeps the configured defaults honest', () => {
    expect(IMAGE_WUYINKEJI_DEFAULT_POLL_INTERVAL_MS).toBe(3_000)
    expect(IMAGE_WUYINKEJI_DEFAULT_TIMEOUT_MS).toBe(120_000)
    expect(IMAGE_WUYINKEJI_DEFAULT_MODEL).toBe('gpt-image-2.5')
  })

  it('accepts exactly the declared models and rejects anything else', () => {
    expect(ImageWuyinkeji.WUYINKEJI_MODELS).toEqual(['gpt-image-2.5', 'nano-banana-2-lite'])
    expect(ImageWuyinkeji.Config({ authEnv: 'X' }).model).toBe('gpt-image-2.5')
    expect(ImageWuyinkeji.Config({ authEnv: 'X', model: 'nano-banana-2-lite' }).model).toBe('nano-banana-2-lite')
    expect(() => ImageWuyinkeji.Config({ authEnv: 'X', model: 'nope' })).toThrow()
  })
})
