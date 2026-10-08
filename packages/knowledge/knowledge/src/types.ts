/**
 * Vocabulary for the knowledge-base capability seam (`ctx.knowledge`): a stored knowledge
 * document, the ingest payload callers submit, a lexical search request and its ranked hits,
 * a listing request, the provider contract that reserves the seam, and the `KnowledgeService`
 * surface the seam and its model-facing tool share. A knowledge base is a curated, durable
 * document corpus shared across sessions and users — distinct from `ctx.memory`, whose records
 * are short per-user agent memories: documents are titled, optionally sourced, larger, and
 * meant to be searched for passages rather than recalled wholesale.
 * @module @deepseek-ai/dsh-knowledge/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Stable, machine-routable codes for knowledge-base failures, carried on {@link KnowledgeError}
 * so callers branch on `code` instead of parsing `message`.
 */
export type KnowledgeErrorCode =
  | 'KNOWLEDGE_INVALID_PROVIDER'
  | 'KNOWLEDGE_CONFLICT'
  | 'KNOWLEDGE_UNAVAILABLE'
  | 'KNOWLEDGE_DISPOSED'
  | 'KNOWLEDGE_INVALID_REQUEST'

/**
 * Structured knowledge-base failure. Extends {@link HarnessError} with one {@link KnowledgeErrorCode}.
 */
export class KnowledgeError extends HarnessError {
  override readonly code: KnowledgeErrorCode

