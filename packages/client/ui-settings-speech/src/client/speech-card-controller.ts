/**
 * The speech page's live mirror of the synthesis catalog and the writes it
 * accepts. Selections apply immediately through the `tts` Remote namespace —
 * the Host service Config is volatile by design — and the follow stream
 * confirms each change back, so the page never stages a draft.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program, including `tts`.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the generated `tts` namespace on ClientRemote.
import type {} from '@deepseek-ai/dsh-experimental-api-text-to-speech/remote'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ReadAloudEngine, ReadAloudService } from '@deepseek-ai/dsh-client-ui-chat/client'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'

/** One selectable voice, by catalog id and display name. */
export interface SpeechVoiceOption {
  readonly id: string
  readonly name: string
}

/** Facts of the recordings one provider accepts as new voices. */
export interface SpeechIntakeInfo {
  /** Recording media types the provider accepts, e.g. `audio/wav`. */
  readonly accept: readonly string[]
  /** Maximum accepted recording bytes. */
  readonly maxBytes: number
}

/** One synthesis provider and its voice catalog. */
export interface SpeechProviderOption {
  readonly id: string
  readonly name: string
  readonly voices: readonly SpeechVoiceOption[]
  /** Recording intake facts; null when the provider accepts no recordings. */
  readonly intake: SpeechIntakeInfo | null
}

/** What the speech page renders. */
export interface SpeechCardState {
  /** Whether the readiness stream is live; a dead stream keeps the last catalog. */
  readonly connected: boolean
  /** Providers the Host cataloged, in declaration order. */
  readonly providers: readonly SpeechProviderOption[]
  /** Accepted playback engine; `browser` plays through the browser engine. */
  readonly engine: ReadAloudEngine
  /** Provider the current selection names, when the catalog has one. */
  readonly providerId: string | null
  /** Selected voice id. */
  readonly voiceId: string
  /** Selected reading speed. */
  readonly speed: number
  /** Whether a preview is synthesizing or playing. */
  readonly previewing: boolean
  /** Whether a picked recording is uploading and awaiting storage. */
  readonly uploading: boolean
  /** The last configure, preview, or upload failure, cleared by the next successful write. */
  readonly error: string | null
}

/** One selection change the page writes through the `tts` namespace. */
export interface SpeechSelectionPatch {
  readonly providerId?: string
  readonly voiceId?: string
  readonly speed?: number
}

/** The registration-side face the speech page's slot entry injects. */
export interface SpeechCardFace {
  actions: {
    /** Apply one selection change now. */
    configure: (patch: SpeechSelectionPatch) => Promise<void>
    /** Synthesize one short sample with the current selection and play it. */
    preview: () => Promise<void>
    /** Store one picked recording as a new selectable voice and select it. */
    upload: (file: File) => Promise<void>
  }
  hooks: {
    /** Page snapshot bound by the renderer as useSpeechCard. */
    speechCard: SnapshotStore<SpeechCardState>
  }
}

/** Sample text one preview synthesizes; the current selection reads it. */
const PREVIEW_TEXT = '你好，这是当前语音的试听。'

/** Characters a derived voice id keeps; every other run collapses into one dash. */
const VOICE_ID_UNSAFE = /[^A-Za-z0-9_\u4e00-\u9fff-]+/g

/**
 * Derive the selectable voice id a picked recording becomes from its file name.
 * @param name - the picked file's name.
 * @returns the voice id written with the intake request.
 */
function voiceIdFromFileName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '')
  const cleaned = stem.replace(VOICE_ID_UNSAFE, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return cleaned === '' ? 'recording' : cleaned
}

/** The `tts` Remote namespace face the page writes through. */
type TtsNamespace = ClientContext['remote']['tts']

/** The Host's write vocabulary for one selection patch; provider ids are branded there. */
type TtsConfigurePatch = Parameters<TtsNamespace['configure']>[0]

/** The Host's write vocabulary for one recording intake; provider ids are branded there. */
type TtsIntakeRequest = Parameters<TtsNamespace['intakeVoice']>[0]

