/**
 * Vocabulary for the long-term-memory capability seam (`ctx.memory`): a stored memory
 * record, the write payload callers submit, a lexical recall request and its ranked hits,
 * a listing request, the provider contract that reserves the seam, and the `MemoryService`
 * surface the seam and its model-facing tool share. Records carry an optional typed
 * namespace, a caller confidence, and a provider-computed expiry; recall and listing
 * filter on all three (expired records are never returned).
 * @module @deepseek-ai/dsh-memory/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * The closed vocabulary of memory namespaces: `preference` (how the user wants work done),
 * `fact` (durable project or environment facts), and `style` (collaboration-style guidance
 * injected into model context). A record without a namespace is unclassified.
 */
export type MemoryNamespace = 'preference' | 'fact' | 'style'

/** Every {@link MemoryNamespace}, for validation and option advertisement. */
export const MEMORY_NAMESPACES: readonly MemoryNamespace[] = ['preference', 'fact', 'style']

/**
 * Stable, machine-routable codes for memory failures, carried on {@link MemoryError}
 * so callers branch on `code` instead of parsing `message`.
 */
export type MemoryErrorCode =
  | 'MEMORY_INVALID_PROVIDER'
  | 'MEMORY_CONFLICT'
  | 'MEMORY_UNAVAILABLE'
  | 'MEMORY_DISPOSED'
  | 'MEMORY_INVALID_REQUEST'

/**
 * Structured memory failure. Extends {@link HarnessError} with one {@link MemoryErrorCode}.
 */
export class MemoryError extends HarnessError {
  override readonly code: MemoryErrorCode