  constructor(message: string, code: KnowledgeErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/**
 * A caller's ingest payload for one knowledge document. `title` and `text` are required; the
 * refinements are optional so a caller records only what it knows. The provider assigns the
 * identity and creation timestamp, so neither is part of the input.
 */
export interface KnowledgeDraft {
  /** The document's human title, as free text. */
  readonly title: string
  /** The document's body, as free text. */
  readonly text: string
  /** Optional classification tags the provider stores and later filters search and listing by. */
  readonly tags?: readonly string[]
  /** Optional provenance (a URL, path, or other citation) the provider stores verbatim. */
  readonly source?: string
}

/**
 * A stored knowledge document as the provider persists it: an assigned `id`, the ingest
 * payload's content, and the creation time the provider stamped.
 */
export interface KnowledgeRecord {
  /** Provider-assigned stable identity used to remove this document. */
  readonly id: string
  /** The document's human title, as ingested. */
  readonly title: string
  /** The document's body, as ingested. */
  readonly text: string
  /** Classification tags stored with the document; empty when none were supplied. */
  readonly tags: readonly string[]
  /** Optional provenance recorded at ingest time, as supplied. */
  readonly source?: string
  /** RFC 3339 / ISO 8601 creation timestamp assigned by the provider at ingest time. */
  readonly createdAt: string
}

/**
 * A caller's normalized search query. The query text is required and never defaulted; every
 * filter is optional. Consumers own timeouts and result caps — the seam applies none, so
 * there is no `resolve()` step.
 */
export interface KnowledgeSearchRequest {
  /** Literal or tokenized text to match against document titles and bodies. */
  readonly query: string
  /** Optional tags restricting search to documents carrying them. */
  readonly tags?: readonly string[]
  /** Optional largest number of ranked hits to return; the provider applies its own default and cap. */
  readonly limit?: number
}

/**
 * One ranked search hit: a stored document, a provider-defined relevance score, and a
 * provider-computed excerpt around the first match.
 */
export interface KnowledgeHit {
  /** The matched document. */
  readonly record: KnowledgeRecord
  /** Provider-computed relevance score; higher ranks first. Its unit is provider-defined. */
  readonly score: number
  /** Provider-computed excerpt of the body around the first match; length is provider-defined. */
  readonly snippet: string
}

/** One result page for a search. The result is total for the request (no cursor). */
export interface KnowledgeSearchResult {
  /** Hits in descending relevance order; empty when nothing matched. */
  readonly hits: readonly KnowledgeHit[]
}

/**
 * A caller's listing request — retrieval by recency or tag rather than by query text. Every
 * field is optional; an omitted request lists the most recent documents.
 */
export interface KnowledgeListRequest {
  /** Optional tags restricting the listing to documents carrying them. */
  readonly tags?: readonly string[]
  /** Optional largest number of documents to return; the provider applies its own default and cap. */
  readonly limit?: number
}

/** One page of listed documents, most recent first. The result is total for the request (no cursor). */
export interface KnowledgePage {
  /** Documents in the provider's listing order (recency); empty when the corpus is empty. */
  readonly records: readonly KnowledgeRecord[]
}

/**
 * A knowledge-base backend that reserves `ctx.knowledge` and answers the four knowledge
 * operations. The provider owns storage identity, timestamps, chunking, ranking, snippets,
 * and result bounds; the seam only routes to it.
 */
export interface KnowledgeProvider {
  /** Opaque provider identity reserved atomically at registration. */
  readonly id: string
  /**
   * Persist one new document and return its assigned identity.
   * @param draft - the ingest payload; the provider assigns `id` and `createdAt`.
   * @param signal - cancellation honored across the write's I/O.
   * @returns the provider-assigned document identity.
   */
  ingest(draft: KnowledgeDraft, signal?: AbortSignal): Promise<string>
  /**
   * Answer one search against the provider's corpus.
   * @param request - the normalized query; the provider applies defaults for omitted refinements.
   * @param signal - cancellation honored across the query's I/O.
   * @returns a ranked, total result of hits with snippets.
   */
  search(request: KnowledgeSearchRequest, signal?: AbortSignal): Promise<KnowledgeSearchResult>
  /**
   * Delete one document by identity.
   * @param id - the document identity to remove.
   * @param signal - cancellation honored across the deletion's I/O.
   * @returns `true` when a document was removed, `false` when no such document existed.
   */
  remove(id: string, signal?: AbortSignal): Promise<boolean>
  /**
   * List stored documents by recency, optionally filtered.
   * @param request - the listing filter; all fields optional.
   * @param signal - cancellation honored across the query's I/O.
   * @returns a total page of documents.
   */
  list(request?: KnowledgeListRequest, signal?: AbortSignal): Promise<KnowledgePage>
}

/**
 * The `ctx.knowledge` surface: a single-provider reservation registry plus the four routed
 * operations (`ingest`, `search`, `remove`, `list`). The seam exposes no chunking, embedding,
 * or protocol escape hatch — storage layout and any vector retrieval are the provider's
 * private concern.
 */
export interface KnowledgeService {
  /** Whether a provider currently holds the seam; a read that never throws. */
  readonly available: boolean
  /**
   * Reserve the seam for one provider. Validate and conflict-check everything before
   * mutating: an invalid or conflicting registration publishes nothing, and its
   * disposer releases the reservation.
   * @param provider - the backend claiming the seam.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: KnowledgeProvider): () => void
  /**
   * Route one ingest to the registered provider.
   * @param draft - the ingest payload.
   * @param signal - cancellation forwarded to the provider.
   * @returns the provider-assigned document identity.
   * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
   */
  ingest(draft: KnowledgeDraft, signal?: AbortSignal): Promise<string>
  /**
   * Route one search to the registered provider.
   * @param request - the normalized query.
   * @param signal - cancellation forwarded to the provider.
   * @returns a ranked, total result of hits with snippets.
   * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
   */
  search(request: KnowledgeSearchRequest, signal?: AbortSignal): Promise<KnowledgeSearchResult>
  /**
   * Route one deletion to the registered provider.
   * @param id - the document identity to remove.
   * @param signal - cancellation forwarded to the provider.
   * @returns `true` when a document was removed, `false` when none matched.
   * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
   */
  remove(id: string, signal?: AbortSignal): Promise<boolean>
  /**
   * Route one listing to the registered provider.
   * @param request - the listing filter; all fields optional.
   * @param signal - cancellation forwarded to the provider.
   * @returns a total page of documents.
   * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
   */
  list(request?: KnowledgeListRequest, signal?: AbortSignal): Promise<KnowledgePage>
}
