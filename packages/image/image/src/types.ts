/**
 * Vocabulary for the image-generation capability seam (`ctx.image`): a generation
 * request over a text prompt, the image a provider answers with, the provider
 * contract that reserves the seam, and the `ImageService` surface the seam and its
 * model-facing tool share.
 * @module @deepseek-ai/dsh-image/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Stable, machine-routable codes for image failures, carried on {@link ImageError}
 * so callers branch on `code` instead of parsing `message`.
 */
export type ImageErrorCode =
  | 'IMAGE_INVALID_PROVIDER'
  | 'IMAGE_CONFLICT'
  | 'IMAGE_UNAVAILABLE'
  | 'IMAGE_DISPOSED'
  | 'IMAGE_INVALID_REQUEST'
  | 'IMAGE_PROVIDER_FAILED'

/**
 * Structured image failure. Extends {@link HarnessError} with one {@link ImageErrorCode}.
 */
export class ImageError extends HarnessError {
  override readonly code: ImageErrorCode

  constructor(message: string, code: ImageErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/**
 * A caller's generation request. The text `prompt` is required; every refinement is
 * optional. The provider owns endpoint protocols, model selection, and credentials — none
 * of them are part of the request vocabulary, so swapping a provider never changes callers.
 */
export interface ImageGenerateRequest {
  /** The text prompt describing the image to generate. */
  readonly prompt: string
  /** Optional requested image size (for example `1024x1024`); providers interpret the hint. */
  readonly size?: string
  /** Optional number of images to generate (default 1, maximum 10); providers may cap it. */
  readonly n?: number
}

/** One generated image: the raw bytes plus the media type they decode as. */
export interface ImageResult {
  /** Raw image bytes as the endpoint returned them. */
  readonly data: Uint8Array
  /** The media type the bytes decode as (for example `image/png`). */
  readonly mediaType: string
  /** Optional prompt the provider reports it actually applied. */
  readonly revisedPrompt?: string
}

/**
 * An image backend that reserves `ctx.image` and answers generation requests. The
 * provider owns protocol, model, credential, and any size caps; the seam only routes
 * to it.
 */
export interface ImageProvider {
  /** Opaque provider identity reserved atomically at registration. */
  readonly id: string
  /**
   * Generate one image batch against the provider's backend.
   * @param request - the generation request with the text prompt.
   * @param signal - cancellation honored across the request's I/O.
   * @returns the generated image.
   */
  generate(request: ImageGenerateRequest, signal?: AbortSignal): Promise<ImageResult>
}

/**
 * The `ctx.image` surface: a single-provider reservation registry plus the routed
 * `generate` operation. The seam exposes no protocol escape hatch — endpoint shape,
 * model, and credentials are the provider's private concern.
 */
export interface ImageService {
  /**
   * Reserve the seam for one provider. Validate and conflict-check everything before
   * mutating: an invalid or conflicting registration publishes nothing, and its
   * disposer releases the reservation.
   * @param provider - the backend claiming the seam.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: ImageProvider): () => void
  /**
   * Route one generation to the registered provider.
   * @param request - the generation request.
   * @param signal - cancellation forwarded to the provider.
   * @returns the generated image.
   * @throws {@link ImageError} with `IMAGE_UNAVAILABLE` when no provider is registered.
   */
  generate(request: ImageGenerateRequest, signal?: AbortSignal): Promise<ImageResult>
}
