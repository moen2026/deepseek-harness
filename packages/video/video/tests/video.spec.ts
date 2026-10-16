import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Video, {
  VideoError,
  type VideoGenerateRequest,
  type VideoProvider,
  type VideoResult,
} from '@deepseek-ai/dsh-video'

/** A scripted provider that records every request it receives and returns a fixed video. */
function makeProvider(id: string, overrides: Partial<VideoProvider> = {}): VideoProvider & {
  seenRequests: VideoGenerateRequest[]
  seenSignals: (AbortSignal | undefined)[]
} {
  const seenRequests: VideoGenerateRequest[] = []
  const seenSignals: (AbortSignal | undefined)[] = []
  const result: VideoResult = { data: new Uint8Array([1, 2, 3]), mediaType: 'video/mp4' }
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

/** Mount the video seam on a fresh root context. */
async function mountVideo(): Promise<{ ctx: Context; video: Video }> {
  const ctx = new Context()
  await ctx.plugin(Video)
  return { ctx, video: ctx.video as Video }
}

describe('Video registration', () => {
  it('fails VIDEO_UNAVAILABLE on the route when no provider is registered', async () => {
    const { video } = await mountVideo()
    await expect(video.generate({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_UNAVAILABLE' }))
  })

  it('routes generate to the reserved provider and releases on dispose', async () => {
    const { video } = await mountVideo()
    const provider = makeProvider('p')
    const dispose = video.registerProvider(provider)

    const request: VideoGenerateRequest = { prompt: 'a cat', size: '1280x720' }
    await expect(video.generate(request)).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'video/mp4' })
    expect(provider.seenRequests[0]).toBe(request)

    dispose()
    await expect(video.generate({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_UNAVAILABLE' }))
  })

  it('forwards the abort signal verbatim to the provider', async () => {
    const { video } = await mountVideo()
    const provider = makeProvider('p')
    video.registerProvider(provider)
    const controller = new AbortController()
    await video.generate({ prompt: 'a cat' }, controller.signal)
    expect(provider.seenSignals[0]).toBe(controller.signal)
  })

  it('rejects an empty provider id (VIDEO_INVALID_PROVIDER) and reserves nothing', async () => {
    const { video } = await mountVideo()
    expect(() => video.registerProvider(makeProvider('  ')))
      .toThrow(expect.objectContaining({ code: 'VIDEO_INVALID_PROVIDER' }))
    await expect(video.generate({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_UNAVAILABLE' }))
  })

  it('rejects a second provider while the seam is held (VIDEO_CONFLICT)', async () => {
    const { video } = await mountVideo()
    video.registerProvider(makeProvider('first'))
    expect(() => video.registerProvider(makeProvider('second')))
      .toThrow(expect.objectContaining({ code: 'VIDEO_CONFLICT' }))
  })

  it('allows re-registration after dispose releases the reservation', async () => {
    const { video } = await mountVideo()
    const dispose = video.registerProvider(makeProvider('first'))
    dispose()
    expect(() => video.registerProvider(makeProvider('second'))).not.toThrow()
  })

  it('disposes the reservation when the contributing fiber is disposed', async () => {
    const { ctx, video } = await mountVideo()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.video.registerProvider(makeProvider('p'))
    }, { inject: ['video'] }))
    await expect(video.generate({ prompt: 'a cat' })).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'video/mp4' })
    await fiber.dispose()
    await expect(video.generate({ prompt: 'a cat' }))
      .rejects.toThrow(expect.objectContaining({ code: 'VIDEO_UNAVAILABLE' }))
  })

  it('VideoError carries its structured code', () => {
    expect(new VideoError('m', 'VIDEO_INVALID_REQUEST').code).toBe('VIDEO_INVALID_REQUEST')
  })
})
