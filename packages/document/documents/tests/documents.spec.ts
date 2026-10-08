import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Documents, {
  DocumentsError,
  type DocumentBlock,
  type DocumentCreateRequest,
  type DocumentResult,
  type DocumentsProvider,
} from '@deepseek-ai/dsh-documents'

/** A scripted provider that records every request it receives and returns fixed bytes. */
function makeProvider(id: string, overrides: Partial<DocumentsProvider> = {}): DocumentsProvider & {
  seenRequests: DocumentCreateRequest[]
  seenSignals: (AbortSignal | undefined)[]
} {
  const seenRequests: DocumentCreateRequest[] = []
  const seenSignals: (AbortSignal | undefined)[] = []
  const result: DocumentResult = {
    data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  return {
    id,
    seenRequests,
    seenSignals,
    create(request, signal) {
      seenRequests.push(request)
      seenSignals.push(signal)
      return Promise.resolve(result)
    },
    ...overrides,
  }
}

/** Mount the documents seam on a fresh root context. */
async function mountDocuments(): Promise<{ ctx: Context; documents: Documents }> {
  const ctx = new Context()
  await ctx.plugin(Documents)
  return { ctx, documents: ctx.documents as Documents }
}

const blocks: readonly DocumentBlock[] = [
  { kind: 'heading', text: 'Summary' },
  { kind: 'text', text: 'One paragraph.' },
]

describe('Documents registration', () => {
  it('fails DOCUMENTS_UNAVAILABLE on the route when no provider is registered', async () => {
    const { documents } = await mountDocuments()
    await expect(documents.create({ format: 'docx', title: 'T', blocks }))
      .rejects.toThrow(expect.objectContaining({ code: 'DOCUMENTS_UNAVAILABLE' }))
  })

  it('routes create to the reserved provider and releases on dispose', async () => {
    const { documents } = await mountDocuments()
    const provider = makeProvider('p')
    const dispose = documents.registerProvider(provider)

    const request: DocumentCreateRequest = { format: 'xlsx', title: 'Plan', blocks }
    await expect(documents.create(request)).resolves.toEqual({
      data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(provider.seenRequests[0]).toBe(request)

    dispose()
    await expect(documents.create({ format: 'docx', title: 'T', blocks }))
      .rejects.toThrow(expect.objectContaining({ code: 'DOCUMENTS_UNAVAILABLE' }))
  })

  it('forwards the abort signal verbatim to the provider', async () => {
    const { documents } = await mountDocuments()
    const provider = makeProvider('p')
    documents.registerProvider(provider)
    const controller = new AbortController()
    await documents.create({ format: 'pptx', title: 'T', blocks }, controller.signal)
    expect(provider.seenSignals[0]).toBe(controller.signal)
  })

  it('rejects an empty provider id (DOCUMENTS_INVALID_PROVIDER) and reserves nothing', async () => {
    const { documents } = await mountDocuments()
    expect(() => documents.registerProvider(makeProvider('  ')))
      .toThrow(expect.objectContaining({ code: 'DOCUMENTS_INVALID_PROVIDER' }))
    await expect(documents.create({ format: 'docx', title: 'T', blocks }))
      .rejects.toThrow(expect.objectContaining({ code: 'DOCUMENTS_UNAVAILABLE' }))
  })

  it('rejects a second provider while the seam is held (DOCUMENTS_CONFLICT)', async () => {
    const { documents } = await mountDocuments()
    documents.registerProvider(makeProvider('first'))
    expect(() => documents.registerProvider(makeProvider('second')))
      .toThrow(expect.objectContaining({ code: 'DOCUMENTS_CONFLICT' }))
  })

  it('allows re-registration after dispose releases the reservation', async () => {
    const { documents } = await mountDocuments()
    const dispose = documents.registerProvider(makeProvider('first'))
    dispose()
    expect(() => documents.registerProvider(makeProvider('second'))).not.toThrow()
  })

  it('disposes the reservation when the contributing fiber is disposed', async () => {
    const { ctx, documents } = await mountDocuments()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.documents.registerProvider(makeProvider('p'))
    }, { inject: ['documents'] }))
    await expect(documents.create({ format: 'docx', title: 'T', blocks })).resolves.toBeDefined()
    await fiber.dispose()
    await expect(documents.create({ format: 'docx', title: 'T', blocks }))
      .rejects.toThrow(expect.objectContaining({ code: 'DOCUMENTS_UNAVAILABLE' }))
  })

  it('DocumentsError carries its structured code', () => {
    expect(new DocumentsError('m', 'DOCUMENTS_INVALID_REQUEST').code).toBe('DOCUMENTS_INVALID_REQUEST')
  })
})
