/** Provider-neutral speech synthesis inputs and registration metadata. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SpeechDownloadFailure, SpeechPreparationOptions, SpeechPreparationState, SpeechPreparationStep, SpeechPreparationStepKind, SpeechSetupEstimate } from '@deepseek-ai/dsh-experimental-speech-to-text/types'

/** Configured identity of one synthesis provider. */
export type TtsProviderId = Branded<'TtsProviderId'>

/** Provider-specific planning estimates, not measured progress or guaranteed resource limits. */
export type TtsSetupEstimate = SpeechSetupEstimate

/** Safe download diagnostics for localized preparation guidance. */
export type TtsDownloadFailure = SpeechDownloadFailure

/** Host-owned preparation state; byte totals describe downloads, never estimated installation percentages. */
export type TtsPreparationState = SpeechPreparationState

/** One Host-owned operation; only its running state has a live elapsed clock. */
export type TtsPreparationStep = SpeechPreparationStep

/** Ordered resource-preparation operations understood by the speech UI. */
export type TtsPreparationStepKind = SpeechPreparationStepKind

/** Download choice for one preparation task; omission keeps the provider's configured selection policy. */
export type TtsPreparationOptions = SpeechPreparationOptions

/** One selectable synthesis voice. */
export interface TtsVoiceInfo {
  /** Stable voice id understood by the provider, e.g. `zf_001`. */
  readonly id: string
  readonly name: string
}

/** Public provider facts; credentials and filesystem paths are excluded. */
export interface TtsProviderInfo {
  readonly id: TtsProviderId
  readonly name: string
  readonly location: 'host-local' | 'cloud'
  /** Synthesizable voices; the first entry is the provider default when a caller omits one. */
  readonly voices?: readonly TtsVoiceInfo[]
  readonly setupEstimate?: TtsSetupEstimate
  /** Origins offered for an explicit preparation download; omitted or empty when no choice applies. */
  readonly downloadSources?: readonly string[]
  /** Recording intake facts; omitted when the provider accepts no recordings. */
  readonly intake?: TtsVoiceIntakeInfo
}

/** Facts of the recordings one provider accepts as new voices. */
export interface TtsVoiceIntakeInfo {
  /** Recording media types the provider accepts, e.g. `audio/wav`. */
  readonly accept: readonly string[]
  /** Maximum accepted recording bytes. */
  readonly maxBytes: number
}

/** One recorded reference offered as a selectable voice. */
export interface TtsVoiceIntake {
  /** Selectable voice id the recording becomes; also its reference file stem. */
  readonly voiceId: string
  /** Complete recording bytes in one of the provider's accepted media types. */
  readonly audio: Uint8Array
}

/** Provider facts and its current resource readiness; independent of plugin activation. */
export interface TtsProviderView extends TtsProviderInfo {
  readonly preparation: TtsPreparationState
}

/** Host-persisted default selection captured when a synthesis request starts. */
export interface TtsSelection {
  readonly providerId: TtsProviderId
  readonly voiceId: string
  readonly speed: number
}

/** User intent updates only the preference fields explicitly changed. */
export interface TtsSelectionPatch {
  readonly providerId?: TtsProviderId
  readonly voiceId?: string
  readonly speed?: number
}

/** One consistent provider roster and default-selection observation. */
export interface TtsSnapshot {
  readonly providers: readonly TtsProviderView[]
  readonly selection: TtsSelection
}

/** Optional resource preparation controls. Providers without them are immediately usable. */
export interface TtsPreparation {
  /** @returns the latest Host-owned state. */
  snapshot(): TtsPreparationState
  /** @param listener - state invalidation callback. @returns subscription disposer. */
  subscribe(listener: () => void): () => void
  /**
   * Start or join the current preparation task; page and transport lifetimes do not own it.
   * @param options - task-local download selection; providers reject changing the source of active work.
   */
  prepare(options?: TtsPreparationOptions): void
  /** Cancel preparation. @returns after its resources settle. */
  cancel(): Promise<void>
}

/** One synthesis request before provider defaults are applied. */
export interface TtsInput {
  readonly text: string
  /** Omission resolves the selected provider's default voice. */
  readonly voiceId?: string
  /** Speech rate multiplier; omission resolves the configured preference. */
  readonly speed?: number
}

/** Synthesized waveform; bytes are a complete WAV container. */
export interface TtsSynthesis {
  readonly audio: Uint8Array
  readonly sampleRate: number
}

/** One replaceable synthesizer. It owns preparation, execution, and cancellation. */
export interface TtsProvider {
  readonly info: TtsProviderInfo
  readonly preparation?: TtsPreparation
  /**
   * Store one recording as a selectable voice; the provider publishes the refreshed roster.
   * @param intake - target voice id and complete recording bytes.
   * @param signal - caller or registration cancellation.
   * @returns the selectable voice after the provider's roster reflects it.
   */
  intake?(intake: TtsVoiceIntake, signal: AbortSignal): Promise<TtsVoiceInfo>
  /**
   * Synthesize one text without submitting an Agent message.
   * @param input - text, optional voice, and rate, borrowed until settlement.
   * @param signal - caller or registration cancellation; rejection follows resource cleanup.
   * @returns complete WAV audio and its sample rate.
   */
  synthesize(input: TtsInput, signal: AbortSignal): Promise<TtsSynthesis>
}

/** Caller selection before composition defaults are resolved. */
export interface TtsRequest extends TtsInput {
  readonly providerId?: TtsProviderId
}

/** Resolved selection pins the exact registered provider, including its lifetime. */
export interface TtsSpec extends TtsInput {
  readonly provider: TtsProvider
}
