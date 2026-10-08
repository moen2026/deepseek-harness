import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CodeIndex, {
  CodeIndexError,
  type CodeIndexProvider,
  type CodeSearchHit,
  type CodeSearchPage,
  type CodeSearchRequest,
} from '@deepseek-ai/dsh-code-index'

/** A scripted provider that records the searches it receives. */
function makeProvider(
  id: string,
  page: CodeSearchPage = { hits: [] },
): CodeIndexProvider & { seen: CodeSearchRequest[]; seenSignals: (AbortSignal | undefined)[] } {
  const seen: CodeSearchRequest[] = []
  const seenSignals: (AbortSignal | undefined)[] = []
  return {
    id,
    seen,
    seenSignals,
    search(request, signal) {
      seen.push(request)
      seenSignals.push(signal)
      return Promise.resolve(page)
    },
  }
}

/** Mount the code-index seam on a fresh root context. */
async function mountCodeIndex(): Promise<{ ctx: Context; codeIndex: CodeIndex }> {
  const ctx = new Context()
  await ctx.plugin(CodeIndex)
  return { ctx, codeIndex: ctx.codeIndex as CodeIndex }
}

const hit: CodeSearchHit = { path: 'a/b.ts', startLine: 3, endLine: 7, language: 'typescript', score: 2.5, snippet: 'needle here' }

describe('CodeIndex registration', () => {
  it('fails CODE_INDEX_UNAVAILABLE when no provider is registered', async () => {
    const { codeIndex } = await mountCodeIndex()
    await expect(codeIndex.search({ query: 'x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'CODE_INDEX_UNAVAILABLE' }))
  })

  it('routes a search to the reserved provider and releases on dispose', async () => {
    const { codeIndex } = await mountCodeIndex()
    const provider = makeProvider('p', { hits: [hit] })
    const dispose = codeIndex.registerProvider(provider)

    await expect(codeIndex.search({ query: 'needle' })).resolves.toEqual({ hits: [hit] })
    expect(provider.seen[0]).toEqual({ query: 'needle' })

    dispose()
    await expect(codeIndex.search({ query: 'needle' }))
      .rejects.toThrow(expect.objectContaining({ code: 'CODE_INDEX_UNAVAILABLE' }))
  })

  it('forwards the abort signal verbatim to the provider', async () => {
    const { codeIndex } = await mountCodeIndex()
    const provider = makeProvider('p')
    codeIndex.registerProvider(provider)
    const controller = new AbortController()
    await codeIndex.search({ query: 'x' }, controller.signal)
    expect(provider.seenSignals[0]).toBe(controller.signal)
  })

  it('rejects an empty provider id (CODE_INDEX_INVALID_PROVIDER) and reserves nothing', async () => {
    const { codeIndex } = await mountCodeIndex()
    expect(() => codeIndex.registerProvider(makeProvider('  ')))
      .toThrow(expect.objectContaining({ code: 'CODE_INDEX_INVALID_PROVIDER' }))
    await expect(codeIndex.search({ query: 'x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'CODE_INDEX_UNAVAILABLE' }))
  })

  it('rejects a second provider while the seam is held (CODE_INDEX_CONFLICT)', async () => {
    const { codeIndex } = await mountCodeIndex()
    codeIndex.registerProvider(makeProvider('first'))
    expect(() => codeIndex.registerProvider(makeProvider('second')))
      .toThrow(expect.objectContaining({ code: 'CODE_INDEX_CONFLICT' }))
  })

  it('allows re-registration after dispose releases the reservation', async () => {
    const { codeIndex } = await mountCodeIndex()
    const dispose = codeIndex.registerProvider(makeProvider('first'))
    dispose()
    expect(() => codeIndex.registerProvider(makeProvider('second'))).not.toThrow()
  })

  it('disposes the reservation when the contributing fiber is disposed', async () => {
    const { ctx, codeIndex } = await mountCodeIndex()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.codeIndex.registerProvider(makeProvider('p', { hits: [hit] }))
    }, { inject: ['codeIndex'] }))
    await expect(codeIndex.search({ query: 'needle' })).resolves.toEqual({ hits: [hit] })
    await fiber.dispose()
    await expect(codeIndex.search({ query: 'needle' }))
      .rejects.toThrow(expect.objectContaining({ code: 'CODE_INDEX_UNAVAILABLE' }))
  })

  it('CodeIndexError carries its structured code', () => {
    expect(new CodeIndexError('m', 'CODE_INDEX_INVALID_REQUEST').code).toBe('CODE_INDEX_INVALID_REQUEST')
  })
})
