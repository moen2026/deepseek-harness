import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Knowledge, {
  KnowledgeError,
  type KnowledgeDraft,
  type KnowledgeListRequest,
  type KnowledgePage,
  type KnowledgeProvider,
  type KnowledgeRecord,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'

/** A scripted provider that records every operation it receives and returns fixed values. */
function makeProvider(id: string, overrides: Partial<KnowledgeProvider> = {}): KnowledgeProvider & {
  seenDrafts: KnowledgeDraft[]
  seenSearches: KnowledgeSearchRequest[]
  seenRemoves: string[]
  seenLists: (KnowledgeListRequest | undefined)[]
  seenSignals: (AbortSignal | undefined)[]
} {
  const seenDrafts: KnowledgeDraft[] = []
  const seenSearches: KnowledgeSearchRequest[] = []
  const seenRemoves: string[] = []
  const seenLists: (KnowledgeListRequest | undefined)[] = []
  const seenSignals: (AbortSignal | undefined)[] = []
  const record: KnowledgeRecord = {
    id: 'k1',
    title: 'Spec',
    text: 'likes tests',
    tags: ['pref'],
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  return {
    id,
    seenDrafts,
    seenSearches,
    seenRemoves,
    seenLists,
    seenSignals,
    ingest(draft, signal) {
      seenDrafts.push(draft)
      seenSignals.push(signal)
      return Promise.resolve('k1')
    },
    search(request, signal) {
      seenSearches.push(request)
      seenSignals.push(signal)
      const result: KnowledgeSearchResult = { hits: [{ record, score: 3, snippet: 'likes tests' }] }
      return Promise.resolve(result)
    },
    remove(target, signal) {
      seenRemoves.push(target)
      seenSignals.push(signal)
      return Promise.resolve(true)
    },
    list(request, signal) {
      seenLists.push(request)
      seenSignals.push(signal)
      const page: KnowledgePage = { records: [record] }
      return Promise.resolve(page)
    },
    ...overrides,
  }
}

/** Mount the knowledge seam on a fresh root context. */
async function mountKnowledge(): Promise<{ ctx: Context; knowledge: Knowledge }> {
  const ctx = new Context()
  await ctx.plugin(Knowledge)
  return { ctx, knowledge: ctx.knowledge as Knowledge }
}

describe('Knowledge registration', () => {
  const k1Record: unknown = expect.objectContaining({ id: 'k1' })

  it('fails KNOWLEDGE_UNAVAILABLE on every route when no provider is registered', async () => {
    const { knowledge } = await mountKnowledge()
    const unavailable: unknown = expect.objectContaining({ code: 'KNOWLEDGE_UNAVAILABLE' })
    await expect(knowledge.ingest({ title: 't', text: 'x' })).rejects.toThrow(unavailable)
    await expect(knowledge.search({ query: 'x' })).rejects.toThrow(unavailable)
    await expect(knowledge.remove('k1')).rejects.toThrow(unavailable)
    await expect(knowledge.list()).rejects.toThrow(unavailable)
  })

  it('routes all four operations to the reserved provider and releases on dispose', async () => {
    const { knowledge } = await mountKnowledge()
    const provider = makeProvider('p')
    const dispose = knowledge.registerProvider(provider)

    await expect(knowledge.ingest({ title: 'Doc', text: 'likes tests', tags: ['pref'] })).resolves.toBe('k1')
    await expect(knowledge.search({ query: 'tests' })).resolves.toEqual({
      hits: [{ record: k1Record, score: 3, snippet: 'likes tests' }],
    })
    await expect(knowledge.remove('k1')).resolves.toBe(true)
    await expect(knowledge.list({ limit: 5 })).resolves.toEqual({ records: [expect.objectContaining({ id: 'k1' })] })
    expect(provider.seenDrafts[0]).toEqual({ title: 'Doc', text: 'likes tests', tags: ['pref'] })
    expect(provider.seenRemoves[0]).toBe('k1')
    expect(provider.seenLists[0]).toEqual({ limit: 5 })

    dispose()
    await expect(knowledge.search({ query: 'tests' })).rejects.toThrow(expect.objectContaining({ code: 'KNOWLEDGE_UNAVAILABLE' }))
  })

  it('forwards the abort signal verbatim to the provider', async () => {
    const { knowledge } = await mountKnowledge()
    const provider = makeProvider('p')
    knowledge.registerProvider(provider)
    const controller = new AbortController()
    await knowledge.search({ query: 'x' }, controller.signal)
    expect(provider.seenSignals[0]).toBe(controller.signal)
  })

  it('rejects an empty provider id (KNOWLEDGE_INVALID_PROVIDER) and reserves nothing', async () => {
    const { knowledge } = await mountKnowledge()
    expect(() => knowledge.registerProvider(makeProvider('  ')))
      .toThrow(expect.objectContaining({ code: 'KNOWLEDGE_INVALID_PROVIDER' }))
    await expect(knowledge.search({ query: 'x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'KNOWLEDGE_UNAVAILABLE' }))
  })

  it('rejects a second provider while the seam is held (KNOWLEDGE_CONFLICT)', async () => {
    const { knowledge } = await mountKnowledge()
    knowledge.registerProvider(makeProvider('first'))
    expect(() => knowledge.registerProvider(makeProvider('second')))
      .toThrow(expect.objectContaining({ code: 'KNOWLEDGE_CONFLICT' }))
  })

  it('allows re-registration after dispose releases the reservation', async () => {
    const { knowledge } = await mountKnowledge()
    const dispose = knowledge.registerProvider(makeProvider('first'))
    dispose()
    expect(() => knowledge.registerProvider(makeProvider('second'))).not.toThrow()
  })

  it('disposes the reservation when the contributing fiber is disposed', async () => {
    const { ctx, knowledge } = await mountKnowledge()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.knowledge.registerProvider(makeProvider('p'))
    }, { inject: ['knowledge'] }))
    await expect(knowledge.search({ query: 'x' })).resolves.toEqual({
      hits: [{ record: k1Record, score: 3, snippet: 'likes tests' }],
    })
    await fiber.dispose()
    await expect(knowledge.search({ query: 'x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'KNOWLEDGE_UNAVAILABLE' }))
  })

  it('KnowledgeError carries its structured code', () => {
    expect(new KnowledgeError('m', 'KNOWLEDGE_INVALID_REQUEST').code).toBe('KNOWLEDGE_INVALID_REQUEST')
  })
})
