/**
 * Service Definition for the long-term-memory capability seam (`ctx.memory`): a
 * single-provider reservation registry and four order-independent routes — remember,
 * recall, forget, and list — over normalized requests.
 *
 * A provider reserves the seam exclusively: {@link Memory.registerProvider} validates and
 * conflict-checks before mutating, so an invalid or conflicting registration publishes
 * nothing, and its disposer releases the reservation. Only one provider may hold the seam
 * at a time — a durable memory store is a whole-corpus claim, not a per-caller route. The
 * seam exposes the four operations and no embedding or protocol escape hatch.
 * @module @deepseek-ai/dsh-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { MemoryError } from './types.ts'
import type {
  MemoryDraft,
  MemoryListRequest,
  MemoryPage,
  MemoryProvider,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryService,
} from './types.ts'

export {
  MemoryError,
  MEMORY_NAMESPACES,
} from './types.ts'
export type {
  MemoryDraft,
  MemoryErrorCode,
  MemoryHit,
  MemoryListRequest,
  MemoryNamespace,
  MemoryPage,
  MemoryProvider,
  MemoryRecord,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryService,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}

/**
 * `ctx.memory`. Holds the single reserved provider; the reservation and the four routes
 * are populated and cleared together so a route always has a live provider.
 */
export class Memory extends Service implements MemoryService {
  private provider: MemoryProvider | undefined

  /** Whether a provider currently holds the seam; a read that never throws. */
  get available(): boolean {
    return this.provider !== undefined
  }

  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  registerProvider(provider: MemoryProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (provider.id.trim() === '') {
      throw new MemoryError('a memory provider id must be a non-empty string', 'MEMORY_INVALID_PROVIDER')
    }
    if (this.provider !== undefined) {
      throw new MemoryError(
        `memory seam is already held by provider "${this.provider.id}"`,
        'MEMORY_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: Memory) {
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'memory.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /** The single reserved provider or a fail-loud `MEMORY_UNAVAILABLE`. */
  private requireProvider(): MemoryProvider {
    const provider = this.provider
    if (provider === undefined) {
      throw new MemoryError('no memory provider is registered', 'MEMORY_UNAVAILABLE')
    }
    return provider
  }

  async remember(draft: MemoryDraft, signal?: AbortSignal): Promise<string> {
    return this.requireProvider().remember(draft, signal)
  }

  async recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult> {
    return this.requireProvider().recall(request, signal)
  }

  async forget(id: string, signal?: AbortSignal): Promise<boolean> {
    return this.requireProvider().forget(id, signal)
  }

  async list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryPage> {
    return this.requireProvider().list(request, signal)
  }
}

export default Memory
