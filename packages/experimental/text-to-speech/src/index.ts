/** Named synthesis providers with disposable registration and explicit routing. */
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: the `settings` service that persists `configure()` into this plugin's profile entry, and the Loader's
// entry and `loader/volatile-update` merges.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { TtsPreparationOptions, TtsProvider, TtsProviderId, TtsProviderInfo, TtsSelectionPatch, TtsRequest, TtsSnapshot, TtsSpec, TtsSynthesis, TtsInput, TtsVoiceIntake, TtsVoiceInfo } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental speech synthesis provider registry. */
    textToSpeech: TextToSpeech
  }
}

/** Live selection read before a synthesis starts; `configure()` writes it through the profile. */
export interface Config {
  /** Registered provider selected when the caller omits an id; unset compositions resolve the sole registered provider. */
  defaultProvider: Volatile<string | undefined>
  /** Voice selected when the caller and provider defaults do not apply. */
  voiceId: Volatile<string>
  /** Speech rate selected when the caller omits one. */
  speed: Volatile<number>
}

interface Registration {
  readonly provider: TtsProvider
  readonly lifetime: AbortController
  readonly pending: Set<Promise<unknown>>
  readonly unsubscribe: () => void
}

/** Registry shared by all synthesis consumers in one Host composition. */
export default class TextToSpeech extends Service {
  static Config = z.object({
    defaultProvider: z.string().min(1).volatile().required(false),
    voiceId: z.string().min(1).volatile().default('zf_001'),
    speed: z.number().min(0.5).max(2).default(1).volatile(),
  })

