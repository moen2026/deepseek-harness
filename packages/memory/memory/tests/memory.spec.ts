import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Memory, {
  MemoryError,
  type MemoryDraft,
  type MemoryListRequest,
  type MemoryPage,
  type MemoryProvider,
  type MemoryRecord,
  type MemoryRecallRequest,
  type MemoryRecallResult,
} from '@deepseek-ai/dsh-memory'

/** A scripted provider that records every operation it receives and returns fixed values. */
function makeProvider(id: string, overrides: Partial<MemoryProvider> = {}): MemoryProvider & {
  seenDrafts: MemoryDraft[]
  seenRecalls: MemoryRecallRequest[]
  seenForgets: string[]
  seenLists: (MemoryListRequest | undefined)[]
  seenSignals: (AbortSignal | undefined)[]
} {
  const seenDrafts: MemoryDraft[] = []
  const seenRecalls: MemoryRecallRequest[] = []
  const seenForgets: string[] = []
  const seenLists: (MemoryListRequest | undefined)[] = []
  const seenSignals: (AbortSignal | undefined)[] = []
  const record: MemoryRecord = { id: 'm1', text: 'likes tests', tags: ['pref'], createdAt: '2026-01-01T00:00:00.000Z' }
  return {
    id,
    seenDrafts,
    seenRecalls,
    seenForgets,
    seenLists,
    seenSignals,
    remember(draft, signal) {
      seenDrafts.push(draft)
      seenSignals.push(signal)
      return Promise.resolve('m1')
    },
    recall(request, signal) {
      seenRecalls.push(request)
      seenSignals.push(signal)
      const result: MemoryRecallResult = { hits: [{ record, score: 3 }] }
      return Promise.resolve(result)
    },
    forget(target, signal) {
      seenForgets.push(target)
      seenSignals.push(signal)
      return Promise.resolve(true)
    },
    list(request, signal) {
      seenLists.push(request)
      seenSignals.push(signal)
      const page: MemoryPage = { records: [record] }
      return Promise.resolve(page)
    },
    ...overrides,
  }
}

/** Mount the memory seam on a fresh root context. */
async function mountMemory(): Promise<{ ctx: Context; memory: Memory }> {
  const ctx = new Context()
  await ctx.plugin(Memory)
  return { ctx, memory: ctx.memory as Memory }
}

describe('Memory registration', () => {
  const m1Record: unknown = expect.objectContaining({ id: 'm1' })

  it('fails MEMORY_UNAVAILABLE on every route when no provider is registered', async () => {
    const { memory } = await mountMemory()
    const unavailable: unknown = expect.objectContaining({ code: 'MEMORY_UNAVAILABLE' })
    await expect(memory.remember({ text: 'x' })).rejects.toThrow(unavailable)
    await expect(memory.recall({ query: 'x' })).rejects.toThrow(unavailable)
    await expect(memory.forget('m1')).rejects.toThrow(unavailable)
    await expect(memory.list()).rejects.toThrow(unavailable)
  })

  it('routes all four operations to the reserved provider and releases on dispose', async () => {
    const { memory } = await mountMemory()
    const provider = makeProvider('p')
    const dispose = memory.registerProvider(provider)

    await expect(memory.remember({ text: 'likes tests', tags: ['pref'] })).resolves.toBe('m1')
    await expect(memory.recall({ query: 'tests' })).resolves.toEqual({ hits: [{ record: m1Record, score: 3 }] })
    await expect(memory.forget('m1')).resolves.toBe(true)
    await expect(memory.list({ limit: 5 })).resolves.toEqual({ records: [expect.objectContaining({ id: 'm1' })] })
    expect(provider.seenDrafts[0]).toEqual({ text: 'likes tests', tags: ['pref'] })
    expect(provider.seenForgets[0]).toBe('m1')
    expect(provider.seenLists[0]).toEqual({ limit: 5 })

    dispose()
    await expect(memory.recall({ query: 'tests' })).rejects.toThrow(expect.objectContaining({ code: 'MEMORY_UNAVAILABLE' }))
  })

  it('forwards the abort signal verbatim to the provider', async () => {
    const { memory } = await mountMemory()
    const provider = makeProvider('p')
    memory.registerProvider(provider)
    const controller = new AbortController()
    await memory.recall({ query: 'x' }, controller.signal)
    expect(provider.seenSignals[0]).toBe(controller.signal)
  })

  it('rejects an empty provider id (MEMORY_INVALID_PROVIDER) and reserves nothing', async () => {
    const { memory } = await mountMemory()
    expect(() => memory.registerProvider(makeProvider('  ')))
      .toThrow(expect.objectContaining({ code: 'MEMORY_INVALID_PROVIDER' }))
    await expect(memory.recall({ query: 'x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_UNAVAILABLE' }))
  })

  it('rejects a second provider while the seam is held (MEMORY_CONFLICT)', async () => {
    const { memory } = await mountMemory()
    memory.registerProvider(makeProvider('first'))
    expect(() => memory.registerProvider(makeProvider('second')))
      .toThrow(expect.objectContaining({ code: 'MEMORY_CONFLICT' }))
  })

  it('allows re-registration after dispose releases the reservation', async () => {
    const { memory } = await mountMemory()
    const dispose = memory.registerProvider(makeProvider('first'))
    dispose()
    expect(() => memory.registerProvider(makeProvider('second'))).not.toThrow()
  })

  it('disposes the reservation when the contributing fiber is disposed', async () => {
    const { ctx, memory } = await mountMemory()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.memory.registerProvider(makeProvider('p'))
    }, { inject: ['memory'] }))
    await expect(memory.recall({ query: 'x' })).resolves.toEqual({ hits: [{ record: m1Record, score: 3 }] })
    await fiber.dispose()
    await expect(memory.recall({ query: 'x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEMORY_UNAVAILABLE' }))
  })

  it('MemoryError carries its structured code', () => {
    expect(new MemoryError('m', 'MEMORY_INVALID_REQUEST').code).toBe('MEMORY_INVALID_REQUEST')
  })
})