  constructor(message: string, code: MemoryErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/**
 * A caller's write payload for a new memory. Only `text` is required; every refinement is
 * optional so a caller records only what it means. The provider assigns the identity and
 * creation timestamp, so neither is part of the input.
 */
export interface MemoryDraft {
  /** The remembered statement or fact, as free text. */
  readonly text: string
  /** Optional classification tags the provider stores and later filters recall by. */
  readonly tags?: readonly string[]
  /** Optional scope string (for example a project or workspace) partitioning the store. */
  readonly scope?: string
  /** Optional typed namespace classifying the record (see {@link MemoryNamespace}). */
  readonly namespace?: MemoryNamespace
  /** Optional caller confidence in this memory, from 0 through 1. */
  readonly confidence?: number
  /**
   * Optional positive time-to-live in milliseconds from the provider's write time.
   * The provider stores the computed {@link MemoryRecord.expiresAt}; expired records
   * stop appearing in recall and listing results.
   */
  readonly ttlMs?: number
}

/**
 * A stored memory record as the provider persists it: an assigned `id`, the recorded text,
 * the caller's optional refinements, and the creation time the provider stamped.
 */
export interface MemoryRecord {
  /** Provider-assigned stable identity used to recall or forget this record. */
  readonly id: string
  /** The remembered statement or fact, as free text. */
  readonly text: string
  /** Classification tags stored with the record; empty when none were supplied. */
  readonly tags: readonly string[]
  /** Optional scope the record belongs to, as supplied at write time. */
  readonly scope?: string
  /** Optional typed namespace the record was classified with. */
  readonly namespace?: MemoryNamespace
  /** Optional caller confidence recorded at write time, from 0 through 1. */
  readonly confidence?: number
  /** RFC 3339 / ISO 8601 creation timestamp assigned by the provider at write time. */
  readonly createdAt: string
  /** RFC 3339 / ISO 8601 expiry computed from the draft's `ttlMs`, absent when the record never expires. */
  readonly expiresAt?: string
}

/**
 * A caller's normalized recall query. The query text is required and never defaulted;
 * every filter is optional. Consumers own timeouts and result caps — the seam applies none,
 * so there is no `resolve()` step.
 */
export interface MemoryRecallRequest {
  /** Literal or tokenized text to match against stored memories. */
  readonly query: string
  /** Optional tags restricting recall to records carrying them. */
  readonly tags?: readonly string[]
  /** Optional scope restricting recall to one partition of the store. */
  readonly scope?: string
  /** Optional namespace restricting recall to records classified with it. */
  readonly namespace?: MemoryNamespace
  /** Optional lowest recorded confidence eligible for recall (records without one are excluded). */
  readonly minConfidence?: number
  /** Optional largest number of ranked hits to return; the provider applies its own default and cap. */
  readonly limit?: number
}

/** One ranked recall hit: a stored record plus a provider-defined relevance score. */
export interface MemoryHit {
  /** The matched record. */
  readonly record: MemoryRecord
  /** Provider-computed relevance score; higher ranks first. Its unit is provider-defined. */
  readonly score: number
}

/** One result page for a recall. The result is total for the request (no cursor). */
export interface MemoryRecallResult {
  /** Hits in descending relevance order; empty when nothing matched. */
  readonly hits: readonly MemoryHit[]
}

/**
 * A caller's listing request — retrieval by recency or filter rather than by query text.
 * Every field is optional; an omitted request lists the most recent records.
 */
export interface MemoryListRequest {
  /** Optional tags restricting the listing to records carrying them. */
  readonly tags?: readonly string[]
  /** Optional scope restricting the listing to one partition of the store. */
  readonly scope?: string
  /** Optional namespace restricting the listing to records classified with it. */
  readonly namespace?: MemoryNamespace
  /** Optional lowest recorded confidence eligible for listing (records without one are excluded). */
  readonly minConfidence?: number
  /** Optional largest number of records to return; the provider applies its own default and cap. */
  readonly limit?: number
}

/** One page of listed records, most recent first. The result is total for the request (no cursor). */
export interface MemoryPage {
  /** Records in the provider's listing order (recency); empty when the store is empty. */
  readonly records: readonly MemoryRecord[]
}

/**
 * A memory backend that reserves `ctx.memory` and answers the four memory operations. The
 * provider owns storage identity, timestamps, ranking, and result bounds; the seam only
 * routes to it.
 */
export interface MemoryProvider {
  /** Opaque provider identity reserved atomically at registration. */
  readonly id: string
  /**
   * Persist one new memory and return its assigned identity.
   * @param draft - the write payload; the provider assigns `id` and `createdAt`.
   * @param signal - cancellation honored across the write's I/O.
   * @returns the provider-assigned record identity.
   */
  remember(draft: MemoryDraft, signal?: AbortSignal): Promise<string>
  /**
   * Answer one recall against the provider's store.
   * @param request - the normalized query; the provider applies defaults for omitted refinements.
   * @param signal - cancellation honored across the query's I/O.
   * @returns a ranked, total result of hits.
   */
  recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>
  /**
   * Delete one memory by identity.
   * @param id - the record identity to forget.
   * @param signal - cancellation honored across the deletion's I/O.
   * @returns `true` when a record was removed, `false` when no such record existed.
   */
  forget(id: string, signal?: AbortSignal): Promise<boolean>
  /**
   * List stored records by recency, optionally filtered.
   * @param request - the listing filter; all fields optional.
   * @param signal - cancellation honored across the query's I/O.
   * @returns a total page of records.
   */
  list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryPage>
}

/**
 * The `ctx.memory` surface: a single-provider reservation registry plus the four routed
 * operations (`remember`, `recall`, `forget`, `list`). The seam exposes no embedding or
 * protocol escape hatch — storage layout and any vector retrieval are the provider's
 * private concern.
 */
export interface MemoryService {
  /** Whether a provider currently holds the seam; a read that never throws. */
  readonly available: boolean
  /**
   * Reserve the seam for one provider. Validate and conflict-check everything before
   * mutating: an invalid or conflicting registration publishes nothing, and its
   * disposer releases the reservation.
   * @param provider - the backend claiming the seam.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: MemoryProvider): () => void
  /**
   * Route one write to the registered provider.
   * @param draft - the write payload.
   * @param signal - cancellation forwarded to the provider.
   * @returns the provider-assigned record identity.
   * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
   */
  remember(draft: MemoryDraft, signal?: AbortSignal): Promise<string>
  /**
   * Route one recall to the registered provider.
   * @param request - the normalized query.
   * @param signal - cancellation forwarded to the provider.
   * @returns a ranked, total result of hits.
   * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
   */
  recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>
  /**
   * Route one deletion to the registered provider.
   * @param id - the record identity to forget.
   * @param signal - cancellation forwarded to the provider.
   * @returns `true` when a record was removed, `false` when none matched.
   * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
   */
  forget(id: string, signal?: AbortSignal): Promise<boolean>
  /**
   * Route one listing to the registered provider.
   * @param request - the listing filter; all fields optional.
   * @param signal - cancellation forwarded to the provider.
   * @returns a total page of records.
   * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
   */
  list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryPage>
}
