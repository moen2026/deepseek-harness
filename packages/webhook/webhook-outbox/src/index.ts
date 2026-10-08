/** Durable at-least-once queue for webhook deliveries dispatched with acknowledgment. */

import { Buffer } from 'node:buffer'
import z from '@deepseek-ai/schemastery'
import { Context, Service } from '@deepseek-ai/cordis'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { VerifiedWebhookDelivery } from '@deepseek-ai/dsh-webhook'
import { snapshotDelivery } from '@deepseek-ai/dsh-webhook'
import { webhookOutboxDomain } from './spec.ts'
import type { WebhookOutboxDelivery, WebhookOutboxKey } from './spec.ts'

export * from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable at-least-once webhook delivery queue. */
    webhookOutbox: WebhookOutbox
  }
}

/** Configuration of the durable webhook outbox. */
export interface Config {
  /** Dispatch attempts allowed per delivery before its record becomes `failed`. */
  maxAttempts: number
  /** Delay before retrying a delivery whose dispatch was not acknowledged, in milliseconds. */
  retryBackoffMs: number
  /** Retained window for terminal records, in milliseconds; older records are pruned. */
  retentionMs: number
}

const noop = (): void => {}

/** Derive the durable key: the delivery's provider triple as one base64url path segment. */
function outboxKey(delivery: VerifiedWebhookDelivery): WebhookOutboxKey {
  const triple = JSON.stringify([delivery.kind, delivery.source, delivery.deliveryId])
  return Buffer.from(triple, 'utf8').toString('base64url') as WebhookOutboxKey
}

/** Rebuild the dispatch payload from one stored record. */
function recordDelivery(record: WebhookOutboxDelivery): VerifiedWebhookDelivery {
  return {
    kind: record.kind,
    source: record.source,
    deliveryId: record.deliveryId,
    event: record.event,
    receivedAt: record.receivedAt,
  }
}

/** One fresh `pending` record for a validated snapshot. */
function pendingRecord(snapshot: VerifiedWebhookDelivery): WebhookOutboxDelivery {
  return {
    kind: snapshot.kind,
    source: snapshot.source,
    deliveryId: snapshot.deliveryId,
    event: snapshot.event,
    receivedAt: snapshot.receivedAt,
    state: 'pending',
    attempts: 0,
    updatedAt: Date.now(),
  }
}

/**
 * Durable at-least-once queue: `deliver` persists one verified delivery before
 * any rule runs, and every dispatch the runtime does not acknowledge is retried
 * with the configured backoff and replayed on the next open.
 */
export class WebhookOutbox extends Service {
  static inject = ['webhookRuntime', 'storageDomain']

  static Config: z<Config> = z.object({
    maxAttempts: z.number().step(1).min(1),
    retryBackoffMs: z.number().step(1).min(1),
    retentionMs: z.number().step(1).min(1),
  })

  private readonly ready: Promise<Domain<typeof webhookOutboxDomain>>
  private readonly initialized: PromiseLike<unknown>
  private ingestChain: Promise<unknown> = Promise.resolve()
  private processChain: Promise<unknown> = Promise.resolve()
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>()
  private closing = false

  /**
   * @param ctx - Host services owning webhook dispatch and durable storage.
   * @param config - Validated attempt, backoff, and retention bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'webhookOutbox')
    this.ready = ctx.storageDomain.open(webhookOutboxDomain)
    this.initialized = ctx.effect(async () => {
      const domain = await this.ready
      let cleanup: () => Promise<void>
      try {
        cleanup = ctx.effect(() => async () => {
          this.closing = true
          this.clearRetryTimers()
          // Both chains settle their own failures; these awaits are drain barriers.
          await this.ingestChain
          await this.processChain
          await domain.close()
        })
      } catch (error) {
        this.closing = true
        await domain.close()
        throw error
      }
      const deliveries = domain.table('deliveries')
      const pending = [...deliveries.entries()]
        .filter(([, record]) => record.state === 'pending')
        .sort(([, left], [, right]) => left.receivedAt - right.receivedAt)
      for (const [key] of pending) this.enqueueProcess(key)
      this.enqueuePrune()
      return cleanup
    })
  }

  async [Service.init](): Promise<void> {
    await this.initialized
  }

  /**
   * Persist one verified delivery and start its dispatch.
   * @param delivery - authenticated provider data; validated and snapshotted synchronously.
   * @returns `'queued'` once the durable record landed and dispatch was started; `'duplicate'`
   * when an equivalent record is pending or retained as `delivered`.
   * @throws synchronously when the outbox is closing or the delivery is malformed.
   */
  deliver<K extends string>(delivery: VerifiedWebhookDelivery<K>): Promise<'queued' | 'duplicate'> {
    if (this.closing) throw new Error('webhook outbox is closing')
    const snapshot = snapshotDelivery(delivery)
    return this.serializeIngest(async () => {
      await this.initialized
      const deliveries = (await this.ready).table('deliveries')
      const key = outboxKey(snapshot)
      const existing = deliveries.get(key)
      if (existing !== undefined
        && (existing.state === 'pending'
          || (existing.state === 'delivered' && existing.updatedAt >= Date.now() - this.config.retentionMs))) {
        return 'duplicate'
      }
      await deliveries.put(key, pendingRecord(snapshot))
      this.enqueueProcess(key)
      return 'queued'
    })
  }

