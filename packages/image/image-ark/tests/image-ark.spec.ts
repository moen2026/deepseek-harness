import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Image } from '@deepseek-ai/dsh-image'
import * as ImageArk from '../src/index.ts'
import { ARK_IMAGES_GENERATIONS_PATH, IMAGE_ARK_DEFAULT_TIMEOUT_MS } from '../src/index.ts'
import { ARK_DEFAULT_BASE_URL, ARK_DEFAULT_MODEL, createArkImageGenerator } from '../src/generate.ts'

const CONFIG = { authEnv: 'IMAGE_ARK_TEST_KEY', timeoutMs: 1000 }
const COMPOSED_URL = 'https://cdn.example.invalid/composed.png'
const LAYER_URL = 'https://cdn.example.invalid/layer.png'
const PNG_BYTES = new Uint8Array([0x89, 0x50])

/** The endpoint's layer-decomposition answer: a composed background plus one cropped text layer. */
const DECOMPOSED = {
  data: [
    { url: COMPOSED_URL, size: '2048x2048', output_format: 'jpeg', z_index: 0 },
    {
      url: LAYER_URL,
      size: '1273x265',
      output_format: 'png',
      z_index: 1,
      bounding_box: { absolute: [383, 120, 1655, 384], normalized: [187, 59, 808, 188] },
      name: '标题文字',
      description: '黄色大号衬线字体',
    },
  ],
}

/** Canned answers for the two request kinds one generation makes, overridable per test. */
interface ApiOverrides {
  submit?: () => Response
  download?: (url: string) => Response
}

/** Route each fetch call to a canned submission or download answer. */
function stubApi(overrides: ApiOverrides = {}) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) => {
    if (url.includes(ARK_IMAGES_GENERATIONS_PATH)) {
      return overrides.submit?.() ?? Response.json({ data: [{ url: COMPOSED_URL, size: '2048x2048', output_format: 'png' }] })
    }
    return overrides.download?.(url) ?? new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.IMAGE_ARK_TEST_KEY
})

