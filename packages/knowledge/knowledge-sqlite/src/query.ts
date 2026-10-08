/**
 * Query normalization, byte bounds, and FTS5 escaping for the knowledge provider. The
 * caller's query and ingest payload are always treated as inert data, never FTS5 syntax,
 * so an unbalanced quote in user input cannot break the match expression.
 * @module @deepseek-ai/dsh-knowledge-sqlite/query
 */

import { KnowledgeError } from '@deepseek-ai/dsh-knowledge'
import type { KnowledgeDraft } from '@deepseek-ai/dsh-knowledge'

/** How many times the requested page size the provider prefilters lexically before tag filtering. */
export const SEARCH_POOL_FACTOR = 4

/** A validated ingest payload with every refinement normalized. */
export interface NormalizedDraft {
  /** The non-empty document title within the title byte cap. */
  readonly title: string
  /** The non-empty document body within the text byte cap. */
  readonly text: string
  /** The normalized, non-empty-filtered tag array. */
  readonly tags: string[]
  /** The trimmed provenance, absent when blank or not supplied. */
  readonly source?: string
}

/** A normalized, ready-to-execute search. */
export interface NormalizedSearch {
  /** Sanitized single-phrase FTS5 match expression. */
  readonly match: string
  /** Bounded final result count. */
  readonly limit: number
  /** Bounded lexical candidate pool prefetched before tag filtering. */
  readonly pool: number
  /** Optional tag set a candidate must contain to be eligible. */
  readonly tags?: readonly string[]
}

/** UTF-8 byte length of one string.
 * @param text - the string to measure.
 * @returns the UTF-8 byte length.
 */
export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Remove NUL before text enters FTS5.
 * @param text - stored document text or a normalized caller query.
 * @returns text with NUL mapped to the replacement character.
 */
export function sanitizeFtsText(text: string): string {
  return text.replaceAll('\0', '\uFFFD')
}

/**
 * Quote caller text as one FTS5 phrase so query syntax stays inert data.
 * @param query - a whitespace-normalized caller query.
 * @returns an FTS5 expression containing one escaped literal phrase.
 */
export function quoteFtsData(query: string): string {
  return `"${query.replaceAll('"', '""')}"`
}

/**
 * Normalize a caller query into a single inert phrase.
 * @param value - the raw caller query text.
 * @returns an FTS5 match expression.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_INVALID_REQUEST` for blank or NUL-bearing text.
 */
export function normalizeQuery(value: string): string {
  if (typeof value !== 'string') {
    throw new KnowledgeError('knowledge query must be text', 'KNOWLEDGE_INVALID_REQUEST')
  }
  const query = value.trim().replace(/\s+/gu, ' ')
  if (query.length === 0) {
    throw new KnowledgeError('knowledge query must contain non-whitespace text', 'KNOWLEDGE_INVALID_REQUEST')
  }
  if (query.includes('\0')) {
    throw new KnowledgeError('knowledge query must not contain NUL', 'KNOWLEDGE_INVALID_REQUEST')
  }
  return quoteFtsData(sanitizeFtsText(query))
}

/**
 * Normalize a caller tag list to trimmed, de-duplicated, non-empty strings in first-seen order.
 * @param tags - the raw tag array, or `undefined`.
 * @returns a stable tag array (empty when nothing usable was supplied).
 * @throws {@link KnowledgeError} with `KNOWLEDGE_INVALID_REQUEST` when an element is not a string.
 */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return []
  const out: string[] = []
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      throw new KnowledgeError('knowledge tags must all be strings', 'KNOWLEDGE_INVALID_REQUEST')
    }
    const trimmed = tag.trim()
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/**
 * Validate and bound one requested page size against the provider's configured cap.
 * @param value - the raw requested limit, or `undefined` for the provider default.
 * @param defaultLimit - the provider-configured default page size.
 * @param maxLimit - the provider-configured maximum page size.
 * @returns the bounded page size.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_INVALID_REQUEST` for a non-integer or out-of-range value.
 */
export function normalizeLimit(value: number | undefined, defaultLimit: number, maxLimit: number): number {
  const limit = value ?? defaultLimit
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new KnowledgeError(`knowledge limit must be an integer between 1 and ${maxLimit}`, 'KNOWLEDGE_INVALID_REQUEST')
  }
  return limit
}

/**
 * Validate the caller's ingest payload: `title` and `text` must be non-empty within their
 * byte caps and free of NUL, `tags` are normalized, and `source` is trimmed to optional.
 * @param draft - the raw ingest payload.
 * @param limits - the provider-configured title and text byte caps.
 * @returns the normalized payload ready to persist.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_INVALID_REQUEST` for a blank, oversized, or NUL-bearing field.
 */
export function normalizeDraft(
  draft: KnowledgeDraft,
  limits: { maxTitleBytes: number; maxTextBytes: number },
): NormalizedDraft {
  if (typeof draft.title !== 'string' || typeof draft.text !== 'string') {
    throw new KnowledgeError('knowledge title and text must be text', 'KNOWLEDGE_INVALID_REQUEST')
  }
  const title = draft.title.trim().replace(/\s+/gu, ' ')
  const text = draft.text.trim()
  if (title.length === 0) {
    throw new KnowledgeError('knowledge title must contain non-whitespace text', 'KNOWLEDGE_INVALID_REQUEST')
  }
  if (title.includes('\0')) {
    throw new KnowledgeError('knowledge title must not contain NUL', 'KNOWLEDGE_INVALID_REQUEST')
  }
  if (utf8Bytes(title) > limits.maxTitleBytes) {
    throw new KnowledgeError(`knowledge title exceeds the ${limits.maxTitleBytes}-byte cap`, 'KNOWLEDGE_INVALID_REQUEST')
  }
  if (text.length === 0) {
    throw new KnowledgeError('knowledge text must contain non-whitespace text', 'KNOWLEDGE_INVALID_REQUEST')
  }
  if (text.includes('\0')) {
    throw new KnowledgeError('knowledge text must not contain NUL', 'KNOWLEDGE_INVALID_REQUEST')
  }
  if (utf8Bytes(text) > limits.maxTextBytes) {
    throw new KnowledgeError(`knowledge text exceeds the ${limits.maxTextBytes}-byte cap`, 'KNOWLEDGE_INVALID_REQUEST')
  }
  const tags = normalizeTags(draft.tags)
  const rawSource = typeof draft.source === 'string' ? draft.source.trim() : undefined
  const source = rawSource === undefined || rawSource.length === 0 ? undefined : rawSource
  return {
    title,
    text,
    tags,
    ...(source === undefined ? {} : { source }),
  }
}

/**
 * Normalize a caller search request into an inert FTS5 match expression, a bounded page
 * size, and a bounded lexical candidate pool.
 * @param request - the raw search request.
 * @param bounds - the provider-configured default and maximum page sizes.
 * @returns the normalized search ready to execute.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_INVALID_REQUEST` for a malformed query or limit.
 */
export function normalizeSearch(
  request: { query: string; tags?: readonly string[]; limit?: number },
  bounds: { defaultLimit: number; maxLimit: number },
): NormalizedSearch {
  const match = normalizeQuery(request.query)
  const limit = normalizeLimit(request.limit, bounds.defaultLimit, bounds.maxLimit)
  const pool = Math.min(bounds.maxLimit, limit * SEARCH_POOL_FACTOR)
  const tags = normalizeTags(request.tags)
  return {
    match,
    limit,
    pool,
    ...(tags.length === 0 ? {} : { tags }),
  }
}
