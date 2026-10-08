/** Shared lifecycle for one serial managed local speech worker with idle reclamation. */
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SpeechPreparationOptions, SpeechPreparationState, SpeechPreparationStep, SpeechPreparationStepKind } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { SpeechDownloadError } from './download-error.ts'
import { readReady } from './protocol.ts'
import { SpeechInputError } from './speech-input.ts'

/** Authenticated connection to one started worker. */
export interface WorkerConnection {
  readonly handle: SubprocessHandle
  readonly url: string
  readonly token: string
  closed: boolean
}

/** Prepared runtime resolution returned by provider hooks. */
export interface WorkerRuntime {
  /** Worker entry script resolved for spawning. */
  readonly worker: string
}

/** Lifecycle settings shared by local speech providers; each provider Config extends them. */
export interface ManagedWorkerConfig {
  /** Absolute provider-owned cache directory. */
  dataRoot: string
  /** Explicit origin; bypasses automatic selection and public fallback. */
  modelOrigin?: string | undefined
  /** Origins compared before downloading each missing asset. */
  modelOrigins: string[]
  /** Deadline for runtime preparation and cold resource loading. */
  prepareTimeoutMs: number
  /** Deadline for one worker call after the worker is ready. */
  inferenceTimeoutMs: number
  /** Idle period before stopping the worker; zero keeps it warm. */
  idleTimeoutMs: number
  /** Maximum accepted running and waiting calls. */
  maxPending: number
  /** Managed process termination grace period. */
  graceMs: number
  /** Maximum retained worker diagnostic bytes. */
  maxLogBytes: number
  /** Minimum interval between intermediate download progress notifications. */
  progressIntervalMs: number
}

/** Provider-owned behavior injected into the shared managed worker lifecycle. */
export interface ManagedWorkerHooks<C extends ManagedWorkerConfig, R extends WorkerRuntime, I, O> {
  /** Preparation step kinds published in order for this provider. */
  readonly stepKinds: readonly SpeechPreparationStepKind[]
  /** Origins advertised for explicit download-source selection. */
  readonly downloadSources: readonly string[]
  /** Rejection message used when disposal interrupts pending work. */
  readonly disposeMessage: string
  readonly runtime: {
    /** Inspect existing disk caches without downloading, writing files or starting a worker. */
    inspect(ctx: Context, config: C, signal: AbortSignal): Promise<R | undefined>
    /** Resolve the bundled runtime and prepare verified resources on demand. */
    prepare(ctx: Context, config: C, signal: AbortSignal, report: (state: SpeechPreparationState) => void): Promise<R>
  }
  /** Perform one authenticated worker call under the inference deadline. */
  readonly call: (worker: WorkerConnection, input: I, config: C, signal: AbortSignal) => Promise<O>
}

/** Own one worker across calls, and join every accepted job on disposal. */
export class ManagedSpeechWorker<C extends ManagedWorkerConfig, R extends WorkerRuntime, I, O> {
  private worker: WorkerConnection | undefined
  private tail: Promise<void> = Promise.resolve()
  private pending = 0
  private readonly lifetime = new AbortController()
  private idle: ReturnType<typeof setTimeout> | undefined
  private runtime: R | undefined
  private state: SpeechPreparationState & { readonly steps: readonly SpeechPreparationStep[] }
  private readonly listeners = new Set<() => void>()
  private lastProgressAt = 0
  private preparing: { abort: AbortController; settled: Promise<void>; completed: boolean; downloadSource: string | undefined } | undefined

  constructor(private readonly ctx: Context, private readonly config: C, private readonly hooks: ManagedWorkerHooks<C, R, I, O>) {
    this.state = { phase: 'unprepared', steps: hooks.stepKinds.map(kind => ({ kind, status: 'pending' })) }
  }

  /** Configured origins available for explicit downloads; offline deployments expose no choices. */
  get downloadSources(): readonly string[] { return this.hooks.downloadSources }

  /**
   * Read preparation readiness.
   * @returns the current Host-owned state.
   */
  snapshot(): SpeechPreparationState { return this.state }