  /** One serialized step: dispatch, settle the record, and arm any retry. */
  private async process(key: WebhookOutboxKey): Promise<void> {
    try {
      const deliveries = (await this.ready).table('deliveries')
      const record = deliveries.get(key)
      /* v8 ignore next -- the serialized chain only enqueues records observed as pending. */
      if (record === undefined || record.state !== 'pending') return
      let failure = 'dispatch was not acknowledged'
      let acknowledged = false
      try {
        acknowledged = await this.ctx.webhookRuntime.dispatchAcknowledged(recordDelivery(record))
      } catch (error: unknown) {
        failure = errorChain(error)
      }
      const now = Date.now()
      if (acknowledged) {
        await deliveries.put(key, {
          kind: record.kind,
          source: record.source,
          deliveryId: record.deliveryId,
          event: record.event,
          receivedAt: record.receivedAt,
          state: 'delivered',
          attempts: record.attempts,
          updatedAt: now,
        })
        if (!this.closing) this.enqueuePrune()
        return
      }
      const attempts = record.attempts + 1
      if (attempts >= this.config.maxAttempts) {
        await deliveries.put(key, { ...record, state: 'failed', attempts, lastError: failure, updatedAt: now })
        const text = `delivery ${key} failed permanently after ${attempts} attempts`
        this.ctx.logger.warn(`webhook outbox: ${text}: ${failure}`)
        if (!this.closing) this.enqueuePrune()
        return
      }
      await deliveries.put(key, { ...record, attempts, lastError: failure, updatedAt: now })
      if (!this.closing) this.scheduleRetry(key)
    } catch (error: unknown) {
      // A background persistence failure must keep the chain healthy: the stored
      // record stands, and the next boot replay or retry re-attempts it.
      this.ctx.logger.warn(`webhook outbox: processing a delivery failed: ${errorChain(error)}`)
    }
  }

  /** Delete terminal records past the retained window; pending records are never pruned. */
  private async prune(): Promise<void> {
    const cutoff = Date.now() - this.config.retentionMs
    const deliveries = (await this.ready).table('deliveries')
    for (const [key, record] of deliveries.entries()) {
      if (record.state !== 'pending' && record.updatedAt < cutoff) {
        await deliveries.delete(key)
      }
    }
  }

  /** Queue one prune pass behind the ingest chain; a failure is logged, not propagated. */
  private enqueuePrune(): void {
    void this.serializeIngest(async () => { await this.prune() }).catch((error: unknown) => {
      this.ctx.logger.warn(`webhook outbox: pruning failed: ${errorChain(error)}`)
    })
  }

  /** Serialize one ingest step behind the durable read-modify-write chain. */
  private serializeIngest<T>(work: () => Promise<T>): Promise<T> {
    const result = this.ingestChain.then(work)
    this.ingestChain = result.then(noop, noop)
    return result
  }

  /** Append one processing step to the serialized dispatch chain. */
  private enqueueProcess(key: WebhookOutboxKey): void {
    const result = this.processChain.then(async () => { await this.process(key) })
    this.processChain = result.then(noop, noop)
  }

  /** Arm the one retry timer for a delivery whose dispatch may still succeed. */
  private scheduleRetry(key: WebhookOutboxKey): void {
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer)
      this.enqueueProcess(key)
    }, this.config.retryBackoffMs)
    timer.unref()
    this.retryTimers.add(timer)
  }

  /** Cancel every armed retry before the domain closes. */
  private clearRetryTimers(): void {
    for (const timer of this.retryTimers) clearTimeout(timer)
    this.retryTimers.clear()
  }
}

export default WebhookOutbox
