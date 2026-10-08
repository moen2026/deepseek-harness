/**
 * Vocabulary for the repo-wiki capability seam (`ctx.repoWiki`): neutral wiki-page
 * vocabulary (path, title, content, staleness), the read-only provider contract that
 * reserves the seam, and the `RepoWikiService` surface the seam and its model-facing
 * tool share.
 * @module @deepseek-ai/dsh-repo-wiki/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Stable, machine-routable codes for repo-wiki failures, carried on {@link RepoWikiError}
 * so callers branch on `code` instead of parsing `message`.
 */
export type RepoWikiErrorCode =
  | 'REPO_WIKI_INVALID_PROVIDER'
  | 'REPO_WIKI_CONFLICT'
  | 'REPO_WIKI_UNAVAILABLE'
  | 'REPO_WIKI_INVALID_PATH'
  | 'REPO_WIKI_NOT_FOUND'

/**
 * Structured repo-wiki failure. Extends {@link HarnessError} with one {@link RepoWikiErrorCode}.
 */
export class RepoWikiError extends HarnessError {
  override readonly code: RepoWikiErrorCode

  constructor(message: string, code: RepoWikiErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** Normalize a wiki page path into its canonical seam form, or reject it.
 * @param path - the caller-supplied page path.
 * @returns the canonical wiki-relative `.md` path.
 * @throws RepoWikiError when the path is empty, not `.md`, or escapes the wiki root.
 */
export function normalizeWikiPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/')
  if (trimmed === '' || !trimmed.endsWith('.md')) {
    throw new RepoWikiError(`a wiki page path must be a non-empty .md path, got ${JSON.stringify(path)}`, 'REPO_WIKI_INVALID_PATH')
  }
  if (trimmed.includes('..') || trimmed.startsWith('/')) {
    throw new RepoWikiError(`a wiki page path must stay inside the wiki root, got ${JSON.stringify(path)}`, 'REPO_WIKI_INVALID_PATH')
  }
  return trimmed
}

/** One wiki page's identity and freshness, without its body. */
export interface WikiPageSummary {
  /** Wiki-relative page path with a `.md` suffix, e.g. `packages-wiki.md`. */
  readonly path: string
  /** Human title derived from the page's first heading. */
  readonly title: string
  /**
   * `true` when the page was generated from sources that have since changed, so its
   * content may be outdated; `false` when the page matches its recorded sources.
   */
  readonly stale: boolean
}

/** One full wiki page: its identity plus the generated Markdown body. */
export interface WikiPage extends WikiPageSummary {
  /** The page's complete Markdown content, exactly as generated. */
  readonly content: string
}

/** One outline entry: a page identity plus its Markdown heading structure. */
export interface WikiOutlineEntry extends WikiPageSummary {
  /** The page's heading lines (`#`-prefixed), in document order. */
  readonly headings: readonly string[]
}

/** A listing result: every page the provider currently serves. */
export interface WikiListing {
  /** Page summaries ordered by path. */
  readonly pages: readonly WikiPageSummary[]
}

/**
 * A repo-wiki backend that reserves `ctx.repoWiki` and answers read-only page
 * queries. The provider owns page generation, storage, and staleness tracking —
 * write access is the provider's private concern and never appears on the seam.
 */
export interface RepoWikiProvider {
  /** Opaque provider identity reserved atomically at registration. */
  readonly id: string
  /**
   * Return one full page by its wiki-relative path.
   * @param path - the wiki-relative `.md` path, as listed by `listPages`.
   * @returns the page's identity and body.
   * @throws {@link RepoWikiError} with `REPO_WIKI_NOT_FOUND` when no page has that path.
   */
  getPage(path: string): Promise<WikiPage>
  /**
   * List every page the provider currently serves.
   * @returns the page summaries ordered by path.
   */
  listPages(): Promise<WikiListing>
  /**
   * Return every page's heading structure.
   * @returns outline entries ordered by path.
   */
  outline(): Promise<readonly WikiOutlineEntry[]>
}

/**
 * The `ctx.repoWiki` surface: a single-provider reservation registry plus the
 * read-only routes (`getPage`, `listPages`, `outline`) that forward to the
 * registered provider. The seam exposes exactly the read routes — populating,
 * regenerating, and storing pages is the provider's private concern.
 */
export interface RepoWikiService {
  /**
   * Reserve the seam for one provider. Validate and conflict-check everything before
   * mutating: an invalid or conflicting registration publishes nothing, and its
   * disposer releases the reservation.
   * @param provider - the backend claiming the seam.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: RepoWikiProvider): () => void
  /**
   * Route one page read to the registered provider.
   * @param path - the wiki-relative `.md` path.
   * @returns the page's identity and body.
   * @throws {@link RepoWikiError} with `REPO_WIKI_UNAVAILABLE` when no provider is registered.
   */
  getPage(path: string): Promise<WikiPage>
  /**
   * List every page through the registered provider.
   * @returns the page summaries ordered by path.
   * @throws {@link RepoWikiError} with `REPO_WIKI_UNAVAILABLE` when no provider is registered.
   */
  listPages(): Promise<WikiListing>
  /**
   * Return every page's heading structure through the registered provider.
   * @returns the outline entries ordered by path.
   * @throws {@link RepoWikiError} with `REPO_WIKI_UNAVAILABLE` when no provider is registered.
   */
  outline(): Promise<readonly WikiOutlineEntry[]>
}