  private readonly providers = new Map<TtsProviderId, Registration>()
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  /** Profile-local entry id used by Settings; absent when the plugin was mounted without Loader. */
  private readonly entryId: string | undefined

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'textToSpeech')
    this.entryId = ctx.fiber.entry?.options.id
    ctx.on('loader/volatile-update', () => { this.changed() })
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Speech service disposed'))
      await Promise.all([...this.providers.values()].map(registration => this.remove(registration)))
      this.listeners.clear()
    })
  }

  /**
   * Register one synthesizer; duplicate ids fail without replacing the original.
   * @param provider - synthesizer owned by the contributing fiber.
   * @returns idempotent disposer which rejects admission, cancels, and joins accepted work.
   */
  register(provider: TtsProvider): () => Promise<void> {
    this.lifetime.signal.throwIfAborted()
    if (this.providers.has(provider.info.id)) throw new Error(`Speech provider already registered: ${provider.info.id}`)
    const registration: Registration = { provider, lifetime: new AbortController(), pending: new Set(),
      unsubscribe: provider.preparation?.subscribe(() => { this.changed() }) ?? (() => {}) }
    this.providers.set(provider.info.id, registration)
    this.changed()
    return async () => { await this.remove(registration) }
  }

  private async remove(registration: Registration): Promise<void> {
    if (this.providers.get(registration.provider.info.id) !== registration) return
    this.providers.delete(registration.provider.info.id)
    registration.unsubscribe()
    this.changed()
    registration.lifetime.abort(new Error('Speech provider unloaded'))
    await Promise.allSettled(registration.pending)
  }

  /**
   * Read the current synthesizer roster.
   * @returns available provider facts in registration order.
   */
  listProviders(): readonly TtsProviderInfo[] {
    return [...this.providers.values()].map(({ provider }) => provider.info)
  }

  /**
   * Re-read provider facts after a provider changed facts it owns outside
   * registration — its `voices` roster, for example; readiness followers
   * receive a new snapshot and read the announced facts live.
   */
  catalogChanged(): void { this.changed() }

  private changed(): void { for (const listener of this.listeners) listener() }

  /** The configured default, or the sole registered provider; ambiguous rosters fail loudly. */
  private defaultProviderId(): TtsProviderId {
    const configured = this.config.defaultProvider.get()
    if (configured !== undefined) return configured as TtsProviderId
    if (this.providers.size === 1) return this.providers.keys().next().value as TtsProviderId
    throw new Error('Speech synthesis requires a defaultProvider configuration when the composition registers zero or multiple providers')
  }

  /**
   * Observe complete readiness snapshots; a slow reader coalesces intermediate progress.
   * @param caller - observer lifetime, independent of any preparation task.
   * @returns an initial snapshot followed by the latest provider states.
   */
  async *follow(caller: AbortSignal): AsyncIterable<TtsSnapshot> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    let wake = Promise.withResolvers<undefined>()
    let changed = true
    const aborted = (): boolean => signal.aborted
    const notify = (): void => { changed = true; wake.resolve(undefined) }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!aborted()) {
        if (!changed) await wake.promise
        if (aborted()) break
        wake = Promise.withResolvers<undefined>(); changed = false
        yield this.snapshot()
      }
    } finally {
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }

  /**
   * Read provider readiness and current user preferences together.
   * @returns one detached complete observation.
   */
  snapshot(): TtsSnapshot {
    return { providers: [...this.providers.values()].map(({ provider }) => ({ ...provider.info,
      preparation: provider.preparation?.snapshot() ?? { phase: 'ready' },
    })), selection: { providerId: this.defaultProviderId(),
      voiceId: this.config.voiceId.get(), speed: this.config.speed.get() } }
  }

  /**
   * Persist changed selection fields into this plugin's profile entry; the resulting voice must be accepted by the selected provider.
   * @param patch - explicit provider, voice, or rate changes.
   * @returns after the profile write and the live update it applies.
   */
  async configure(patch: TtsSelectionPatch): Promise<void> {
    const settings = this.ctx.get('settings')
    const entry = this.entryId
    if (settings === undefined || entry === undefined) throw new Error('Speech selection requires the settings service and a profile entry')
    const id = patch.providerId ?? this.defaultProviderId()
    this.selectedProvider(id, patch.voiceId ?? this.config.voiceId.get(), patch.speed ?? this.config.speed.get())
    await settings.update(entry, { ...patch.providerId === undefined ? {} : { defaultProvider: patch.providerId },
      ...patch.voiceId === undefined ? {} : { voiceId: patch.voiceId },
      ...patch.speed === undefined ? {} : { speed: patch.speed } })
  }

  private selectedProvider(id: TtsProviderId, voiceId: string, speed: number): TtsProvider {
    const registration = this.providers.get(id)
    if (!registration) throw new Error(`Speech provider is unavailable: ${id}`)
    const voices = registration.provider.info.voices
    if (voices !== undefined && voices.length > 0 && !voices.some(voice => voice.id === voiceId)) {
      throw new Error(`Speech provider ${id} does not support voice: ${voiceId}`)
    }
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error(`Speech provider ${id} does not support speed: ${speed}`)
    return registration.provider
  }

  /**
   * Start or join provider-owned preparation.
   * @param id - exact registered provider identity.
   * @param options - task-local source selection validated by the provider.
   */
  prepare(id: TtsProviderId, options?: TtsPreparationOptions): void {
    const registration = this.providers.get(id)
    if (!registration) throw new Error(`Speech provider is unavailable: ${id}`)
    registration.provider.preparation?.prepare(options)
  }

  /**
   * Explicitly cancel provider preparation without tying it to a browser connection.
   * @param id - exact registered provider identity.
   * @returns after the preparation task settles.
   */
  async cancelPreparation(id: TtsProviderId): Promise<void> {
    const registration = this.providers.get(id)
    if (!registration) throw new Error(`Speech provider is unavailable: ${id}`)
    await registration.provider.preparation?.cancel()
  }

  /**
   * Store one recording as a selectable voice through the exact provider.
   * @param id - exact registered provider identity.
   * @param intake - target voice id and complete recording bytes.
   * @param signal - caller cancellation.
   * @returns the selectable voice after the provider's roster reflects it.
   */
  async intakeVoice(id: TtsProviderId, intake: TtsVoiceIntake, signal: AbortSignal): Promise<TtsVoiceInfo> {
    signal.throwIfAborted()
    const registration = this.providers.get(id)
    if (!registration) throw new Error(`Speech provider is unavailable: ${id}`)
    const submit = registration.provider.intake
    if (submit === undefined) throw new Error(`Speech provider does not accept recordings: ${id}`)
    const combined = AbortSignal.any([signal, registration.lifetime.signal])
    const pending = Promise.resolve().then(() => {
      combined.throwIfAborted()
      return submit(intake, combined)
    })
    registration.pending.add(pending)
    try {
      const result = await pending
      combined.throwIfAborted()
      return result
    } finally {
      registration.pending.delete(pending)
    }
  }

  /**
   * Apply composition defaults and capture the selected provider. Missing providers and unsupported voices fail explicitly.
   * @param request - complete text and optional selection.
   * @returns provider-pinned input for synthesize().
   */
  resolve(request: TtsRequest): TtsSpec {
    const id = request.providerId ?? this.defaultProviderId()
    const voiceId = request.voiceId ?? this.config.voiceId.get()
    const speed = request.speed ?? this.config.speed.get()
    return { provider: this.selectedProvider(id, voiceId, speed), text: request.text, voiceId, speed }
  }

  /**
   * Execute exactly the resolved provider; no fallback sends text elsewhere.
   * @param spec - resolved input; a withdrawn or replaced registration is rejected.
   * @param signal - caller cancellation.
   * @returns synthesized WAV audio after provider settlement.
   */
  async synthesize(spec: TtsSpec, signal: AbortSignal): Promise<TtsSynthesis> {
    signal.throwIfAborted()
    const registration = this.providers.get(spec.provider.info.id)
    if (registration?.provider !== spec.provider) throw new Error('Resolved speech provider is no longer registered')
    const combined = AbortSignal.any([signal, registration.lifetime.signal])
    const input: TtsInput = {
      text: spec.text,
      ...spec.voiceId === undefined ? {} : { voiceId: spec.voiceId },
      ...spec.speed === undefined ? {} : { speed: spec.speed },
    }
    const pending = Promise.resolve().then(() => {
      combined.throwIfAborted()
      return spec.provider.synthesize(input, combined)
    })
    registration.pending.add(pending)
    try {
      const result = await pending
      combined.throwIfAborted()
      return result
    } finally {
      registration.pending.delete(pending)
    }
  }
}
