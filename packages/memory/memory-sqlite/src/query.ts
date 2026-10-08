/**
 * Query normalization, FTS5 escaping, and lexical/vector fusion for the memory provider.
 * The caller's query and write text are always treated as inert data, never FTS5 syntax, so
 * an unbalanced quote in user input cannot break the match expression. The fusion helpers are
 * pure so the optional vector path (cosine + reciprocal-rank fusion) is unit-testable without
 * any network.
 * @module @deepseek-ai/dsh-memory-sqlite/query
 */

import { MEMORY_NAMESPACES, MemoryError } from '@deepseek-ai/dsh-memory'
import type { MemoryNamespace } from '@deepseek-ai/dsh-memory'

/** Collision-free marker reserved for potential FTS5 highlighting; sanitized on both paths. */
export const FTS_HIGHLIGHT_START = '\uFDD0'
/** Closing counterpart to {@link FTS_HIGHLIGHT_START}. */
export const FTS_HIGHLIGHT_END = '\uFDD1'

/** Constant offset damping reciprocal-rank fusion toward the tail of each ranked list. */
export const RRF_K = 60

/** How many times the requested page size the provider prefilters lexically before fusion. */
export const RECALL_POOL_FACTOR = 4

/** A normalized, ready-to-execute recall. */
export interface NormalizedRecall {
  /** Sanitized single-phrase FTS5 match expression. */
  readonly match: string
  /** Bounded final result count. */
  readonly limit: number
  /** Bounded lexical candidate pool prefetched before optional vector fusion. */
  readonly pool: number
  /** Optional exact scope filter. */
  readonly scope?: string
  /** Optional tag set a candidate must contain to be eligible. */
  readonly tags?: readonly string[]
  /** Optional exact namespace filter. */
  readonly namespace?: MemoryNamespace
  /** Optional lowest recorded confidence a candidate may carry. */
  readonly minConfidence?: number
}

/**
 * Remove reserved marker collisions before text enters FTS5.
 * @param text - stored memory text or a normalized caller query.
 * @returns text with reserved noncharacters and NUL mapped to replacement characters.
 */
export function sanitizeFtsText(text: string): string {
  return text
    .replaceAll('\0', '\uFFFD')
    .replaceAll(FTS_HIGHLIGHT_START, '\uFFFD')
    .replaceAll(FTS_HIGHLIGHT_END, '\uFFFD')
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
 * @throws {@link MemoryError} with `MEMORY_INVALID_REQUEST` for blank or NUL-bearing text.
 */
export function normalizeQuery(value: string): string {
  if (typeof value !== 'string') {
    throw new MemoryError('memory query must be text', 'MEMORY_INVALID_REQUEST')
  }
  const query = value.trim().replace(/\s+/gu, ' ')
  if (query.length === 0) {
    throw new MemoryError('memory query must contain non-whitespace text', 'MEMORY_INVALID_REQUEST')
  }
  if (query.includes('\0')) {
    throw new MemoryError('memory query must not contain NUL', 'MEMORY_INVALID_REQUEST')
  }
  return quoteFtsData(sanitizeFtsText(query))
}

/**
 * Normalize a caller tag list to trimmed, de-duplicated, non-empty strings in first-seen order.
 * @param tags - the raw tag array, or `undefined`.
 * @returns a stable tag array (empty when nothing usable was supplied).
 * @throws {@link MemoryError} with `MEMORY_INVALID_REQUEST` when an element is not a string.
 */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return []
  const out: string[] = []
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      throw new MemoryError('memory tags must all be strings', 'MEMORY_INVALID_REQUEST')
    }
    const trimmed = tag.trim()
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/**
 * Validate one optional namespace against the closed vocabulary.
 * @param value - the raw namespace, or `undefined`.
 * @returns the namespace, or `undefined` when none was supplied.
 * @throws {@link MemoryError} with `MEMORY_INVALID_REQUEST` for an unrecognized value.
 */
export function normalizeNamespace(value: MemoryNamespace | undefined): MemoryNamespace | undefined {
  if (value === undefined) return undefined
  if (!MEMORY_NAMESPACES.includes(value)) {
    throw new MemoryError(`memory namespace must be one of ${MEMORY_NAMESPACES.join(', ')}`, 'MEMORY_INVALID_REQUEST')
  }
  return value
}

/**
 * Validate one optional confidence value or threshold.
 * @param value - the raw confidence, or `undefined`.
 * @param name - field name quoted in the failure message.
 * @returns the confidence, or `undefined` when none was supplied.
 * @throws {@link MemoryError} with `MEMORY_INVALID_REQUEST` outside the closed 0..1 range.
 */
export function normalizeConfidence(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new MemoryError(`${name} must be a number between 0 and 1`, 'MEMORY_INVALID_REQUEST')
  }
  return value
}

/**
 * Validate one optional time-to-live.
 * @param value - the raw TTL in milliseconds, or `undefined`.
 * @returns the TTL, or `undefined` when none was supplied.
 * @throws {@link MemoryError} with `MEMORY_INVALID_REQUEST` for a non-positive or unsafe integer.
 */
export function normalizeTtl(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new MemoryError('memory ttlMs must be a positive integer', 'MEMORY_INVALID_REQUEST')
  }
  return value
}

/** A validated write payload with the provider's normalizations applied. */
export interface NormalizedDraft {
  /** Trimmed, non-empty memory text within the configured byte ceiling. */
  readonly text: string
  /** Normalized tag list (possibly empty). */
  readonly tags: readonly string[]
  /** Optional trimmed scope. */
  readonly scope?: string
  /** Optional validated namespace. */
  readonly namespace?: MemoryNamespace
  /** Optional validated caller confidence. */
  readonly confidence?: number
  /** Optional validated time-to-live the provider turns into an absolute expiry. */
  readonly ttlMs?: number
}

