/**
 * Vocabulary for the video-generation capability seam (`ctx.video`): a generation
 * request over a text prompt with optional size, duration, aspect-ratio,
 * frame-conditioning, and reference-media refinements,
 * the video a provider answers with, the provider contract that reserves the
 * seam, and the `VideoService` surface the seam and its model-facing tool share.
 * @module @deepseek-ai/dsh-video/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Stable, machine-routable codes for video failures, carried on {@link VideoError}
 * so callers branch on `code` instead of parsing `message`.
 */
export type VideoErrorCode =
  | 'VIDEO_INVALID_PROVIDER'
  | 'VIDEO_CONFLICT'
  | 'VIDEO_UNAVAILABLE'
  | 'VIDEO_DISPOSED'
  | 'VIDEO_INVALID_REQUEST'
  | 'VIDEO_PROVIDER_FAILED'

/**
 * Structured video failure. Extends {@link HarnessError} with one {@link VideoErrorCode}.
 */
export class VideoError extends HarnessError {
  override readonly code: VideoErrorCode

  constructor(message: string, code: VideoErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/**
 * A caller's generation request. The text `prompt` is required; every refinement is
 * optional. The provider owns endpoint protocols, model selection, and credentials — none
 * of them are part of the request vocabulary, so swapping a provider never changes callers.
 */
export interface VideoGenerateRequest {
  /** The text prompt describing the video to generate. */
  readonly prompt: string
  /** Optional requested video size (for example `1280x720`); providers interpret the hint. */
  readonly size?: string
  /** Optional requested duration in seconds; providers interpret the hint. */
  readonly duration?: number
  /**
   * Optional publicly reachable URL of one reference image guiding the generation
   * (image-to-video); providers that do not accept reference media ignore it.
   */
  readonly referenceImage?: string
  /**
   * Optional publicly reachable URL of one reference video guiding the generation
   * (video-to-video); providers that do not accept reference media ignore it.
   */
  readonly referenceVideo?: string
  /**
   * Optional publicly reachable URL of one image conditioning the video's first
   * frame; providers that do not accept frame conditioning ignore it.
   */
  readonly firstFrame?: string
  /**
   * Optional publicly reachable URL of one image conditioning the video's last
   * frame; providers that do not accept frame conditioning ignore it.
   */
  readonly lastFrame?: string
  /**
   * Optional publicly reachable URL of one reference audio guiding the generation
   * (audio-to-video); providers that do not accept reference media ignore it.
   */
  readonly referenceAudio?: string
  /** Optional requested aspect ratio (for example `16:9` or `adaptive`); providers interpret the hint. */
  readonly aspectRatio?: string
}

/** One generated video: the raw bytes plus the media type they decode as. */
export interface VideoResult {
  /** Raw video bytes as the endpoint returned them. */
  readonly data: Uint8Array
  /** The media type the bytes decode as (for example `video/mp4`). */
  readonly mediaType: string
}

/**
 * A video backend that reserves `ctx.video` and answers generation requests. The
 * provider owns protocol, model, credential, and any size or duration caps; the
 * seam only routes to it.
 */
export interface VideoProvider {
  /** Opaque provider identity reserved atomically at registration. */
  readonly id: string
  /**
   * Generate one video against the provider's backend.
   * @param request - the generation request with the text prompt.
   * @param signal - cancellation honored across the request's I/O.
   * @returns the generated video.
   */
  generate(request: VideoGenerateRequest, signal?: AbortSignal): Promise<VideoResult>
}

/**
 * The `ctx.video` surface: a single-provider reservation registry plus the routed
 * `generate` operation. The seam exposes no protocol escape hatch — endpoint shape,
 * model, and credentials are the provider's private concern.
 */
export interface VideoService {
  /**
   * Reserve the seam for one provider. Validate and conflict-check everything before
   * mutating: an invalid or conflicting registration publishes nothing, and its
   * disposer releases the reservation.
   * @param provider - the backend claiming the seam.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: VideoProvider): () => void
  /**
   * Route one generation to the registered provider.
   * @param request - the generation request.
   * @param signal - cancellation forwarded to the provider.
   * @returns the generated video.
   * @throws {@link VideoError} with `VIDEO_UNAVAILABLE` when no provider is registered.
   */
  generate(request: VideoGenerateRequest, signal?: AbortSignal): Promise<VideoResult>
}