/** Bridges the `tts` Remote namespace onto the page. */
export class SpeechCardController {
  readonly store: SnapshotStore<SpeechCardState>
  private readonly readiness: ReadAloudService['readiness']
  private readonly engine: ReadAloudService['engine']
  private readonly ttsInjection: { dispose: () => unknown } | undefined
  private tts: TtsNamespace | undefined
  private readonly unsubscribe: () => void
  private readonly unsubscribeEngine: () => void
  private disposed = false
  private cancelPreview: (() => void) | undefined
  private cancelUpload: AbortController | undefined

  /**
   * @param ctx - the page plugin's context; `ctx.readAloud` is the Chat
   * plugin's readiness mirror and synthesizer, present because this package
   * declares the Chat plugin as an inject dependency.
   */
  constructor(private readonly ctx: ClientContext) {
    this.readiness = ctx.readAloud.readiness
    this.engine = ctx.readAloud.engine
    // The page registers only while the readiness stream is live, so the `tts`
    // namespace is present before any write runs; capture it from the injected
    // scope instead of declaring a required plugin service.
    this.ttsInjection = ctx.inject(['remote.tts'], (scope) => { this.tts = scope.remote.tts })
    this.store = createSnapshotStore<SpeechCardState>({
      connected: false, providers: [], engine: 'remote', providerId: null,
      voiceId: '', speed: 1, previewing: false, uploading: false, error: null,
    })
    this.unsubscribe = this.readiness.subscribe(() => { this.observe() })
    this.unsubscribeEngine = this.engine.subscribe(() => { this.observe() })
    this.observe()
  }

  /** Fold the latest readiness snapshot into the page projection. */
  private observe(): void {
    const readiness = this.readiness.getSnapshot()
    const catalog = readiness.catalog
    const providers = catalog === null ? [] : catalog.providers.map(provider => ({
      id: provider.id, name: provider.name,
      voices: (provider.voices ?? []).map(voice => ({ id: voice.id, name: voice.name })),
      intake: provider.intake === undefined ? null : { accept: provider.intake.accept, maxBytes: provider.intake.maxBytes },
    }))
    this.store.set({
      connected: readiness.connected,
      providers,
      engine: this.engine.getSnapshot(),
      providerId: catalog === null ? null : catalog.selection.providerId,
      voiceId: catalog === null ? '' : catalog.selection.voiceId,
      speed: catalog === null ? 1 : catalog.selection.speed,
      previewing: this.store.getSnapshot().previewing,
      uploading: this.store.getSnapshot().uploading,
      error: this.store.getSnapshot().error,
    })
  }

