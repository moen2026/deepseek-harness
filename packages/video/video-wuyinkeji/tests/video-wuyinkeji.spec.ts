import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Video } from '@deepseek-ai/dsh-video'
import * as VideoWuyinkeji from '../src/index.ts'
import {
  VIDEO_WUYINKEJI_DEFAULT_MODEL,
  VIDEO_WUYINKEJI_DEFAULT_POLL_INTERVAL_MS,
  VIDEO_WUYINKEJI_DEFAULT_TIMEOUT_MS,
} from '../src/index.ts'
import {
  createWuyinkejiVideoGenerator,
  WUYINKEJI_DEFAULT_BASE_URL,
  WUYINKEJI_VIDEO_GOOGLE_OMNI_PATH,
  WUYINKEJI_VIDEO_GROK_IMAGINE_PATH,
  WUYINKEJI_VIDEO_MINIMAX_H3_PATH,
  WUYINKEJI_VIDEO_MODELS,
} from '../src/generate.ts'

const CONFIG = { authEnv: 'VIDEO_WUYINKEJI_TEST_KEY', pollIntervalMs: 1, timeoutMs: 1000 }
const VIDEO_URL = 'https://cdn.example.invalid/out.mp4'

/** Canned answers for the three request kinds one generation makes, overridable per test. */
interface ApiOverrides {
  submit?: () => Response
  detail?: () => Response
  download?: () => Response
}

