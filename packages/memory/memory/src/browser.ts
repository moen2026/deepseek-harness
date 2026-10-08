/**
 * Browser Remote face over the memory seam: availability, listing, and
 * removal for the Web memory center. The face routes to `ctx.memory` and owns
 * no storage; a deployment without a provider answers an explicit unavailable
 * status instead of an error the browser cannot distinguish from a broken
 * route. Writes and recall stay model-side operations, so the browser cannot
 * create memories.
 * @module @deepseek-ai/dsh-memory/browser
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { MemoryBrowserStatus } from './client.ts'
import type { MemoryListRequest, MemoryPage } from './types.ts'

export type { MemoryBrowserStatus }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser Remote face over the memory seam. */
    memoryBrowser: MemoryBrowserService
  }
}

/**
 * `ctx.memoryBrowser`. A read-and-remove face: remembering and recall stay
 * model-side operations, so the browser cannot write memory content.
 */
export class MemoryBrowserService extends TypertRemoteService {
  static inject = ['memory'] as const

  /**
   * @param ctx - Host context whose `memory` seam this face routes to.
   */
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  /**
   * Probe whether a provider holds the seam.
   * @returns the availability answer; never rejects for an unheld seam.
   */
  @Remote('status')
  status(): Promise<MemoryBrowserStatus> {
    return Promise.resolve({ available: this.ctx.memory.available })
  }

  /**
   * List stored memories by recency.
   * @param request - the listing filter; all fields optional.
   * @param signal - cancellation forwarded to the provider.
   * @returns a total page of memories.
   */
  @Remote('list')
  async list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryPage> {
    return this.ctx.memory.list(request, signal)
  }

  /**
   * Remove one memory.
   * @param id - the memory identity to remove.
   * @param signal - cancellation forwarded to the provider.
   * @returns `true` when a memory was removed, `false` when none matched.
   */
  @Remote('forget')
  async forget(id: string, signal?: AbortSignal): Promise<boolean> {
    return this.ctx.memory.forget(id, signal)
  }
}

export default MemoryBrowserService