/**
 * Validate and normalize a memory write payload.
 * @param draft - the caller's raw draft.
 * @param maxTextBytes - the UTF-8 byte ceiling for a single memory's text.
 * @returns the normalized text/tags/scope/namespace/confidence/ttl to persist.
 * @throws {@link MemoryError} with `MEMORY_INVALID_REQUEST` for blank, oversized, or malformed input.
 */
export function normalizeDraft(
  draft: { text: string; tags?: readonly string[]; scope?: string; namespace?: MemoryNamespace; confidence?: number; ttlMs?: number },
  maxTextBytes: number,
): NormalizedDraft {
  if (typeof draft.text !== 'string') {
    throw new MemoryError('memory text must be a string', 'MEMORY_INVALID_REQUEST')
  }
  const text = draft.text.trim()
  if (text.length === 0) {
    throw new MemoryError('memory text must contain non-whitespace content', 'MEMORY_INVALID_REQUEST')
  }
  if (Buffer.byteLength(text, 'utf8') > maxTextBytes) {
    throw new MemoryError(`memory text must not exceed ${maxTextBytes} bytes`, 'MEMORY_INVALID_REQUEST')
  }
  const tags = normalizeTags(draft.tags)
  const scope = draft.scope?.trim()
  const namespace = normalizeNamespace(draft.namespace)
  const confidence = normalizeConfidence(draft.confidence, 'memory confidence')
  const ttlMs = normalizeTtl(draft.ttlMs)
  return {
    text,
    tags,
    ...(scope === undefined || scope.length === 0 ? {} : { scope }),
    ...(namespace === undefined ? {} : { namespace }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(ttlMs === undefined ? {} : { ttlMs }),
  }
}

/**
 * Build the parameterized recall and its pool. The pool prefetches extra lexical candidates so
 * tag/scope filtering and vector fusion happen before the final page is cut.
 * @param request - the raw caller recall request.
 * @param limits - configured default and maximum result counts.
 * @returns the match expression, filters, page size, and candidate pool size.
 */
export function normalizeRecall(
  request: { query: string; tags?: readonly string[]; scope?: string; namespace?: MemoryNamespace; minConfidence?: number; limit?: number },
  limits: { defaultLimit: number; maxLimit: number },
): NormalizedRecall {
  const limit = request.limit ?? limits.defaultLimit
  const maxLimit = Math.min(limits.maxLimit, Number.MAX_SAFE_INTEGER - 1)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new MemoryError(`memory limit must be an integer between 1 and ${maxLimit}`, 'MEMORY_INVALID_REQUEST')
  }
  const tags = normalizeTags(request.tags)
  const scope = request.scope?.trim()
  const namespace = normalizeNamespace(request.namespace)
  const minConfidence = normalizeConfidence(request.minConfidence, 'memory minConfidence')
  const pool = Math.min(maxLimit, Math.max(limit, limit * RECALL_POOL_FACTOR))
  return {
    match: normalizeQuery(request.query),
    limit,
    pool,
    ...(scope === undefined || scope.length === 0 ? {} : { scope }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(namespace === undefined ? {} : { namespace }),
    ...(minConfidence === undefined ? {} : { minConfidence }),
  }
}

/**
 * Encode a numeric vector as a little-endian Float32 byte buffer for BLOB storage.
 * @param vector - the embedding components.
 * @returns the packed bytes.
 */
export function encodeVector(vector: readonly number[]): Uint8Array {
  const buffer = new Float32Array(vector)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

/**
 * Decode a Float32 BLOB back into components.
 * @param bytes - the stored embedding blob.
 * @returns the decoded components.
 */
export function decodeVector(bytes: Uint8Array): number[] {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return Array.from(new Float32Array(copy.buffer))
}

/**
 * Cosine similarity between two equal-length vectors; `0` when either is a zero vector.
 * @param a - the first vector.
 * @param b - the second vector.
 * @returns the cosine of the angle between them.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] as number
    const bv = b[i] as number
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Reciprocal-rank-fuse several ranked id lists into one ordering. Each list contributes
 * `1 / (RRF_K + rank)` to an id's fused score; ids in more lists (or ranked higher) win.
 * @param rankings - ordered id lists, best first; empty or single lists pass through their order.
 * @returns a map of id to fused RRF score.
 */
export function reciprocalRankFusion(rankings: readonly (readonly string[])[]): Map<string, number> {
  const scores = new Map<string, number>()
  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank += 1) {
      const id = ranking[rank] as string
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1))
    }
  }
  return scores
}

/**
 * Order ids by descending fused RRF score, breaking ties by first-appearance in `seedOrder`.
 * @param scores - fused scores from {@link reciprocalRankFusion}.
 * @param seedOrder - the lexical candidate order used as a stable tiebreaker.
 * @returns the ids sorted best-first.
 */
export function fuseOrder(scores: ReadonlyMap<string, number>, seedOrder: readonly string[]): string[] {
  return [...scores.keys()].sort((left, right) => {
    /* v8 ignore next -- both compared ids are the map's own keys; defensive. */
    const byScore = (scores.get(right) ?? 0) - (scores.get(left) ?? 0)
    if (byScore !== 0) return byScore
    return seedOrder.indexOf(left) - seedOrder.indexOf(right)
  })
}
