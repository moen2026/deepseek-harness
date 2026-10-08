import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Image, {
  ImageError,
  type ImageGenerateRequest,
  type ImageProvider,
  type ImageResult,
} from '@deepseek-ai/dsh-image'

/** A scripted provider that records every request it receives and returns a fixed image. */
function makeProvider(id: string, overrides: Partial<ImageProvider> = {}): ImageProvider & {
  seenRequests: ImageGenerateRequest[]
  seenSignals: (AbortSignal | undefined)[]
} {
  const seenRequests: ImageGenerateRequest[] = []
  const seenSignals: (AbortSignal | undefined)[] = []
  const result: ImageResult = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }
  return {
    id,
    seenRequests,
    seenSignals,
    generate(request, signal) {
      seenRequests.push(request)
      seenSignals.push(signal)
      return Promise.resolve(result)
    },
    ...overrides,
  }
}

/** Mount the image seam on a fresh root context. */
async function mountImage(): Promise<{ ctx: Context; image: Image }> {
  const ctx = new Context()
  await ctx.plugin(Image)
  return { ctx, image: ctx.image as Image }
}

describe('Image registration', () => {
  it('fails IMAGE_UNAVAILABLE on the route when no provider is registered', async () => {
    const { image } = await mountImage()
    await expect(image.generate({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_UNAVAILABLE' }))
  })

  it('routes generate to the reserved provider and releases on dispose', async () => {
    const { image } = await mountImage()
    const provider = makeProvider('p')
    const dispose = image.registerProvider(provider)

    const request: ImageGenerateRequest = { prompt: 'a cat', size: '1024x1024' }
    await expect(image.generate(request)).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })
    expect(provider.seenRequests[0]).toBe(request)

    dispose()
    await expect(image.generate({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_UNAVAILABLE' }))
  })

  it('forwards the abort signal verbatim to the provider', async () => {
    const { image } = await mountImage()
    const provider = makeProvider('p')
    image.registerProvider(provider)
    const controller = new AbortController()
    await image.generate({ prompt: 'a cat' }, controller.signal)
    expect(provider.seenSignals[0]).toBe(controller.signal)
  })

  it('rejects an empty provider id (IMAGE_INVALID_PROVIDER) and reserves nothing', async () => {
    const { image } = await mountImage()
    expect(() => image.registerProvider(makeProvider('  ')))
      .toThrow(expect.objectContaining({ code: 'IMAGE_INVALID_PROVIDER' }))
    await expect(image.generate({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_UNAVAILABLE' }))
  })

  it('rejects a second provider while the seam is held (IMAGE_CONFLICT)', async () => {
    const { image } = await mountImage()
    image.registerProvider(makeProvider('first'))
    expect(() => image.registerProvider(makeProvider('second')))
      .toThrow(expect.objectContaining({ code: 'IMAGE_CONFLICT' }))
  })

  it('allows re-registration after dispose releases the reservation', async () => {
    const { image } = await mountImage()
    const dispose = image.registerProvider(makeProvider('first'))
    dispose()
    expect(() => image.registerProvider(makeProvider('second'))).not.toThrow()
  })

  it('disposes the reservation when the contributing fiber is disposed', async () => {
    const { ctx, image } = await mountImage()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.image.registerProvider(makeProvider('p'))
    }, { inject: ['image'] }))
    await expect(image.generate({ prompt: 'a cat' })).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })
    await fiber.dispose()
    await expect(image.generate({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'IMAGE_UNAVAILABLE' }))
  })

  it('ImageError carries its structured code', () => {
    expect(new ImageError('m', 'IMAGE_INVALID_REQUEST').code).toBe('IMAGE_INVALID_REQUEST')
  })
})
