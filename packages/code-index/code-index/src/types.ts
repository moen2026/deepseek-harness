/**
 * Vocabulary for the code-index capability seam (`ctx.codeIndex`): a single lexical
 * code-search request, one ranked result page, the provider contract that reserves the
 * seam, and the `CodeIndexService` surface the seam and its model-facing tool share.
 * @module @deepseek-ai/dsh-code-index/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Stable, machine-routable codes for code-index failures, carried on {@link CodeIndexError}
 * so callers branch on `code` instead of parsing `message`.
 */
export type CodeIndexErrorCode =
  | 'CODE_INDEX_INVALID_PROVIDER'
  | 'CODE_INDEX_CONFLICT'
  | 'CODE_INDEX_UNAVAILABLE'
  | 'CODE_INDEX_DISPOSED'
  | 'CODE_INDEX_INVALID_REQUEST'

/**
 * Structured code-index failure. Extends {@link HarnessError} with one {@link CodeIndexErrorCode}.
 */
export class CodeIndexError extends HarnessError {
  override readonly code: CodeIndexErrorCode

  constructor(message: string, code: CodeIndexErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/**
 * A caller's normalized lexical code-search query. The query text is required and
 * never defaulted; every refinement is optional so a caller sends only what it means.
 * Consumers own timeouts and result caps — the seam applies none, so there is no
 * `resolve()` step.
 */
export interface CodeSearchRequest {
  /** Literal or tokenized text to match against indexed source chunks. */
  readonly query: string
  /** Optional glob limiting which indexed file paths are searched (for example a `packages` tree filtered to `.ts`). */
  readonly glob?: string
  /** Optional language id restricting results to one syntax (e.g. `typescript`). */
  readonly language?: string
  /** Optional largest number of ranked hits to return; the provider applies its own default and cap. */
  readonly limit?: number
}

/** One ranked search hit: a bounded line range in one indexed file plus a match snippet. */
export interface CodeSearchHit {
  /** Workspace-relative path of the matched file, as recorded at index time. */
  readonly path: string
  /** One-based first line of the matched chunk. */
  readonly startLine: number
  /** One-based last line of the matched chunk. */
  readonly endLine: number
  /** Optional syntax language id recorded for the file. */
  readonly language?: string
  /** Provider-computed relevance score; higher ranks first. Its unit is provider-defined. */
  readonly score: number
  /** Short excerpt of the matched region for display, already bounded by the provider. */
  readonly snippet: string
}

/** One page of ranked hits. The result is total for the request (no cursor). */
export interface CodeSearchPage {
  /** Hits in descending relevance order; empty when nothing matched. */
  readonly hits: readonly CodeSearchHit[]
}

/**
 * A code-index backend that reserves `ctx.codeIndex` and answers lexical searches. The
 * provider owns its corpus, ranking, and result bounds; the seam only routes to it.
 */
export interface CodeIndexProvider {
  /** Opaque provider identity reserved atomically at registration. */
  readonly id: string
  /**
   * Answer one lexical search against the provider's index.
   * @param request - the normalized query; the provider applies defaults for omitted refinements.
   * @param signal - cancellation honored across the query's I/O.
   * @returns a ranked, total page of hits.
   */
  search(request: CodeSearchRequest, signal?: AbortSignal): Promise<CodeSearchPage>
}

/**
 * The `ctx.codeIndex` surface: a single-provider reservation registry plus one
 * read-only `search` that routes to the registered provider. The seam exposes exactly
 * `search` and no index-building or protocol escape hatch — populating the corpus is
 * the provider's private concern.
 */
export interface CodeIndexService {
  /**
   * Reserve the seam for one provider. Validate and conflict-check everything before
   * mutating: an invalid or conflicting registration publishes nothing, and its
   * disposer releases the reservation.
   * @param provider - the backend claiming the seam.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: CodeIndexProvider): () => void
  /**
   * Route one lexical search to the registered provider.
   * @param request - the normalized query.
   * @param signal - cancellation forwarded to the provider.
   * @returns a ranked, total page of hits.
   * @throws {@link CodeIndexError} with `CODE_INDEX_UNAVAILABLE` when no provider is registered.
   */
  search(request: CodeSearchRequest, signal?: AbortSignal): Promise<CodeSearchPage>
}
