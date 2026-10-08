/** The durable outbox persists before dispatch, deduplicates, retries, and replays pending records across restarts. */
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WebhookDeliveryId, WebhookSourceId } from '@deepseek-ai/dsh-webhook'
import type { VerifiedWebhookDelivery } from '@deepseek-ai/dsh-webhook'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WebhookOutbox, { type Config } from '../src/index.ts'

const testConfig: Config = { maxAttempts: 3, retryBackoffMs: 1000, retentionMs: 86_400_000 }

const contexts: Context[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-28T00:00:00Z'))
})

afterEach(async () => {
  const errors: unknown[] = []
  for (const ctx of contexts.splice(0)) {
    try { await ctx.fiber.dispose() } catch (error) { errors.push(error) }
  }
  vi.useRealTimers()
  if (errors.length > 0) throw new AggregateError(errors, 'outbox test cleanup failed')
})

/** One valid delivery; `receivedAt` orders boot replay. */
function deliveryOf(id = 'delivery-1', receivedAt = 1): VerifiedWebhookDelivery<'fixture'> {
  return {
    kind: 'fixture',
    source: WebhookSourceId('fixture-source'),
    deliveryId: WebhookDeliveryId(id),
    event: { value: 1 },
    receivedAt,
  }
}

/** Fake webhook runtime answering every dispatch through one decision function. */
interface FakeRuntime {
  dispatchAcknowledged: Mock<(delivery: VerifiedWebhookDelivery) => Promise<boolean>>
}

function fakeRuntime(
  decide: (delivery: VerifiedWebhookDelivery) => Promise<boolean> | boolean = () => true,
): FakeRuntime {
  return { dispatchAcknowledged: vi.fn(async (delivery: VerifiedWebhookDelivery) => await decide(delivery)) }
}

