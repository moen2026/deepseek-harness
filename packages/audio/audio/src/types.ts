/**
 * Vocabulary for the audio-transcription capability seam (`ctx.audio`): a transcription
 * request over raw audio bytes, the transcript a provider answers with, the provider
 * contract that reserves the seam, and the `AudioService` surface the seam and its
 * model-facing tool share.
 * @module @deepseek-ai/dsh-audio/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Stable, machine-routable codes for audio failures, carried on {@link AudioError}
 * so callers branch on `code` instead of parsing `message`.
 */
export type AudioErrorCode =
  | 'AUDIO_INVALID_PROVIDER'
  | 'AUDIO_CONFLICT'
  | 'AUDIO_UNAVAILABLE'
  | 'AUDIO_DISPOSED'
  | 'AUDIO_INVALID_REQUEST'
  | 'AUDIO_PROVIDER_FAILED'

/**
 * Structured audio failure. Extends {@link HarnessError} with one {@link AudioErrorCode}.
 */
export class AudioError extends HarnessError {
  override readonly code: AudioErrorCode

  constructor(message: string, code: AudioErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/**
 * A caller's transcription request. The raw audio `data` is required; every refinement is
 * optional. The provider owns endpoint protocols, model selection, and credentials — none
 * of them are part of the request vocabulary, so swapping a provider never changes callers.
 */
export interface AudioTranscribeRequest {
  /** Raw audio file content to transcribe. */
  readonly data: Uint8Array
  /** Optional original file name; providers that need a format hint use its extension. */
  readonly fileName?: string
  /** Optional declared media type (for example `audio/mpeg`); providers may prefer it over the extension. */
  readonly mediaType?: string
  /** Optional ISO 639-1 language hint for the transcription. */
  readonly language?: string
  /** Optional free-text hint (for example known terms) steering the transcription. */
  readonly prompt?: string
}

/** One transcription result: the recognized text plus optional provider-reported metadata. */
export interface AudioTranscript {
  /** The recognized text, as free text. Empty when the audio contains no speech. */
  readonly text: string
  /** Optional ISO 639-1 language the provider detected or applied. */
  readonly language?: string
  /** Optional audio duration in seconds as the provider reports it. */
  readonly durationSec?: number
}

/**
 * An audio backend that reserves `ctx.audio` and answers transcription requests. The
 * provider owns protocol, model, credential, and any size caps beyond the caller's byte
 * budget; the seam only routes to it.
 */
export interface AudioProvider {
  /** Opaque provider identity reserved atomically at registration. */
  readonly id: string
  /**
   * Transcribe one audio payload against the provider's backend.
   * @param request - the transcription request with raw audio bytes.
   * @param signal - cancellation honored across the request's I/O.
   * @returns the transcript.
   */
  transcribe(request: AudioTranscribeRequest, signal?: AbortSignal): Promise<AudioTranscript>
}

/**
 * The `ctx.audio` surface: a single-provider reservation registry plus the routed
 * `transcribe` operation. The seam exposes no protocol escape hatch — endpoint shape,
 * model, and credentials are the provider's private concern.
 */
export interface AudioService {
  /**
   * Reserve the seam for one provider. Validate and conflict-check everything before
   * mutating: an invalid or conflicting registration publishes nothing, and its
   * disposer releases the reservation.
   * @param provider - the backend claiming the seam.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: AudioProvider): () => void
  /**
   * Route one transcription to the registered provider.
   * @param request - the transcription request.
   * @param signal - cancellation forwarded to the provider.
   * @returns the transcript.
   * @throws {@link AudioError} with `AUDIO_UNAVAILABLE` when no provider is registered.
   */
  transcribe(request: AudioTranscribeRequest, signal?: AbortSignal): Promise<AudioTranscript>
}
