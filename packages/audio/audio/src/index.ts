/**
 * Service Definition for the audio-transcription capability seam (`ctx.audio`): a
 * single-provider reservation registry and one order-independent route — transcribe —
 * over normalized requests.
 *
 * A provider reserves the seam exclusively: {@link Audio.registerProvider} validates and
 * conflict-checks before mutating, so an invalid or conflicting registration publishes
 * nothing, and its disposer releases the reservation. Only one provider may hold the seam
 * at a time — a transcription backend is a whole-corpus claim, not a per-caller route. The
 * seam exposes the one operation and no protocol escape hatch.
 * @module @deepseek-ai/dsh-audio
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { AudioError } from './types.ts'
import type {
  AudioProvider,
  AudioService,
  AudioTranscribeRequest,
  AudioTranscript,
} from './types.ts'

export {
  AudioError,
} from './types.ts'
export type {
  AudioErrorCode,
  AudioProvider,
  AudioService,
  AudioTranscribeRequest,
  AudioTranscript,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    audio: AudioService
  }
}

/**
 * `ctx.audio`. Holds the single reserved provider; the reservation and the route
 * are populated and cleared together so a route always has a live provider.
 */
export class Audio extends Service implements AudioService {
  private provider: AudioProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'audio')
  }

  registerProvider(provider: AudioProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (provider.id.trim() === '') {
      throw new AudioError('an audio provider id must be a non-empty string', 'AUDIO_INVALID_PROVIDER')
    }
    if (this.provider !== undefined) {
      throw new AudioError(
        `audio seam is already held by provider "${this.provider.id}"`,
        'AUDIO_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: Audio) {
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'audio.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /** The single reserved provider or a fail-loud `AUDIO_UNAVAILABLE`. */
  private requireProvider(): AudioProvider {
    const provider = this.provider
    if (provider === undefined) {
      throw new AudioError('no audio provider is registered', 'AUDIO_UNAVAILABLE')
    }
    return provider
  }

  async transcribe(request: AudioTranscribeRequest, signal?: AbortSignal): Promise<AudioTranscript> {
    return this.requireProvider().transcribe(request, signal)
  }
}

export default Audio
