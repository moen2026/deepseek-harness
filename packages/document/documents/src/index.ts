/**
 * Service Definition for the document-creation capability seam (`ctx.documents`): a
 * single-provider reservation registry and one order-independent route — create —
 * over normalized requests.
 *
 * A provider reserves the seam exclusively: {@link Documents.registerProvider} validates
 * and conflict-checks before mutating, so an invalid or conflicting registration publishes
 * nothing, and its disposer releases the reservation. Only one provider may hold the seam
 * at a time — a creation backend is a whole-format claim, not a per-caller route. The
 * seam exposes the one operation and no protocol escape hatch.
 * @module @deepseek-ai/dsh-documents
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { DocumentsError } from './types.ts'
import type {
  DocumentCreateRequest,
  DocumentResult,
  DocumentsProvider,
  DocumentsService,
} from './types.ts'

export {
  DocumentsError,
} from './types.ts'
export type {
  DocumentBlock,
  DocumentCreateRequest,
  DocumentFormat,
  DocumentResult,
  DocumentsErrorCode,
  DocumentsProvider,
  DocumentsService,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    documents: DocumentsService
  }
}

/**
 * `ctx.documents`. Holds the single reserved provider; the reservation and the route
 * are populated and cleared together so a route always has a live provider.
 */
export class Documents extends Service implements DocumentsService {
  private provider: DocumentsProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'documents')
  }

  registerProvider(provider: DocumentsProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (provider.id.trim() === '') {
      throw new DocumentsError('a documents provider id must be a non-empty string', 'DOCUMENTS_INVALID_PROVIDER')
    }
    if (this.provider !== undefined) {
      throw new DocumentsError(
        `documents seam is already held by provider "${this.provider.id}"`,
        'DOCUMENTS_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: Documents) {
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'documents.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /** The single reserved provider or a fail-loud `DOCUMENTS_UNAVAILABLE`. */
  private requireProvider(): DocumentsProvider {
    const provider = this.provider
    if (provider === undefined) {
      throw new DocumentsError('no documents provider is registered', 'DOCUMENTS_UNAVAILABLE')
    }
    return provider
  }

  async create(request: DocumentCreateRequest, signal?: AbortSignal): Promise<DocumentResult> {
    return this.requireProvider().create(request, signal)
  }
}

export default Documents
