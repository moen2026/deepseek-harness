/**
 * Service Definition for the video-generation capability seam (`ctx.video`): a
 * single-provider reservation registry and one order-independent route — generate —
 * over normalized requests.
 *
 * A provider reserves the seam exclusively: {@link Video.registerProvider} validates and
 * conflict-checks before mutating, so an invalid or conflicting registration publishes
 * nothing, and its disposer releases the reservation. Only one provider may hold the seam
 * at a time — a generation backend is a whole-corpus claim, not a per-caller route. The
 * seam exposes the one operation and no protocol escape hatch.
 * @module @deepseek-ai/dsh-video
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { VideoError } from './types.ts'
import type {
  VideoGenerateRequest,
  VideoProvider,
  VideoResult,
  VideoService,
} from './types.ts'

export {
  VideoError,
} from './types.ts'
export type {
  VideoErrorCode,
  VideoGenerateRequest,
  VideoProvider,
  VideoResult,
  VideoService,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    video: VideoService
  }
}

/**
 * `ctx.video`. Holds the single reserved provider; the reservation and the route
 * are populated and cleared together so a route always has a live provider.
 */
export class Video extends Service implements VideoService {
  private provider: VideoProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'video')
  }

  registerProvider(provider: VideoProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (provider.id.trim() === '') {
      throw new VideoError('a video provider id must be a non-empty string', 'VIDEO_INVALID_PROVIDER')
    }
    if (this.provider !== undefined) {
      throw new VideoError(
        `video seam is already held by provider "${this.provider.id}"`,
        'VIDEO_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: Video) {
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'video.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /** The single reserved provider or a fail-loud `VIDEO_UNAVAILABLE`. */
  private requireProvider(): VideoProvider {
    const provider = this.provider
    if (provider === undefined) {
      throw new VideoError('no video provider is registered', 'VIDEO_UNAVAILABLE')
    }
    return provider
  }

  async generate(request: VideoGenerateRequest, signal?: AbortSignal): Promise<VideoResult> {
    return this.requireProvider().generate(request, signal)
  }
}

export default Video
