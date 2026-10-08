/**
 * Service Definition for the knowledge-base capability seam (`ctx.knowledge`): a
 * single-provider reservation registry and four order-independent routes — ingest,
 * search, remove, and list — over normalized requests.
 *
 * A provider reserves the seam exclusively: {@link Knowledge.registerProvider} validates and
 * conflict-checks before mutating, so an invalid or conflicting registration publishes
 * nothing, and its disposer releases the reservation. Only one provider may hold the seam
 * at a time — a knowledge base is a whole-corpus claim, not a per-caller route. The seam
 * exposes the four operations and no chunking, embedding, or protocol escape hatch.
 * @module @deepseek-ai/dsh-knowledge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { KnowledgeError } from './types.ts'
import type {
  KnowledgeDraft,
  KnowledgeListRequest,
  KnowledgePage,
  KnowledgeProvider,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
  KnowledgeService,
} from './types.ts'

export {
  KnowledgeError,
} from './types.ts'
export type {
  KnowledgeDraft,
  KnowledgeErrorCode,
  KnowledgeHit,
  KnowledgeListRequest,
  KnowledgePage,
  KnowledgeProvider,
  KnowledgeRecord,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
  KnowledgeService,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledge: KnowledgeService
  }
}

/**
 * `ctx.knowledge`. Holds the single reserved provider; the reservation and the four routes
 * are populated and cleared together so a route always has a live provider.
 */
export class Knowledge extends Service implements KnowledgeService {
  private provider: KnowledgeProvider | undefined

  /** Whether a provider currently holds the seam; a read that never throws. */
  get available(): boolean {
    return this.provider !== undefined
  }

  constructor(ctx: Context) {
    super(ctx, 'knowledge')
  }

  registerProvider(provider: KnowledgeProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (provider.id.trim() === '') {
      throw new KnowledgeError('a knowledge provider id must be a non-empty string', 'KNOWLEDGE_INVALID_PROVIDER')
    }
    if (this.provider !== undefined) {
      throw new KnowledgeError(
        `knowledge seam is already held by provider "${this.provider.id}"`,
        'KNOWLEDGE_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: Knowledge) {
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'knowledge.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /** The single reserved provider or a fail-loud `KNOWLEDGE_UNAVAILABLE`. */
  private requireProvider(): KnowledgeProvider {
    const provider = this.provider
    if (provider === undefined) {
      throw new KnowledgeError('no knowledge provider is registered', 'KNOWLEDGE_UNAVAILABLE')
    }
    return provider
  }

  async ingest(draft: KnowledgeDraft, signal?: AbortSignal): Promise<string> {
    return this.requireProvider().ingest(draft, signal)
  }

  async search(request: KnowledgeSearchRequest, signal?: AbortSignal): Promise<KnowledgeSearchResult> {
    return this.requireProvider().search(request, signal)
  }

  async remove(id: string, signal?: AbortSignal): Promise<boolean> {
    return this.requireProvider().remove(id, signal)
  }

  async list(request?: KnowledgeListRequest, signal?: AbortSignal): Promise<KnowledgePage> {
    return this.requireProvider().list(request, signal)
  }
}

export default Knowledge
