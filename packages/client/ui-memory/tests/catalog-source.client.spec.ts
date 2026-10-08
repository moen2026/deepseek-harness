import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemoryPage, MemoryRecord } from '@deepseek-ai/dsh-memory/client'
import { describe, expect, it } from 'vitest'
import {
  createMemoryCatalog, type MemoryCatalogDependencies, type MemoryCatalogSnapshot,
} from '../src/client/catalog-source.ts'

function record(id: string): MemoryRecord {
  return { id, text: `memory ${id}`, tags: [], createdAt: '2026-01-01T00:00:00Z' }
}

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

/**
 * One Remote operation answered by scripted `answer` calls: every `call`
 * registers a fresh pending promise, so a deletion's follow-up read is
 * independent of the read that preceded it.
 */
function scripted<T>(): { call: () => Promise<T>; answer: (value: T) => void } {
  const resolvers: Array<(value: T) => void> = []
  return {
    call: () => new Promise<T>((resolve) => { resolvers.push(resolve) }),
    answer: (value) => {
      const resolve = resolvers.shift()
      if (resolve === undefined) throw new Error('scripted: answer without a pending call')
      resolve(value)
    },
  }
}

interface Harness {
  deps: MemoryCatalogDependencies & {
    probe: { ok: (available: boolean) => void }
    page: { ok: (records: MemoryRecord[]) => void; fail: () => void }
    removal: { ok: (removed: boolean) => void }
    reset: () => void
  }
  snapshot: () => MemoryCatalogSnapshot
  subscribe: () => () => void
  onDelete: (id: string) => Promise<'deleted' | 'failed' | 'pending'>
  onRetry: () => Promise<void>
}

function harness(): Harness {
  const probe = scripted<RemoteResult<{ available: boolean }>>()
  const page = scripted<RemoteResult<MemoryPage>>()
  const removal = scripted<RemoteResult<boolean>>()
  const resetListeners: Array<() => void> = []
  const deps: MemoryCatalogDependencies = {
    status: () => probe.call(),
    list: () => page.call(),
    forget: () => removal.call(),
    subscribeReset: (listener) => {
      resetListeners.push(listener)
      return () => { resetListeners.splice(resetListeners.indexOf(listener), 1) }
    },
  }
  const catalog = createMemoryCatalog(deps)
  return {
    deps: {
      ...deps,
      probe: { ok: (available) => { probe.answer({ ok: true, value: { available } }) } },
      page: {
        ok: (records) => { page.answer({ ok: true, value: { records } }) },
        fail: () => { page.answer({ ok: false, error: new RemoteError('gateway/internal', 'boom', {}) }) },
      },
      removal: { ok: (removed) => { removal.answer({ ok: true, value: removed }) } },
      reset: () => { for (const listener of resetListeners) listener() },
    },
    snapshot: () => catalog.hooks.catalog.getSnapshot(),
    subscribe: () => catalog.hooks.catalog.subscribe(() => undefined),
    onDelete: catalog.onDelete,
    onRetry: catalog.onRetry,
  }
}

/** Probe, read, and settle the source to a ready corpus. */
async function settleCorpus(h: Harness, records: MemoryRecord[]): Promise<void> {
  h.deps.probe.ok(true)
  await flush()
  h.deps.page.ok(records)
  await flush()
}

describe('createMemoryCatalog', () => {
  it('holds a subscribed source with an unavailable seam until the first read settles', async () => {
    const h = harness()
    h.subscribe()
    expect(h.snapshot()).toMatchObject({ status: 'loading', available: true, settled: false, records: [] })
    h.deps.probe.ok(false)
    await flush()
    expect(h.snapshot()).toMatchObject({ status: 'ready', available: false, settled: true, records: [] })
  })

  it('answers a held seam with the list read', async () => {
    const h = harness()
    h.subscribe()
    await settleCorpus(h, [record('a'), record('b')])
    expect(h.snapshot()).toMatchObject({ status: 'ready', available: true, settled: true })
    expect(h.snapshot().records.map(entry => entry.id)).toEqual(['a', 'b'])
  })

  it('reports a failed read as error and keeps the previous records', async () => {
    const h = harness()
    h.subscribe()
    await settleCorpus(h, [record('a')])
    const settled = h.onRetry()
    h.deps.probe.ok(true)
    await flush()
    h.deps.page.fail()
    await settled
    expect(h.snapshot()).toMatchObject({ status: 'error', settled: true })
    expect(h.snapshot().records.map(entry => entry.id)).toEqual(['a'])
  })

  it('acknowledges a deletion with a fresh read and resolves deleted', async () => {
    const h = harness()
    h.subscribe()
    await settleCorpus(h, [record('a'), record('b')])
    const outcome = h.onDelete('a')
    expect(h.snapshot().deleting).toEqual(['a'])
    h.deps.removal.ok(true)
    await flush()
    h.deps.probe.ok(true)
    await flush()
    h.deps.page.ok([record('b')])
    expect(await outcome).toBe('deleted')
    expect(h.snapshot().deleting).toEqual([])
    expect(h.snapshot().records.map(entry => entry.id)).toEqual(['b'])
  })

  it('resolves a second delete of the same id as pending', async () => {
    const h = harness()
    h.subscribe()
    await settleCorpus(h, [record('a')])
    const first = h.onDelete('a')
    expect(await h.onDelete('a')).toBe('pending')
    h.deps.removal.ok(true)
    await flush()
    h.deps.probe.ok(true)
    await flush()
    h.deps.page.ok([])
    expect(await first).toBe('deleted')
  })

  it('resolves a confirmed no-op deletion as failed and drops the pending mark', async () => {
    const h = harness()
    h.subscribe()
    await settleCorpus(h, [record('a')])
    const outcome = h.onDelete('a')
    h.deps.removal.ok(false)
    await flush()
    expect(await outcome).toBe('failed')
    expect(h.snapshot().deleting).toEqual([])
  })

  it('refreshes through the connection reset subscription', async () => {
    const h = harness()
    h.subscribe()
    await settleCorpus(h, [record('a')])
    h.deps.reset()
    h.deps.probe.ok(true)
    await flush()
    h.deps.page.ok([record('b')])
    await flush()
    expect(h.snapshot().records.map(entry => entry.id)).toEqual(['b'])
  })

  it('drops the pending marks when the last framework listener leaves', () => {
    const h = harness()
    const unsubscribe = h.subscribe()
    unsubscribe()
    expect(h.snapshot().deleting).toEqual([])
  })

  it('discards a read that an unsubscribe superseded', async () => {
    const h = harness()
    const unsubscribe = h.subscribe()
    unsubscribe()
    h.deps.probe.ok(true)
    await flush()
    // The stale read was intercepted at the probe and never issued a list call.
    expect(h.snapshot().records).toEqual([])
  })
})
