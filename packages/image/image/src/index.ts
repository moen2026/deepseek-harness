/**
 * Service Definition for the image-generation capability seam (`ctx.image`): a
 * single-provider reservation registry and one order-independent route — generate —
 * over normalized requests.
 *
 * A provider reserves the seam exclusively: {@link Image.registerProvider} validates and
 * conflict-checks before mutating, so an invalid or conflicting registration publishes
 * nothing, and its disposer releases the reservation. Only one provider may hold the seam
 * at a time — a generation backend is a whole-corpus claim, not a per-caller route. The
 * seam exposes the one operation and no protocol escape hatch.
 * @module @deepseek-ai/dsh-image
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { ImageError } from './types.ts'
import type {
  ImageGenerateRequest,
  ImageProvider,
  ImageResult,
  ImageService,
} from './types.ts'

export {
  ImageError,
} from './types.ts'
export type {
  ImageErrorCode,
  ImageGenerateRequest,
  ImageProvider,
  ImageResult,
  ImageService,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    image: ImageService
  }
}

/**
 * `ctx.image`. Holds the single reserved provider; the reservation and the route
 * are populated and cleared together so a route always has a live provider.
 */
export class Image extends Service implements ImageService {
  private provider: ImageProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'image')
  }

  registerProvider(provider: ImageProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (provider.id.trim() === '') {
      throw new ImageError('an image provider id must be a non-empty string', 'IMAGE_INVALID_PROVIDER')
    }
    if (this.provider !== undefined) {
      throw new ImageError(
        `image seam is already held by provider "${this.provider.id}"`,
        'IMAGE_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: Image) {
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'image.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /** The single reserved provider or a fail-loud `IMAGE_UNAVAILABLE`. */
  private requireProvider(): ImageProvider {
    const provider = this.provider
    if (provider === undefined) {
      throw new ImageError('no image provider is registered', 'IMAGE_UNAVAILABLE')
    }
    return provider
  }

  async generate(request: ImageGenerateRequest, signal?: AbortSignal): Promise<ImageResult> {
    return this.requireProvider().generate(request, signal)
  }
}

export default Image