describe('createArkImageGenerator', () => {
  it('submits the prompt and downloads the answered image URL', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createArkImageGenerator(CONFIG)

    const result = await generator({ prompt: 'a daisy field', size: '2K' })
    expect(result.mediaType).toBe('image/png')
    expect(result.data[0]).toBe(0x89)
    expect(result.layers).toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [submitUrl, submitInit] = fetchMock.mock.calls[0]!
    expect(submitUrl).toBe(`${ARK_DEFAULT_BASE_URL}${ARK_IMAGES_GENERATIONS_PATH}`)
    expect((submitInit.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(submitInit.body as string)).toEqual({
      model: ARK_DEFAULT_MODEL,
      prompt: 'a daisy field',
      response_format: 'url',
      size: '2K',
    })
    expect(fetchMock.mock.calls[1]![0]).toBe(COMPOSED_URL)
  })

  it('maps a decomposed answer onto the seam layer vocabulary, bottom-up composed', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const fetchMock = stubApi({
      submit: () => Response.json(DECOMPOSED),
      download: url => new Response(new Uint8Array([url === COMPOSED_URL ? 1 : 2]), {
        // The composed background carries no image content type; the layer declares one.
        ...(url === COMPOSED_URL ? {} : { headers: { 'content-type': 'image/png; charset=utf-8' } }),
      }),
    })
    const generator = createArkImageGenerator({ ...CONFIG, layerDecomposition: true })

    const result = await generator({ prompt: 'layer separation', referenceImages: ['https://ref.example/in.png'] })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      model: ARK_DEFAULT_MODEL,
      prompt: 'layer separation',
      response_format: 'url',
      image: 'https://ref.example/in.png',
      layer_decomposition: true,
    })

    const composed = result.data
    expect(composed[0]).toBe(1)
    expect(result.mediaType).toBe('image/jpeg')
    expect(result.layers).toHaveLength(2)
    expect(result.layers?.[0]).toEqual({
      zIndex: 0,
      mediaType: 'image/jpeg',
      width: 2048,
      height: 2048,
      data: composed,
    })
    expect(result.layers?.[1]).toEqual({
      zIndex: 1,
      mediaType: 'image/png',
      width: 1273,
      height: 265,
      boundingBox: [383, 120, 1655, 384],
      name: '标题文字',
      description: '黄色大号衬线字体',
      data: new Uint8Array([2]),
    })
    expect(fetchMock.mock.calls[1]![0]).toBe(COMPOSED_URL)
    expect(fetchMock.mock.calls[2]![0]).toBe(LAYER_URL)
  })

  it('carries the lowest z_index as the composed background regardless of answer order', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    stubApi({
      submit: () => Response.json({ data: [
        { url: LAYER_URL, size: '1273x265', output_format: 'png', z_index: 1 },
        { url: COMPOSED_URL, size: '2048x2048', output_format: 'jpeg', z_index: 0 },
      ] }),
      download: url => new Response(new Uint8Array([url === COMPOSED_URL ? 1 : 2]), { headers: { 'content-type': 'image/png' } }),
    })
    const generator = createArkImageGenerator({ ...CONFIG, layerDecomposition: true })

    const result = await generator({ prompt: 'layer separation' })
    expect(result.data[0]).toBe(1)
    // The download's image/png content type refines the composed entry's jpeg format field.
    expect(result.mediaType).toBe('image/png')
    expect(result.layers?.map(layer => layer.zIndex)).toEqual([1, 0])
  })

  it('keeps the output format, a blank size, and decomposition off out of the body', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createArkImageGenerator({ ...CONFIG, outputFormat: 'jpeg' })

    await generator({ prompt: 'a cat', size: '   ' })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      model: ARK_DEFAULT_MODEL,
      prompt: 'a cat',
      response_format: 'url',
      output_format: 'jpeg',
    })
  })

  it('honors a caller signal alongside the built-in timeout', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    stubApi()
    const generator = createArkImageGenerator(CONFIG)
    const result = await generator({ prompt: 'a cat' }, new AbortController().signal)
    expect(result.mediaType).toBe('image/png')
  })

  it('falls back to png for an unknown output format and a bare layer entry', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    stubApi({ submit: () => Response.json({ data: [{ url: COMPOSED_URL, output_format: 'heif' }] }) })
    const generator = createArkImageGenerator(CONFIG)

    const result = await generator({ prompt: 'a cat' })
    expect(result.mediaType).toBe('image/png')
    expect(result.layers).toBeUndefined()
  })

  it('fails IMAGE_PROVIDER_FAILED when the credential variable is missing or empty', async () => {
    stubApi()
    const generator = createArkImageGenerator(CONFIG)
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED' }))

    process.env.IMAGE_ARK_TEST_KEY = '   '
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(/is not set/)
  })

  it('fails IMAGE_PROVIDER_FAILED when the answer carries no images', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const generator = createArkImageGenerator(CONFIG)
    const message: unknown = expect.stringContaining('no images')
    for (const body of [ {}, { data: [] }, { data: 'one' } ]) {
      stubApi({ submit: () => Response.json(body) })
      await expect(generator({ prompt: 'a cat' }))
        .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
    }
  })

  it('fails IMAGE_PROVIDER_FAILED when an answered entry is not an object or carries no URL', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const generator = createArkImageGenerator(CONFIG)
    const message: unknown = expect.stringContaining('unexpected shape')
    for (const data of [ ['text'], [{}], [{ url: '' }] ]) {
      stubApi({ submit: () => Response.json({ data }) })
      await expect(generator({ prompt: 'a cat' }))
        .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
    }
  })

  it('fails IMAGE_PROVIDER_FAILED when a decomposed layer lacks a z_index or a usable size', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const generator = createArkImageGenerator({ ...CONFIG, layerDecomposition: true })
    const zMessage: unknown = expect.stringContaining('z_index')
    stubApi({ submit: () => Response.json({ data: [
      { url: COMPOSED_URL, size: '2048x2048', z_index: 0 },
      { url: LAYER_URL, size: '1273x265' },
    ] }) })
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message: zMessage }))

    const sizeMessage: unknown = expect.stringContaining('usable size')
    for (const size of ['1273', 'big', 42]) {
      stubApi({ submit: () => Response.json({ data: [
        { url: COMPOSED_URL, size: '2048x2048', z_index: 0 },
        { url: LAYER_URL, size, z_index: 1 },
      ] }) })
      await expect(generator({ prompt: 'a cat' }))
        .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message: sizeMessage }))
    }
  })

  it('omits an unusable or absent bounding box and empty names', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const generator = createArkImageGenerator({ ...CONFIG, layerDecomposition: true })
    for (const bounding_box of ['nope', [1, 2, 3], ['a', 'b', 'c', 'd'], undefined]) {
      stubApi({ submit: () => Response.json({ data: [
        { url: COMPOSED_URL, size: '2048x2048', z_index: 0 },
        { url: LAYER_URL, size: '1273x265', z_index: 1, bounding_box, name: '', description: '' },
      ] }) })
      const result = await generator({ prompt: 'a cat' })
      expect(result.layers?.[1]).toEqual({
        zIndex: 1,
        mediaType: 'image/png',
        width: 1273,
        height: 265,
        data: PNG_BYTES,
      })
    }
  })

  it('fails IMAGE_PROVIDER_FAILED on a non-2xx or non-JSON submission response', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const generator = createArkImageGenerator(CONFIG)
    const status: unknown = expect.stringContaining('502')
    stubApi({ submit: () => new Response('no', { status: 502 }) })
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message: status }))

    const nonJson: unknown = expect.stringContaining('non-JSON')
    stubApi({ submit: () => new Response('<html>gateway</html>') })
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message: nonJson }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the submission fetch rejects', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    stubApi({ submit: () => { throw new TypeError('fetch failed') } })
    const generator = createArkImageGenerator(CONFIG)
    const message: unknown = expect.stringContaining('generation request failed')
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message }))
  })

  it('fails IMAGE_PROVIDER_FAILED when the download fails, rejects, or its body cannot be read', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const generator = createArkImageGenerator(CONFIG)

    const status: unknown = expect.stringContaining('404')
    stubApi({ download: () => new Response('gone', { status: 404 }) })
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message: status }))

    const rejected: unknown = expect.stringContaining('image download failed')
    stubApi({ download: () => { throw new TypeError('fetch failed') } })
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message: rejected }))

    const unreadable: unknown = expect.stringContaining('body read failed')
    const body = new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')) } })
    stubApi({ download: () => new Response(body) })
    await expect(generator({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_FAILED', message: unreadable }))
  })
})

