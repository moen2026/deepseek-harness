/** Authenticated, cancellation-aware Client access to speech synthesis. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-text-to-speech'
import type { TtsPreparationOptions, TtsProviderId, TtsSelectionPatch, TtsVoiceInfo } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type { SynthesisRequest, SynthesisResult, TtsCatalog, VoiceIntakeRequest } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental synthesis Remote controller. */
    ttsController: TtsController
  }
}

/** Limits applied before calling a provider. */
export interface Config {
  /** Maximum UTF-16 code units of text per request. */
  maxTextChars: number
  /** Maximum encoded WAV bytes per request result. */
  maxAudioBytes: number
  /** Maximum accepted recording bytes per intake request. */
  maxReferenceBytes: number
}

/** Synthesis calls never activate or submit to an Agent. */
export default class TtsController extends TypertRemoteService {
  static inject = ['textToSpeech', 'typert']
  static Config: z<Config> = z.object({
    maxTextChars: z.natural().min(1).default(4000),
    maxAudioBytes: z.natural().min(44).default(32 * 1024 * 1024),
    maxReferenceBytes: z.natural().min(1).default(16 * 1024 * 1024),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'ttsController', { namespace: 'tts' })
  }

  /**
   * Read provider choices without preparing a synthesizer.
   * @returns available providers, resolved default, and text limits.
   */
  @Remote
  catalog(): TtsCatalog {
    return { ...this.ctx.textToSpeech.snapshot(), ...this.config }
  }

  /**
   * Follow provider readiness independently of Session and preparation lifetimes.
   * @param signal - Client observation lifetime.
   * @returns initial and subsequent complete readiness snapshots.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<TtsCatalog> {
    for await (const snapshot of this.ctx.textToSpeech.follow(signal)) yield { ...snapshot, ...this.config }
  }

  /**
   * Persist the user's synthesis preferences.
   * @param patch - changed preference fields.
   * @returns after preferences are saved.
   */
  @Remote
  configure(patch: TtsSelectionPatch): Promise<void> { return this.ctx.textToSpeech.configure(patch) }

  /**
   * Start or join one Host-owned preparation task.
   * @param providerId - selected synthesizer.
   * @param options - task-local source selection validated by the provider.
   */
  @Remote
  prepare(providerId: TtsProviderId, options?: TtsPreparationOptions): void { this.ctx.textToSpeech.prepare(providerId, options) }

  /**
   * Explicitly cancel resource preparation.
   * @param providerId - selected synthesizer.
   * @returns after the preparation task settles.
   */
  @Remote
  cancelPreparation(providerId: TtsProviderId): Promise<void> { return this.ctx.textToSpeech.cancelPreparation(providerId) }

  /**
   * Validate and synthesize one text through the explicit provider selection.
   * @param request - read-aloud text and optional provider id.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns complete WAV audio encoded as base64 without adding a Session event.
   */
  @Remote
  async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    signal.throwIfAborted()
    if (request.text.length > this.config.maxTextChars) {
      throw new RemoteError('tts/invalid-text', 'Text exceeds the configured character limit', { reason: 'size' })
    }
    try {
      const spec = this.ctx.textToSpeech.resolve({
        text: request.text,
        ...request.providerId === undefined ? {} : { providerId: request.providerId },
      })
      const synthesis = await this.ctx.textToSpeech.synthesize(spec, signal)
      const audioBase64 = Buffer.from(synthesis.audio).toString('base64')
      if (audioBase64.length > Math.ceil(this.config.maxAudioBytes / 3) * 4) {
        throw new Error('Audio exceeds the configured byte limit')
      }
      return { audioBase64, sampleRate: synthesis.sampleRate }
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('tts/synthesis-failed', reason, { reason })
    }
  }

  /**
   * Validate and store one recording as a selectable voice.
   * @param request - provider id, new voice id, and canonical base64 recording bytes.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns the selectable voice once the provider's roster reflects it.
   */
  @Remote
  async intakeVoice(request: VoiceIntakeRequest, signal: AbortSignal): Promise<TtsVoiceInfo> {
    signal.throwIfAborted()
    const encoded = request.audioBase64
    if (encoded.length > Math.ceil(this.config.maxReferenceBytes / 3) * 4) {
      throw new RemoteError('tts/invalid-recording', 'Recording is invalid or exceeds the configured byte limit', { reason: 'encoding-or-size' })
    }
    const audio = Buffer.from(encoded, 'base64')
    try {
      if (audio.toString('base64') !== encoded) throw new Error('Recording must use canonical base64 encoding')
      if (audio.length > this.config.maxReferenceBytes) throw new Error('Recording exceeds the configured byte limit')
      return await this.ctx.textToSpeech.intakeVoice(request.providerId, { voiceId: request.voiceId, audio }, signal)
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('tts/intake-failed', reason, { reason })
    }
  }
}