  /**
   * Observe readiness.
   * @param listener - invalidation callback.
   * @returns subscription disposer.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(state: SpeechPreparationState): void {
    if (this.preparing && ['ready', 'standby', 'unprepared', 'failed', 'cancelled'].includes(state.phase)) {
      this.preparing.completed = true
    }
    const previous = this.state
    const steps = state.steps ?? previous.steps.map((item): SpeechPreparationStep => {
      if (state.phase === 'ready') return { ...item, status: 'complete' }
      if (state.step === 'check' && item.kind !== 'check') return { kind: item.kind, status: 'pending' }
      if (state.step === item.kind) return item.status === 'running' ? item
        : { kind: item.kind, status: 'running', startedAt: Date.now() }
      if (item.status !== 'running') return item
      if (state.phase === 'standby') return { ...item, status: 'cancelled' }
      if (state.phase === 'failed' || state.phase === 'cancelled') return { ...item, status: state.phase }
      return state.step === undefined ? item : { ...item, status: 'complete' }
    })
    this.state = { ...state, steps }
    const now = performance.now()
    if (state.phase === 'downloading' && previous.phase === 'downloading' && state.resource === previous.resource
      && state.completedBytes !== state.totalBytes && now - this.lastProgressAt < this.config.progressIntervalMs) return
    this.lastProgressAt = now
    for (const listener of this.listeners) listener()
  }

  /** Inspect disk caches on activation; valid resources enter standby without starting a worker. */
  inspect(): void {
    this.runPreparation(async (signal) => {
      using inspection = deadline(signal, this.config.prepareTimeoutMs, 'SPEECH_PREPARE_TIMEOUT')
      this.publish({ phase: 'checking', step: 'check', startedAt: Date.now() })
      const runtime = await this.hooks.runtime.inspect(this.ctx, this.config, inspection.signal)
      inspection.signal.throwIfAborted()
      this.runtime = runtime
      this.publish({ phase: runtime ? 'standby' : 'unprepared', steps: this.state.steps.map(({ kind }) => ({ kind,
        status: kind === 'check' || runtime && kind !== 'load' ? 'complete' : 'pending',
      })) })
    })
  }

  /**
   * Start or join one Host-owned preparation task with a fixed download source.
   * @param options - omitted source uses deployment policy; a manual source must be advertised and disables fallback.
   */
  prepare(options: SpeechPreparationOptions = {}): void {
    const source = options.downloadSource
    if (source !== undefined && !this.hooks.downloadSources.includes(source)) throw new Error('Speech download source is unavailable')
    const config = source === undefined ? this.config : Object.assign({}, this.config, { modelOrigin: source })
    this.runPreparation(async (signal) => { await this.start(signal, config) }, source)
  }

  private runPreparation(run: (signal: AbortSignal) => Promise<void>, downloadSource?: string): void {
    if (this.preparing && this.preparing.downloadSource !== downloadSource) throw new Error('Cancel preparation before changing its download source')
    if (this.preparing || this.worker) return
    this.lifetime.signal.throwIfAborted()
    const abort = new AbortController()
    const task = { abort, settled: Promise.resolve(), completed: false, downloadSource }
    this.preparing = task
    task.settled = this.enqueue(run, abort.signal)
      .catch((error: unknown) => {
        if (this.lifetime.signal.aborted) return
        this.publish(abort.signal.aborted ? { phase: 'cancelled' }
          : { phase: 'failed', message: error instanceof Error ? error.message : String(error),
            ...error instanceof SpeechDownloadError ? { download: error.download } : {} })
      }).finally(() => { this.preparing = undefined })
  }

  /** Cancel unfinished preparation; completed readiness is retained. @returns after its queued or active work settles. */
  async cancel(): Promise<void> {
    const task = this.preparing
    if (!task) return
    if (!task.completed) {
      this.publish({ phase: 'cancelling', startedAt: Date.now() })
      task.abort.abort(new Error('Speech preparation cancelled'))
    }
    await task.settled
  }

  /**
   * Queue one bounded call; cancellation never leaves work running after settlement.
   * Verified resources accept calls while the worker wakes; other preparation states reject without downloading.
   * @param input - one provider-defined call payload.
   * @param signal - caller cancellation.
   * @returns the provider-defined result; cancelled waiting jobs never acquire the worker.
   */
  async call(input: I, signal: AbortSignal): Promise<O> {
    return await this.enqueue(async combined => await this.execute(input, combined), signal)
  }