/** Route each fetch call to a canned submission, result-detail, or download answer. */
function stubApi(overrides: ApiOverrides = {}) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) => {
    if (url.includes('/api/async/video_google_omni')) {
      return overrides.submit?.() ?? Response.json({ code: 200, data: { id: 'task-1' } })
    }
    if (url.includes('/api/async/video_minimax_h3')) {
      return overrides.submit?.() ?? Response.json({ code: 200, data: { id: 'task-1' } })
    }
    if (url.includes('/api/async/video_grok_imagine')) {
      return overrides.submit?.() ?? Response.json({ code: 200, data: { id: 'task-1' } })
    }
    if (url.includes('/api/async/detail')) {
      return overrides.detail?.() ?? Response.json({ code: 200, data: { status: 2, result: [VIDEO_URL], message: '' } })
    }
    return overrides.download?.() ?? new Response(new Uint8Array([0, 0, 0, 24]), { headers: { 'content-type': 'video/mp4' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.VIDEO_WUYINKEJI_TEST_KEY
})

describe('createWuyinkejiVideoGenerator', () => {
  it('submits the prompt with its hints, polls until the task settles, and downloads the video', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    let polls = 0
    const fetchMock = stubApi({
      detail: () => {
        polls += 1
        return Response.json({ code: 200, data: { status: polls === 1 ? 1 : 2, result: [VIDEO_URL], message: '' } })
      },
    })
    const generator = createWuyinkejiVideoGenerator(CONFIG)

    const result = await generator({
      prompt: 'a cat',
      size: '1280x720',
      duration: 10,
      referenceImage: 'https://ref.example/a.png',
      referenceVideo: 'https://ref.example/v.mp4',
    })
    expect(result.mediaType).toBe('video/mp4')
    expect(result.data.length).toBe(4)
    expect(polls).toBe(2)

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const [submitUrl, submitInit] = fetchMock.mock.calls[0]!
    expect(submitUrl).toBe(`${WUYINKEJI_DEFAULT_BASE_URL}${WUYINKEJI_VIDEO_GOOGLE_OMNI_PATH}?key=secret`)
    expect((submitInit.headers as Record<string, string>).authorization).toBe('secret')
    expect(JSON.parse(submitInit.body as string)).toEqual({
      prompt: 'a cat',
      size: '1280x720',
      images: 'https://ref.example/a.png',
      duration: '10',
      video: 'https://ref.example/v.mp4',
    })

    const [detailUrl, detailInit] = fetchMock.mock.calls[1]!
    expect(detailUrl).toBe(`${WUYINKEJI_DEFAULT_BASE_URL}/api/async/detail?key=secret&id=task-1`)
    expect((detailInit.headers as Record<string, string>).authorization).toBe('secret')

    expect(fetchMock.mock.calls[3]![0]).toBe(VIDEO_URL)
  })

  it('omits every optional hint the request does not carry', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator(CONFIG)

    await generator({ prompt: 'a cat' })
    const [, submitInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(submitInit.body as string)).toEqual({ prompt: 'a cat' })
  })

  it('normalizes a multiplication-sign size hint and strings the duration', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator(CONFIG)

    await generator({ prompt: 'a cat', size: '1280×720', duration: 10 })
    const [, submitInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(submitInit.body as string)).toEqual({ prompt: 'a cat', size: '1280x720', duration: '10' })
  })

  it('maps MiniMax H3 frame conditioning onto its endpoint fields', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator({ ...CONFIG, model: 'minimax-h3' })

    await generator({
      prompt: 'a cat',
      firstFrame: 'https://ref.example/first.png',
      lastFrame: 'https://ref.example/last.png',
      aspectRatio: ' 16:9 ',
      duration: 5,
      size: '1280x720',
    })
    await generator({ prompt: 'a cat', size: '2K' })
    await generator({ prompt: 'a cat', size: '768P' })
    const bodies = fetchMock.mock.calls
      .filter(([url]) => url.includes(WUYINKEJI_VIDEO_MINIMAX_H3_PATH))
      .map(([, init]) => JSON.parse(init.body as string) as Record<string, unknown>)
    expect(bodies).toEqual([
      {
        prompt: 'a cat',
        first_frame: 'https://ref.example/first.png',
        last_frame: 'https://ref.example/last.png',
        // The explicit aspect-ratio hint wins over the one derived from the size hint.
        ratio: '16:9',
        duration: '5',
        resolution: '768P',
      },
      { prompt: 'a cat', resolution: '2K' },
      { prompt: 'a cat', resolution: '768P' },
    ])
  })

  it('maps MiniMax H3 reference media onto its endpoint fields', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator({ ...CONFIG, model: 'minimax-h3' })

    await generator({
      prompt: 'a cat',
      referenceImage: 'https://ref.example/a.png',
      referenceVideo: 'https://ref.example/v.mp4',
      referenceAudio: 'https://ref.example/a.mp3',
    })
    const [, submitInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(submitInit.body as string)).toEqual({
      prompt: 'a cat',
      images: 'https://ref.example/a.png',
      videos: 'https://ref.example/v.mp4',
      audios: 'https://ref.example/a.mp3',
    })
  })

  it('derives the MiniMax H3 ratio from a pixel-pair size hint', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator({ ...CONFIG, model: 'minimax-h3' })

    await generator({ prompt: 'a cat', size: '1920×1080' })
    await generator({ prompt: 'a cat', size: '720x1280' })
    await generator({ prompt: 'a cat', size: '1000x700' })
    const bodies = fetchMock.mock.calls
      .filter(([url]) => url.includes(WUYINKEJI_VIDEO_MINIMAX_H3_PATH))
      .map(([, init]) => JSON.parse(init.body as string) as Record<string, unknown>)
    expect(bodies).toEqual([
      { prompt: 'a cat', resolution: '2K', ratio: '16:9' },
      { prompt: 'a cat', resolution: '768P', ratio: '9:16' },
      // 10:7 names no accepted ratio, so only the resolution tier is sent.
      { prompt: 'a cat', resolution: '768P' },
    ])
  })

  it('rejects MiniMax H3 hints the endpoint cannot accept before any I/O', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator({ ...CONFIG, model: 'minimax-h3' })

    const invalid = [
      { prompt: 'a cat', duration: 3 },
      { prompt: 'a cat', duration: 16 },
      { prompt: 'a cat', duration: 4.5 },
      { prompt: 'a cat', aspectRatio: '4K' },
      { prompt: 'a cat', size: 'ultrawide' },
    ]
    for (const request of invalid) {
      await expect(generator(request))
        .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_INVALID_REQUEST' }))
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects MiniMax H3 reference media combined with frame conditioning', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator({ ...CONFIG, model: 'minimax-h3' })

    await expect(generator({
      prompt: 'a cat',
      firstFrame: 'https://ref.example/f.png',
      referenceImage: 'https://ref.example/a.png',
    }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_INVALID_REQUEST' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a settled failure with the task message', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: { status: 3, message: 'content rejected' } }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('content rejected')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the credential variable is missing', async () => {
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails VIDEO_PROVIDER_FAILED when the credential variable is empty', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = ''
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails VIDEO_PROVIDER_FAILED on a non-2xx submission response', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => new Response('no', { status: 502 }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('502')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the submission body is not JSON', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => new Response('<html>gateway</html>', { status: 200 }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('non-JSON')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the submission is rejected', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => Response.json({ code: 401, msg: 'invalid key' }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('invalid key')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the submission carries no task id', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => Response.json({ code: 200, data: {} }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED' }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the submission data is not an object', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => Response.json({ code: 200, data: 'task-1' }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED' }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the submission carries an empty task id', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => Response.json({ code: 200, data: { id: '' } }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED' }))
  })

  it('fails VIDEO_PROVIDER_FAILED when a submission body is JSON but not an object', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('non-JSON')
    for (const body of ['[1,2]', 'null', '"task"']) {
      stubApi({ submit: () => new Response(body) })
      await expect(generator({ prompt: 'a cat' }))
        .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
    }
  })

  it('fails VIDEO_PROVIDER_FAILED when a result-detail poll returns a non-JSON body', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => new Response('<html>gateway</html>', { status: 200 }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('non-JSON')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the result-detail endpoint rejects the task id', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 404, msg: 'task not found' }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('task not found')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the result-detail endpoint responds non-2xx', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => new Response('no', { status: 500 }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('500')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the result-detail response carries no task data', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: 'settled' }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('no task data')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the settled task carries no video URL', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('no video URL')
    const results: unknown[] = ['https://cdn.example.invalid/out.mp4', ['']]
    for (const result of results) {
      stubApi({ detail: () => Response.json({ code: 200, data: { status: 2, result, message: '' } }) })
      await expect(generator({ prompt: 'a cat' }))
        .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
    }
  })

  it('fails VIDEO_PROVIDER_FAILED on an unknown task status', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: { status: 7 } }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('unknown status 7')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('names an unknown error when a failed task carries no message', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: { status: 3 } }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('unknown error')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the download fails', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ download: () => new Response('gone', { status: 404 }) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('404')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when polling outlives the overall timeout', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => Response.json({ code: 200, data: { status: 1, result: [], message: '' } }) })
    const generator = createWuyinkejiVideoGenerator({ ...CONFIG, pollIntervalMs: 5, timeoutMs: 60 })
    const message: unknown = expect.stringContaining('timed out')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('applies the built-in timing defaults when the config omits them', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi()
    const generator = createWuyinkejiVideoGenerator({ authEnv: CONFIG.authEnv })
    const result = await generator({ prompt: 'a cat' })
    expect(result.mediaType).toBe('video/mp4')
  })

  it('fails VIDEO_PROVIDER_FAILED when the submission fetch rejects', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => { throw new TypeError('fetch failed') } })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('submission request failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the result-detail fetch rejects', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ detail: () => { throw new TypeError('fetch failed') } })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('result-detail request failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the download fetch rejects', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ download: () => { throw new TypeError('fetch failed') } })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('video download failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when the download body read fails', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const body = new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')) } })
    stubApi({ download: () => new Response(body) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('video download body read failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('fails VIDEO_PROVIDER_FAILED when a response body read is interrupted', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const body = new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')) } })
    stubApi({ submit: () => new Response(body) })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const message: unknown = expect.stringContaining('submission endpoint body read failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('maps an aborted submission onto a typed failure through the caller signal', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({ submit: () => { throw new DOMException('This operation was aborted', 'AbortError') } })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    const controller = new AbortController()
    controller.abort()
    const message: unknown = expect.stringContaining('AbortError')
    await expect(generator({ prompt: 'a cat' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('interrupts the poll wait when the caller signal aborts first', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const controller = new AbortController()
    stubApi({
      detail: () => {
        controller.abort()
        return Response.json({ code: 200, data: { status: 1, result: [], message: '' } })
      },
    })
    const generator = createWuyinkejiVideoGenerator({ ...CONFIG, pollIntervalMs: 100 })
    const message: unknown = expect.stringContaining('polling was interrupted')
    await expect(generator({ prompt: 'a cat' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED', message }))
  })

  it('interrupts the poll wait when the caller signal aborts during the wait', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const controller = new AbortController()
    stubApi({
      detail: () => {
        setTimeout(() => { controller.abort() }, 5)
        return Response.json({ code: 200, data: { status: 1, result: [], message: '' } })
      },
    })
    const generator = createWuyinkejiVideoGenerator({ ...CONFIG, pollIntervalMs: 2_000 })
    await expect(generator({ prompt: 'a cat' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_PROVIDER_FAILED' }))
  })

  it('scrubs the credential from transport failure messages', async () => {
    const key = 's/e c'
    process.env.VIDEO_WUYINKEJI_TEST_KEY = key
    stubApi({
      submit: () => {
        const url = `https://api.wuyinkeji.com/api/async/video_google_omni?key=${key}&copy=${encodeURIComponent(key)}`
        throw new TypeError(`Failed to parse URL from ${url}`)
      },
    })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
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

  it('derives webm, quicktime, and the mp4 fallback when no content type is present', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    stubApi({
      detail: () => Response.json({ code: 200, data: { status: 2, result: ['https://cdn.example.invalid/out.webm'], message: '' } }),
      download: () => new Response(new Uint8Array([1])),
    })
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('video/webm')

    stubApi({
      detail: () => Response.json({ code: 200, data: { status: 2, result: ['https://cdn.example.invalid/out.mov'], message: '' } }),
      download: () => new Response(new Uint8Array([1])),
    })
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('video/quicktime')

    stubApi({
      detail: () => Response.json({ code: 200, data: { status: 2, result: ['https://cdn.example.invalid/out'], message: '' } }),
      download: () => new Response(new Uint8Array([1])),
    })
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('video/mp4')
  })

  it('falls back to the URL extension when the content type is not a video', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi({
      detail: () => Response.json({ code: 200, data: { status: 2, result: ['https://cdn.example.invalid/out.mp4'], message: '' } }),
      download: () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'text/html' } }),
    })
    const generator = createWuyinkejiVideoGenerator(CONFIG)
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('video/mp4')
  })
})

describe('VideoWuyinkeji plugin', () => {
  it('registers a video-wuyinkeji provider that routes through the generator', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi()
    const ctx = new Context()
    await ctx.plugin(Video)
    await ctx.plugin(VideoWuyinkeji, CONFIG)
    const result = await ctx.video.generate({ prompt: 'a cat' })
    expect(result.mediaType).toBe('video/mp4')
    expect(result.data).toEqual(new Uint8Array([0, 0, 0, 24]))
  })

  it('mounts without explicit timing, falling back to the defaults', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    stubApi()
    const ctx = new Context()
    await ctx.plugin(Video)
    // The schema fills the timing defaults on a plugin mount, so a direct apply is the only path
    // that exercises the omitted-timing branch.
    VideoWuyinkeji.apply(ctx, { authEnv: CONFIG.authEnv })

    const result = await ctx.video.generate({ prompt: 'a cat' })
    expect(result.mediaType).toBe('video/mp4')
  })

  it('wires a configured baseURL through to the endpoint', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const ctx = new Context()
    await ctx.plugin(Video)
    await ctx.plugin(VideoWuyinkeji, { ...CONFIG, baseURL: 'https://alt.example.invalid/' })
    await ctx.video.generate({ prompt: 'a cat' })
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://alt.example.invalid${WUYINKEJI_VIDEO_GOOGLE_OMNI_PATH}?key=secret`)
  })

  it('maps Grok Imagine hints onto its endpoint fields and rejects unsupported ones locally', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createWuyinkejiVideoGenerator({ ...CONFIG, model: 'grok-imagine' })

    await generator({
      prompt: 'a cat',
      duration: 8,
      aspectRatio: ' 9:16 ',
      referenceImage: 'https://ref.example/a.png',
      firstFrame: 'https://ref.example/first.png',
    })
    await generator({ prompt: 'a cat' })
    const bodies = fetchMock.mock.calls
      .filter(([url]) => url.includes(WUYINKEJI_VIDEO_GROK_IMAGINE_PATH))
      .map(([, init]) => JSON.parse(init.body as string) as Record<string, unknown>)
    expect(bodies).toEqual([
      { prompt: 'a cat', duration: '8', aspect_ratio: '9:16', image_urls: ['https://ref.example/a.png'] },
      { prompt: 'a cat' },
    ])

    for (const request of [
      { prompt: 'a cat', duration: 5 },
      { prompt: 'a cat', duration: 11 },
      { prompt: 'a cat', duration: 7.5 },
      { prompt: 'a cat', aspectRatio: '4:3' },
    ]) {
      await expect(generator(request)).rejects.toMatchObject({ code: 'VIDEO_INVALID_REQUEST' })
    }
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('selects the MiniMax H3 endpoint through the configured model', async () => {
    process.env.VIDEO_WUYINKEJI_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const ctx = new Context()
    await ctx.plugin(Video)
    await ctx.plugin(VideoWuyinkeji, { ...CONFIG, model: 'minimax-h3' })
    await ctx.video.generate({ prompt: 'a cat' })
    expect(fetchMock.mock.calls[0]![0])
      .toBe(`${WUYINKEJI_DEFAULT_BASE_URL}${WUYINKEJI_VIDEO_MINIMAX_H3_PATH}?key=secret`)
  })

  it('keeps the configured defaults honest', () => {
    expect(VIDEO_WUYINKEJI_DEFAULT_POLL_INTERVAL_MS).toBe(10_000)
    expect(VIDEO_WUYINKEJI_DEFAULT_TIMEOUT_MS).toBe(600_000)
    expect(VIDEO_WUYINKEJI_DEFAULT_MODEL).toBe('google-omni')
    expect(WUYINKEJI_VIDEO_GOOGLE_OMNI_PATH).toBe('/api/async/video_google_omni')
    expect(WUYINKEJI_VIDEO_MINIMAX_H3_PATH).toBe('/api/async/video_minimax_h3')
    expect(WUYINKEJI_VIDEO_GROK_IMAGINE_PATH).toBe('/api/async/video_grok_imagine')
    expect(WUYINKEJI_VIDEO_MODELS).toEqual(['google-omni', 'minimax-h3', 'grok-imagine'])
  })

  it('fills the timing defaults and rejects out-of-range timing', () => {
    expect(VideoWuyinkeji.Config({ authEnv: 'X' }).pollIntervalMs).toBe(10_000)
    expect(VideoWuyinkeji.Config({ authEnv: 'X' }).timeoutMs).toBe(600_000)
    expect(VideoWuyinkeji.Config({ authEnv: 'X' }).model).toBe('google-omni')
    expect(VideoWuyinkeji.Config({ authEnv: 'X', model: 'minimax-h3' }).model).toBe('minimax-h3')
    expect(VideoWuyinkeji.Config({ authEnv: 'X', model: 'grok-imagine' }).model).toBe('grok-imagine')
    expect(() => VideoWuyinkeji.Config({ authEnv: 'X', pollIntervalMs: 0 })).toThrow()
  })
})