/** Isolated outbox services over a fixture storage backend and a fake webhook runtime. */
async function harness(options: {
  pool?: MemoryMediaPool
  config?: Config
  runtime?: FakeRuntime
  beforeService?: (ctx: Context, facility: DomainFacility) => Promise<void>
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  const pool = options.pool ?? new MemoryMediaPool()
  const backend = new MemoryStorageBackend(pool)
  ctx.effect(() => ctx.storage.backend.register('fixture', backend))
  ctx.effect(() => async () => { await backend.close() })
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.effect(() => {
    const unmount = ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    return async () => { await facility.closeAll(); unmount() }
  })
  const runtime = options.runtime ?? fakeRuntime()
  ctx.provide('webhookRuntime', runtime as never)
  await options.beforeService?.(ctx, facility)
  const fiber = await ctx.plugin(WebhookOutbox, options.config ?? testConfig)
  return { ctx, service: ctx.webhookOutbox, pool, runtime, fiber, facility }
}

/** Stored delivery values, for assertions against the durable ledger. */
function recordsOf(facility: DomainFacility): unknown[] {
  const domain = facility.get('webhook_outbox')
  if (domain === undefined) throw new Error('webhook_outbox domain is not open')
  return [...domain.table('deliveries').entries()].map(([, record]) => record)
}

/** Flush the queued ingest and dispatch chains. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('WebhookOutbox', () => {
  it('persists before dispatch, then deduplicates pending and delivered records', async () => {
    const gate = Promise.withResolvers<boolean>()
    const pool = new MemoryMediaPool()
    let storedAtDispatch = -1
    const runtime = fakeRuntime(async () => {
      storedAtDispatch = pool.media.get('webhook_outbox')?.tables.get('deliveries')?.size ?? -1
      return await gate.promise
    })
    const test = await harness({ pool, runtime })
    expect(await test.service.deliver(deliveryOf())).toBe('queued')
    // Durable before any dispatch: the record the dispatch observes is already on the medium.
    expect(pool.media.get('webhook_outbox')?.tables.get('deliveries')?.size).toBe(1)
    expect(storedAtDispatch).toBe(1)
    expect(await test.service.deliver(deliveryOf())).toBe('duplicate')
    await settle()
    expect(runtime.dispatchAcknowledged).toHaveBeenCalledTimes(1)
    gate.resolve(true)
    await settle()
    expect(await test.service.deliver(deliveryOf())).toBe('duplicate')
    expect(runtime.dispatchAcknowledged).toHaveBeenCalledTimes(1)
  })

  it('processes deliveries serially in admission order', async () => {
    const first = Promise.withResolvers<boolean>()
    const second = Promise.withResolvers<boolean>()
    const pending = [first.promise, second.promise]
    const runtime = fakeRuntime(() => pending.shift() ?? true)
    const test = await harness({ runtime })
    await test.service.deliver(deliveryOf('first'))
    await test.service.deliver(deliveryOf('second'))
    await settle()
    expect(runtime.dispatchAcknowledged.mock.calls.map(call => call[0].deliveryId)).toEqual(['first'])
    first.resolve(true)
    await settle()
    expect(runtime.dispatchAcknowledged.mock.calls.map(call => call[0].deliveryId)).toEqual(['first', 'second'])
    second.resolve(true)
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([
      { deliveryId: 'first', state: 'delivered' },
      { deliveryId: 'second', state: 'delivered' },
    ])
  })

  it('retries an unacknowledged delivery after the configured backoff', async () => {
    let attempts = 0
    const runtime = fakeRuntime(() => attempts++ > 0)
    const test = await harness({ runtime })
    await test.service.deliver(deliveryOf())
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([
      { state: 'pending', attempts: 1, lastError: 'dispatch was not acknowledged' },
    ])
    expect(runtime.dispatchAcknowledged).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(testConfig.retryBackoffMs)
    await settle()
    expect(runtime.dispatchAcknowledged).toHaveBeenCalledTimes(2)
    const records = recordsOf(test.facility)
    expect(records).toMatchObject([{ state: 'delivered', attempts: 1 }])
    expect(records[0]).not.toHaveProperty('lastError')
  })

  it('marks a delivery failed after maxAttempts and re-queues a redelivery', async () => {
    const runtime = fakeRuntime(() => false)
    const test = await harness({ runtime, config: { ...testConfig, maxAttempts: 2 } })
    const warn = vi.spyOn(test.ctx.logger, 'warn')
    await test.service.deliver(deliveryOf())
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([{ state: 'pending', attempts: 1 }])
    await vi.advanceTimersByTimeAsync(testConfig.retryBackoffMs)
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([{ state: 'failed', attempts: 2 }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed permanently after 2 attempts'))
    expect(vi.getTimerCount()).toBe(0)
    runtime.dispatchAcknowledged.mockResolvedValueOnce(true)
    expect(await test.service.deliver(deliveryOf())).toBe('queued')
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([{ state: 'delivered', attempts: 0 }])
  })

  it('replays pending records at boot in receipt order and leaves terminal records alone', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness({
      pool,
      runtime: fakeRuntime(delivery => delivery.deliveryId !== 'later' && delivery.deliveryId !== 'earlier'),
    })
    await first.service.deliver(deliveryOf('done', 50))
    await first.service.deliver(deliveryOf('later', 200))
    await first.service.deliver(deliveryOf('earlier', 100))
    await settle()
    await first.fiber.dispose()
    const seen: string[] = []
    const second = await harness({
      pool,
      runtime: fakeRuntime((delivery) => { seen.push(delivery.deliveryId); return true }),
    })
    await settle()
    expect(seen).toEqual(['earlier', 'later'])
    expect(recordsOf(second.facility)).toMatchObject([
      { deliveryId: 'done', state: 'delivered' },
      { deliveryId: 'later', state: 'delivered', attempts: 1 },
      { deliveryId: 'earlier', state: 'delivered', attempts: 1 },
    ])
  })

  it('rejects malformed deliveries synchronously and refuses delivery after disposal', async () => {
    const test = await harness()
    expect(() => test.service.deliver({ ...deliveryOf(), kind: '' })).toThrow(TypeError)
    expect(() => test.service.deliver({ ...deliveryOf(), source: WebhookSourceId('') })).toThrow(TypeError)
    expect(() => test.service.deliver({ ...deliveryOf(), receivedAt: -1 })).toThrow(TypeError)
    await test.fiber.dispose()
    expect(() => test.service.deliver(deliveryOf())).toThrow(/closing/)
  })

  it('prunes terminal records past the retained window when a later delivery settles', async () => {
    const test = await harness({ config: { ...testConfig, retentionMs: 60_000 } })
    await test.service.deliver(deliveryOf('old'))
    await settle()
    expect(recordsOf(test.facility)).toHaveLength(1)
    vi.setSystemTime(Date.now() + 120_000)
    await test.service.deliver(deliveryOf('new'))
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([{ deliveryId: 'new', state: 'delivered' }])
  })

  it('prunes expired records at boot and re-queues a delivery past its window', async () => {
    const pool = new MemoryMediaPool()
    const windowed: Config = { ...testConfig, retentionMs: 60_000 }
    const first = await harness({ pool, config: windowed })
    await first.service.deliver(deliveryOf())
    await settle()
    await first.fiber.dispose()
    vi.setSystemTime(Date.now() + 120_000)
    const second = await harness({ pool, config: windowed })
    await settle()
    expect(recordsOf(second.facility)).toHaveLength(0)
    expect(await second.service.deliver(deliveryOf())).toBe('queued')
    await settle()
    expect(recordsOf(second.facility)).toMatchObject([{ state: 'delivered', attempts: 0 }])
  })

  it('re-queues an expired delivered delivery before any prune runs', async () => {
    const test = await harness({ config: { ...testConfig, retentionMs: 60_000 } })
    await test.service.deliver(deliveryOf())
    await settle()
    vi.setSystemTime(Date.now() + 120_000)
    expect(await test.service.deliver(deliveryOf())).toBe('queued')
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([{ state: 'delivered', attempts: 0 }])
  })

  it('never prunes pending records', async () => {
    const runtime = fakeRuntime(delivery => delivery.deliveryId !== 'stuck')
    const test = await harness({ runtime, config: { ...testConfig, retentionMs: 1 } })
    await test.service.deliver(deliveryOf('stuck'))
    await settle()
    vi.setSystemTime(Date.now() + 120_000)
    await test.service.deliver(deliveryOf('fresh'))
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([
      { deliveryId: 'stuck', state: 'pending' },
      { deliveryId: 'fresh', state: 'delivered' },
    ])
  })

  it('records a dispatch failure when the runtime throws', async () => {
    const runtime = fakeRuntime(async () => { throw new Error('runtime is closing') })
    const test = await harness({ runtime, config: { ...testConfig, maxAttempts: 1 } })
    await test.service.deliver(deliveryOf())
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([
      { state: 'failed', attempts: 1, lastError: 'runtime is closing' },
    ])
  })

  it('drains an in-flight dispatch before the domain closes', async () => {
    const gate = Promise.withResolvers<boolean>()
    const pool = new MemoryMediaPool()
    const test = await harness({ pool, runtime: fakeRuntime(async () => await gate.promise) })
    await test.service.deliver(deliveryOf())
    await settle()
    expect(test.runtime.dispatchAcknowledged).toHaveBeenCalledTimes(1)
    const disposed = test.fiber.dispose()
    gate.resolve(true)
    await disposed
    const reopened = await harness({ pool })
    await settle()
    expect(recordsOf(reopened.facility)).toMatchObject([{ state: 'delivered' }])
  })

  it('does not arm a retry while unloading', async () => {
    const gate = Promise.withResolvers<boolean>()
    const pool = new MemoryMediaPool()
    const test = await harness({ pool, runtime: fakeRuntime(async () => await gate.promise) })
    await test.service.deliver(deliveryOf())
    await settle()
    const disposed = test.fiber.dispose()
    gate.resolve(false)
    await disposed
    expect(vi.getTimerCount()).toBe(0)
    const stored = [...(pool.media.get('webhook_outbox')?.tables.get('deliveries')?.values() ?? [])]
    expect(stored).toMatchObject([
      { state: 'pending', attempts: 1, lastError: 'dispatch was not acknowledged' },
    ])
  })

  it('marks the final attempt failed during unload without kicking a prune', async () => {
    const gate = Promise.withResolvers<boolean>()
    const pool = new MemoryMediaPool()
    const test = await harness({
      pool,
      runtime: fakeRuntime(async () => await gate.promise),
      config: { ...testConfig, maxAttempts: 1 },
    })
    const warn = vi.spyOn(test.ctx.logger, 'warn')
    await test.service.deliver(deliveryOf())
    await settle()
    const disposed = test.fiber.dispose()
    gate.resolve(false)
    await disposed
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed permanently after 1 attempts'))
    expect(vi.getTimerCount()).toBe(0)
    const stored = [...(pool.media.get('webhook_outbox')?.tables.get('deliveries')?.values() ?? [])]
    expect(stored).toMatchObject([
      { state: 'failed', attempts: 1, lastError: 'dispatch was not acknowledged' },
    ])
  })

  it('propagates a failed first persistence to the caller without dispatching', async () => {
    const pool = new MemoryMediaPool()
    const test = await harness({ pool })
    pool.failNextWrites = 1
    await expect(test.service.deliver(deliveryOf())).rejects.toThrow('injected write failure')
    expect(test.runtime.dispatchAcknowledged).not.toHaveBeenCalled()
    expect(recordsOf(test.facility)).toHaveLength(0)
    expect(await test.service.deliver(deliveryOf())).toBe('queued')
  })

  it('contains a background persistence failure and keeps the chain healthy', async () => {
    const pool = new MemoryMediaPool()
    const test = await harness({ pool })
    const warn = vi.spyOn(test.ctx.logger, 'warn')
    await test.service.deliver(deliveryOf('fails'))
    pool.failNextWrites = 1
    await settle()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('processing a delivery failed'))
    await test.service.deliver(deliveryOf('after'))
    await settle()
    expect(recordsOf(test.facility)).toMatchObject([
      { deliveryId: 'fails', state: 'pending', attempts: 0 },
      { deliveryId: 'after', state: 'delivered' },
    ])
  })

  it('logs a boot-time prune failure without failing the open', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness({ pool })
    await first.service.deliver(deliveryOf())
    await settle()
    await first.fiber.dispose()
    vi.setSystemTime(Date.now() + 120_000)
    pool.failNextWrites = 1
    let warn: MockInstance | undefined
    const second = await harness({
      pool,
      config: { ...testConfig, retentionMs: 60_000 },
      beforeService: async (ctx) => { warn = vi.spyOn(ctx.logger, 'warn') },
    })
    await settle()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pruning failed'))
    expect(recordsOf(second.facility)).toHaveLength(1)
  })

  it('does not process when storage opens after its owner begins unloading', async () => {
    const pool = new MemoryMediaPool()
    const acquired = Promise.withResolvers<{ facility: DomainFacility; unload: () => Promise<void> }>()
    const release = Promise.withResolvers<undefined>()
    const startup = harness({
      pool,
      beforeService: async (ctx, facility) => {
        const install = vi.spyOn(ctx, 'plugin')
        const open = facility.open.bind(facility)
        vi.spyOn(facility, 'open').mockImplementationOnce(async (spec) => {
          const domain = await open(spec)
          acquired.resolve({
            facility,
            unload: async () => {
              const result = install.mock.results[0]
              if (result?.type !== 'return') throw new Error('outbox registration did not return a plugin handle')
              await result.value.dispose()
            },
          })
          await release.promise
          return domain
        })
      },
    })
    let startupFailure = ''
    const settled = startup.then(() => undefined, (error: unknown) => { startupFailure = String(error) })
    try {
      const { facility, unload } = await acquired.promise
      const disposed = unload()
      release.resolve(undefined)
      await disposed
      await settled
      expect(startupFailure).toContain('cannot create effect on inactive context')
      expect(facility.get('webhook_outbox')).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      release.resolve(undefined)
      await settled
    }
  })
})
