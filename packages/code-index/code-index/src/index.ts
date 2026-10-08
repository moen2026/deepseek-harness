/**
 * Service Definition for the code-index capability seam (`ctx.codeIndex`): a
 * single-provider reservation registry and one order-independent lexical code-search
 * route over a normalized request.
 *
 * A provider reserves the seam exclusively: {@link CodeIndex.registerProvider}
 * validates and conflict-checks before mutating, so an invalid or conflicting
 * registration publishes nothing, and its disposer releases the reservation. Only one
 * provider may hold the seam at a time — a code index is a whole-corpus claim, not a
 * per-extension route. The seam exposes exactly `search` and no index-building or
 * protocol escape hatch.
 * @module @deepseek-ai/dsh-code-index
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { CodeIndexError } from './types.ts'
import type {
  CodeIndexProvider,
  CodeIndexService,
  CodeSearchRequest,
  CodeSearchPage,
} from './types.ts'

export {
  CodeIndexError,
} from './types.ts'
export type {
  CodeIndexErrorCode,
  CodeIndexProvider,
  CodeIndexService,
  CodeSearchHit,
  CodeSearchPage,
  CodeSearchRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    codeIndex: CodeIndexService
  }
}

/**
 * `ctx.codeIndex`. Holds the single reserved provider; the reservation and the route
 * are populated and cleared together so a route always has a live provider.
 */
export class CodeIndex extends Service implements CodeIndexService {
  private provider: CodeIndexProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'codeIndex')
  }

  registerProvider(provider: CodeIndexProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (provider.id.trim() === '') {
      throw new CodeIndexError('a code-index provider id must be a non-empty string', 'CODE_INDEX_INVALID_PROVIDER')
    }
    if (this.provider !== undefined) {
      throw new CodeIndexError(
        `code-index seam is already held by provider "${this.provider.id}"`,
        'CODE_INDEX_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: CodeIndex) {
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'codeIndex.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  async search(request: CodeSearchRequest, signal?: AbortSignal): Promise<CodeSearchPage> {
    const provider = this.provider
    if (provider === undefined) {
      throw new CodeIndexError('no code-index provider is registered', 'CODE_INDEX_UNAVAILABLE')
    }
    return provider.search(request, signal)
  }
}

export default CodeIndex