  private async enqueue<T>(run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    if (this.pending >= this.config.maxPending) throw new Error('Speech worker queue is full')
    clearTimeout(this.idle)
    this.pending++
    const job = this.tail.then(async () => {
      combined.throwIfAborted()
      return await run(combined)
    })
    this.tail = job.then(() => undefined, () => undefined).finally(() => {
      this.pending--
      if (this.pending === 0 && !this.lifetime.signal.aborted && this.config.idleTimeoutMs > 0) {
        this.idle = setTimeout(() => {
          this.tail = this.tail.then(async () => { await this.stop() })
          void this.tail.catch((error: unknown) => { this.ctx.logger.warn('Speech worker idle cleanup failed', error) })
        }, this.config.idleTimeoutMs)
      }
    })
    return await job
  }

  private async start(signal: AbortSignal, preparationConfig: C = this.config): Promise<WorkerConnection> {
    if (this.worker?.closed) await this.stop()
    if (this.worker) return this.worker
    using setup = deadline(signal, this.config.prepareTimeoutMs, 'SPEECH_PREPARE_TIMEOUT')
    const cached = this.runtime !== undefined
    if (!cached) this.publish({ phase: 'checking', step: 'check', startedAt: Date.now() })
    const runtime = this.runtime ?? await this.hooks.runtime.prepare(
      this.ctx, preparationConfig, setup.signal, (state) => { this.publish(state) })
    this.runtime = runtime
    setup.signal.throwIfAborted()
    this.publish({ phase: cached ? 'waking' : 'loading', step: 'load', startedAt: Date.now() })
    await mkdir(this.config.dataRoot, { recursive: true })
    const token = randomBytes(32).toString('hex')
    const handle = this.ctx.subprocess.spawn({
      argv: [process.execPath, ...runtime.worker.endsWith('.ts') ? ['--import', import.meta.resolve('tsx/esm')] : [], runtime.worker, JSON.stringify(Object.assign({}, this.config, runtime))],
      cwd: this.config.dataRoot, graceMs: this.config.graceMs,
      env: { DSH_SPEECH_TOKEN: token, ELECTRON_RUN_AS_NODE: '1' },
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: this.config.maxLogBytes } },
    })
    try {
      const port = await readReady(handle, this.config.maxLogBytes, setup.signal)
      const worker = { handle, url: `http://127.0.0.1:${port}`, token, closed: false }
      this.worker = worker
      this.publish({ phase: 'ready' })
      const exited = (): void => {
        if (!worker.closed) { worker.closed = true; this.publish({ phase: 'standby' }) }
      }
      void handle.done.then(exited, exited)
      return worker
    } catch (error) {
      handle.terminate()
      await handle.waitForExit()
      throw error
    }
  }

  private async execute(input: I, signal: AbortSignal): Promise<O> {
    const phase = this.state.phase
    if (phase !== 'ready' && phase !== 'standby') throw new Error('Prepare the local speech provider first')
    try {
      const worker = await this.start(signal)
      using call = deadline(signal, this.config.inferenceTimeoutMs, 'SPEECH_INFERENCE_TIMEOUT')
      const result = await this.hooks.call(worker, input, this.config, call.signal).catch((error: unknown) => {
        call.signal.throwIfAborted()
        throw error
      })
      call.signal.throwIfAborted()
      return result
    } catch (error) {
      if (error instanceof SpeechInputError) throw error
      await this.stop()
      this.publish({ phase: 'standby' })
      throw error
    }
  }

  private async stop(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    worker.closed = true
    worker.handle.terminate()
    await worker.handle.waitForExit()
    this.worker = undefined
    this.publish({ phase: 'standby' })
  }

  /** Stop the managed worker. @returns after admission closes, queued jobs settle, and the worker exits. */
  async dispose(): Promise<void> {
    this.listeners.clear()
    this.lifetime.abort(new Error(this.hooks.disposeMessage))
    clearTimeout(this.idle)
    try { await this.tail } finally { await this.stop() }
    await this.preparing?.settled
  }
}