  /**
   * Apply one selection change now; the follow stream confirms it back. A
   * provider switch also resolves a voice the target catalogs, so the Host
   * never rejects the pair the previous provider selected. The browser engine
   * is a client playback choice: it writes no Host state, and choosing a Host
   * provider returns to Host synthesis.
   * @param patch - changed preference fields.
   */
  async configure(patch: SpeechSelectionPatch): Promise<void> {
    if (patch.providerId === 'browser') {
      this.engine.set('browser')
      this.store.set({ ...this.store.getSnapshot(), error: null })
      return
    }
    if (patch.providerId !== undefined) this.engine.set('remote')
    try {
      const tts = this.tts
      if (tts === undefined) throw new Error('Speech synthesis is not connected')
      const applied = this.withTargetVoice(patch)
      // Generated Remote stubs resolve to a result instead of throwing. Every id
      // this page writes is a provider id the catalog it read on the Host branded.
      const result = await tts.configure(applied as TtsConfigurePatch)
      if (!result.ok) throw result.error
      // Echo the accepted write before the follow stream confirms it, so the
      // selectors do not snap back to the previous selection while it travels.
      const snapshot = this.store.getSnapshot()
      this.store.set({ ...snapshot, providerId: applied.providerId ?? snapshot.providerId,
        voiceId: applied.voiceId ?? snapshot.voiceId, speed: applied.speed ?? snapshot.speed, error: null })
    } catch (error) {
      this.store.set({ ...this.store.getSnapshot(), error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Resolve the voice a provider switch writes with the new provider: the
   * current voice when the target catalogs it, otherwise the target's first.
   * Other patches, and targets with no cataloged voice, pass through unchanged.
   * @param patch - changed preference fields.
   * @returns the patch to write, with a voice the target accepts when one is known.
   */
  private withTargetVoice(patch: SpeechSelectionPatch): SpeechSelectionPatch {
    if (patch.providerId === undefined) return patch
    const state = this.store.getSnapshot()
    const target = state.providers.find(candidate => candidate.id === patch.providerId)
    const voices = target?.voices ?? []
    const voiceId = voices.some(voice => voice.id === state.voiceId) ? state.voiceId : voices[0]?.id
    return voiceId === undefined ? patch : { ...patch, voiceId }
  }

  /**
   * Synthesize one short sample with the current selection and play it.
   * A second click while one plays cancels it.
   */
  async preview(): Promise<void> {
    if (this.cancelPreview !== undefined) {
      this.cancelPreview()
      this.cancelPreview = undefined
      this.store.set({ ...this.store.getSnapshot(), previewing: false })
      return
    }
    this.store.set({ ...this.store.getSnapshot(), previewing: true, error: null })
    const settle = (): void => {
      this.cancelPreview = undefined
      if (!this.disposed) this.store.set({ ...this.store.getSnapshot(), previewing: false })
    }
    if (this.engine.getSnapshot() === 'browser') {
      this.cancelPreview = this.ctx.readAloud.speakBrowser(PREVIEW_TEXT, settle)
      return
    }
    try {
      this.cancelPreview = await this.ctx.readAloud.speak(PREVIEW_TEXT, settle)
    } catch (error) {
      this.cancelPreview = undefined
      if (!this.disposed) {
        this.store.set({ ...this.store.getSnapshot(), previewing: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  /**
   * Store one picked recording as a new selectable voice and select it. The
   * follow stream then confirms the refreshed roster back.
   * @param file - recording picked from the page.
   */
  async upload(file: File): Promise<void> {
    this.store.set({ ...this.store.getSnapshot(), uploading: true, error: null })
    const controller = new AbortController()
    this.cancelUpload = controller
    try {
      const tts = this.tts
      if (tts === undefined) throw new Error('Speech synthesis is not connected')
      const snapshot = this.store.getSnapshot()
      const target = snapshot.providers.find(candidate => candidate.id === snapshot.providerId) ?? snapshot.providers[0]
      if (target === undefined || target.intake === null) throw new Error('The selected provider does not accept recordings')
      if (file.size > target.intake.maxBytes) throw new Error(`The recording exceeds the ${target.intake.maxBytes} byte limit`)
      const voiceId = voiceIdFromFileName(file.name)
      const audioBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
      const result = await tts.intakeVoice({ providerId: target.id, voiceId, audioBase64 } as TtsIntakeRequest, controller.signal)
      if (!result.ok) throw result.error
      // Select the stored voice; the follow stream confirms the new roster later.
      await this.configure({ voiceId: result.value.id })
    } catch (error) {
      if (!this.disposed) {
        this.store.set({ ...this.store.getSnapshot(), error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (this.cancelUpload === controller) this.cancelUpload = undefined
      if (!this.disposed) {
        this.store.set({ ...this.store.getSnapshot(), uploading: false })
      }
    }
  }

  /** @returns the face the Plugins page's slot entry injects. */
  inject(): SpeechCardFace {
    return {
      actions: { configure: patch => this.configure(patch), preview: () => this.preview(), upload: file => this.upload(file) },
      hooks: { speechCard: this.store },
    }
  }

  /** Stop observing and any playing preview; idempotent. */
  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.unsubscribeEngine()
    if (this.cancelPreview !== undefined) this.cancelPreview()
    if (this.cancelUpload !== undefined) this.cancelUpload.abort()
    if (this.ttsInjection !== undefined) void this.ttsInjection.dispose()
  }
}
