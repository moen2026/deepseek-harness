/** JSON-safe inputs and results of the experimental synthesis Remote namespace. */
import type { TtsProviderId, TtsSnapshot } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Text intake limits prevented synthesis. */
    'tts/invalid-text': { readonly reason: string }
    /** Recording intake limits or encoding prevented cloning. */
    'tts/invalid-recording': { readonly reason: string }
    /** The selected provider rejected synthesis. */
    'tts/synthesis-failed': { readonly reason: string }
    /** The selected provider rejected the recording intake. */
    'tts/intake-failed': { readonly reason: string }
  }
}

/** One read-aloud request, separate from Session admission. */
export interface SynthesisRequest {
  readonly text: string
  readonly providerId?: TtsProviderId
}

/** Synthesized waveform delivered as canonical base64 WAV bytes. */
export interface SynthesisResult {
  readonly audioBase64: string
  readonly sampleRate: number
}

/** One voice-cloning request that stores a recording as a new selectable voice. */
export interface VoiceIntakeRequest {
  readonly providerId: TtsProviderId
  /** Selectable voice id the recording becomes; the caller derives it from the recording's name. */
  readonly voiceId: string
  /** Complete recording delivered as canonical base64 bytes in an accepted media type. */
  readonly audioBase64: string
}

/** Current provider choices and intake limits. */
export interface TtsCatalog extends TtsSnapshot {
  readonly maxTextChars: number
  readonly maxAudioBytes: number
  readonly maxReferenceBytes: number
}
