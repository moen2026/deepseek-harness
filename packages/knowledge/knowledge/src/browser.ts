/**
 * Browser Remote face over the knowledge seam: availability, listing, and
 * removal for the Web knowledge center. The face routes to `ctx.knowledge` and
 * owns no storage; a deployment without a provider answers an explicit
 * unavailable status instead of an error the browser cannot distinguish from a
 * broken route.
 * @module @deepseek-ai/dsh-knowledge/browser
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { KnowledgeBrowserStatus } from './client.ts'
import type { KnowledgeListRequest, KnowledgePage } from './types.ts'

export type { KnowledgeBrowserStatus }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser Remote face over the knowledge seam. */
    knowledgeBrowser: KnowledgeBrowserService
  }
}

/**
 * `ctx.knowledgeBrowser`. A read-and-remove face: ingest and search stay
 * model-side operations, so the browser cannot write corpus content.
 */
export class KnowledgeBrowserService extends TypertRemoteService {
  static inject = ['knowledge'] as const

  /**
   * @param ctx - Host context whose `knowledge` seam this face routes to.
   */
  constructor(ctx: Context) {
    super(ctx, 'knowledge')
  }

  /**
   * Probe whether a provider holds the seam.
   * @returns the availability answer; never rejects for an unheld seam.
   */
  @Remote('status')
  status(): Promise<KnowledgeBrowserStatus> {
    return Promise.resolve({ available: this.ctx.knowledge.available })
  }

  /**
   * List stored documents by recency.
   * @param request - the listing filter; all fields optional.
   * @param signal - cancellation forwarded to the provider.
   * @returns a total page of documents.
   */
  @Remote('list')
  async list(request?: KnowledgeListRequest, signal?: AbortSignal): Promise<KnowledgePage> {
    return this.ctx.knowledge.list(request, signal)
  }

  /**
   * Remove one document.
   * @param id - the document identity to remove.
   * @param signal - cancellation forwarded to the provider.
   * @returns `true` when a document was removed, `false` when none matched.
   */
  @Remote('remove')
  async remove(id: string, signal?: AbortSignal): Promise<boolean> {
    return this.ctx.knowledge.remove(id, signal)
  }
}

export default KnowledgeBrowserService