describe('ImageArk plugin', () => {
  it('registers an image-ark provider that routes through the generator', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    stubApi()
    const ctx = new Context()
    await ctx.plugin(Image)
    await ctx.plugin(ImageArk, CONFIG)
    const result = await ctx.image.generate({ prompt: 'a cat' })
    expect(result.mediaType).toBe('image/png')
    expect(result.data[0]).toBe(0x89)
  })

  it('mounts without explicit config, falling back to the defaults', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const ctx = new Context()
    await ctx.plugin(Image)
    // The schema fills the timing default on a plugin mount, so a direct apply is the only path
    // that exercises the omitted-config branches.
    ImageArk.apply(ctx, { authEnv: CONFIG.authEnv })

    await ctx.image.generate({ prompt: 'a cat' })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).model).toBe(ARK_DEFAULT_MODEL)
  })

  it('wires a configured base URL and model through to the endpoint', async () => {
    process.env.IMAGE_ARK_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const ctx = new Context()
    await ctx.plugin(Image)
    await ctx.plugin(ImageArk, {
      ...CONFIG,
      arkBaseURL: 'https://alt.example.invalid/',
      model: 'doubao-seedream-4-0-250828',
      layerDecomposition: true,
      outputFormat: 'png',
    })
    await ctx.image.generate({ prompt: 'a cat' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://alt.example.invalid/api/v3/images/generations')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'doubao-seedream-4-0-250828',
      prompt: 'a cat',
      response_format: 'url',
      layer_decomposition: true,
      output_format: 'png',
    })
  })

  it('keeps the declared defaults honest', () => {
    expect(ARK_DEFAULT_BASE_URL).toBe('https://ark.cn-beijing.volces.com')
    expect(ARK_IMAGES_GENERATIONS_PATH).toBe('/api/v3/images/generations')
    expect(ARK_DEFAULT_MODEL).toBe('doubao-seedream-5-0-pro-260628')
    expect(IMAGE_ARK_DEFAULT_TIMEOUT_MS).toBe(120_000)
    expect(ImageArk.Config({ authEnv: 'X' }).timeoutMs).toBe(120_000)
    expect(ImageArk.Config({ authEnv: 'X', outputFormat: 'jpeg' }).outputFormat).toBe('jpeg')
    expect(() => ImageArk.Config({ authEnv: 'X', outputFormat: 'heif' })).toThrow()
  })
})
