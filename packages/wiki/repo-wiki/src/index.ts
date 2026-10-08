/**
 * Service Definition for the repo-wiki capability seam (`ctx.repoWiki`): a
 * single-provider reservation registry and read-only routes over generated
 * repository wiki pages.
 *
 * A provider reserves the seam exclusively: {@link RepoWiki.registerProvider}
 * validates and conflict-checks before mutating, so an invalid or conflicting
 * registration publishes nothing, and its disposer releases the reservation.
 * Only one provider may hold the seam at a time — a repo wiki is a whole-repo
 * claim, not a per-tree route. The seam exposes exactly the read routes
 * (`getPage`, `listPages`, `outline`) and no generation or storage escape
 * hatch: writing pages is the provider's private concern.
 * @module @deepseek-ai/dsh-repo-wiki
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { RepoWikiError, normalizeWikiPath } from './types.ts'
import type {
  RepoWikiProvider,
  RepoWikiService,
  WikiListing,
  WikiOutlineEntry,
  WikiPage,
} from './types.ts'

export {
  RepoWikiError,
  normalizeWikiPath,
} from './types.ts'
export type {
  RepoWikiErrorCode,
  RepoWikiProvider,
  RepoWikiService,
  WikiListing,
  WikiOutlineEntry,
  WikiPage,
  WikiPageSummary,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    repoWiki: RepoWikiService
  }
}

/**
 * `ctx.repoWiki`. Holds the single reserved provider; the reservation and the
 * read routes are populated and cleared together so a route always has a live
 * provider.
 */
export class RepoWiki extends Service implements RepoWikiService {
  private provider: RepoWikiProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'repoWiki')
  }

  registerProvider(provider: RepoWikiProvider): () => void {
    // Validate and conflict-check BEFORE any mutation: an invalid or conflicting
    // registration must publish nothing (fail-loud, all-or-nothing).
    if (provider.id.trim() === '') {
      throw new RepoWikiError('a repo-wiki provider id must be a non-empty string', 'REPO_WIKI_INVALID_PROVIDER')
    }
    if (this.provider !== undefined) {
      throw new RepoWikiError(
        `repo-wiki seam is already held by provider "${this.provider.id}"`,
        'REPO_WIKI_CONFLICT',
      )
    }

    const dispose = this.ctx.effect(function* (this: RepoWiki) {
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'repoWiki.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  async getPage(path: string): Promise<WikiPage> {
    const provider = this.provider
    if (provider === undefined) {
      throw new RepoWikiError('no repo-wiki provider is registered', 'REPO_WIKI_UNAVAILABLE')
    }
    return provider.getPage(normalizeWikiPath(path))
  }

  async listPages(): Promise<WikiListing> {
    const provider = this.provider
    if (provider === undefined) {
      throw new RepoWikiError('no repo-wiki provider is registered', 'REPO_WIKI_UNAVAILABLE')
    }
    return provider.listPages()
  }

  async outline(): Promise<readonly WikiOutlineEntry[]> {
    const provider = this.provider
    if (provider === undefined) {
      throw new RepoWikiError('no repo-wiki provider is registered', 'REPO_WIKI_UNAVAILABLE')
    }
    return provider.outline()
  }
}

export default RepoWiki
