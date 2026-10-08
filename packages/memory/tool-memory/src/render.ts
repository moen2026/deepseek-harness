/**
 * Pure argument validation, result rendering, and UI presentation for the memory tools
 * (`memory_write`, `memory_search`, `memory_forget`). No I/O — the tool seam performs the
 * write, recall, and deletion; these helpers only shape arguments in and stored records out,
 * so a UI may reuse them on live calls and on replay.
 * @module @deepseek-ai/dsh-tool-memory/render
 */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { MEMORY_NAMESPACES, type MemoryNamespace } from '@deepseek-ai/dsh-memory'

/** Default cap on the complete rendered tool result, including truncation metadata. */
export const DEFAULT_MAX_RESULT_CHARS = 8_000

/** One serializable recall hit as the `memory_search` tool renders it (a flattened seam hit). */
export interface MemoryHitItem {
  readonly id: string
  readonly text: string
  readonly tags: string[]
  readonly scope?: string
  readonly namespace?: MemoryNamespace
  readonly confidence?: number
  readonly createdAt: string
  readonly expiresAt?: string
  readonly score: number
}

/** The raw, schema-typed argument shape for `memory_write`. */
export interface MemoryWriteArgs {
  readonly text: string
  readonly tags?: readonly string[]
  readonly scope?: string
  readonly namespace?: MemoryNamespace
  readonly confidence?: number
  readonly ttl_ms?: number
}

/** The raw, schema-typed argument shape for `memory_search`. */
export interface MemorySearchArgs {
  readonly query: string
  readonly tags?: readonly string[]
  readonly scope?: string
  readonly namespace?: MemoryNamespace
  readonly min_confidence?: number
  readonly limit?: number
}

/** The raw, schema-typed argument shape for `memory_forget`. */
export interface MemoryForgetArgs {
  readonly id: string
}

/** Trim, de-duplicate, and drop-empty a caller tag list, preserving first-seen order. */
function normalizeTagList(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return []
  const out: string[] = []
  for (const tag of tags) {
    const trimmed = typeof tag === 'string' ? tag.trim() : ''
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/** Trimmed scope or `undefined` when blank. */
function optionalScope(scope: string | undefined): string | undefined {
  const trimmed = scope?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

/** Validate one optional namespace against the closed vocabulary. */
function checkedNamespace(namespace: MemoryNamespace | undefined): MemoryNamespace | undefined {
  if (namespace === undefined) return undefined
  if (!MEMORY_NAMESPACES.includes(namespace)) {
    throw new Error(`namespace must be one of ${MEMORY_NAMESPACES.join(', ')}`)
  }
  return namespace
}

/** Validate one optional confidence value or threshold. */
function checkedConfidence(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1`)
  }
  return value
}

/** Validate one optional TTL. */
function checkedTtl(ttlMs: number | undefined): number | undefined {
  if (ttlMs === undefined) return undefined
  if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new Error('ttl_ms must be a positive integer')
  return ttlMs
}

/**
 * Validate the model's raw write arguments: `text` must be non-empty after trimming, `tags`
 * are normalized, `scope` is trimmed to optional, `namespace`/`confidence`/`ttl_ms` are
 * validated when present. Malformed input throws so the tool framework surfaces an
 * actionable argument error rather than a crash.
 * @param args - the schema-validated raw arguments.
 * @returns the draft to forward to the seam.
 * @throws Error when the text is blank or a supplied refinement is malformed.
 */
export function parseWriteArgs(args: MemoryWriteArgs): {
  text: string
  tags?: string[]
  scope?: string
  namespace?: MemoryNamespace
  confidence?: number
  ttlMs?: number
} {
  const text = args.text.trim()
  if (text.length === 0) throw new Error('text must be a non-empty string')
  const tags = normalizeTagList(args.tags)
  const scope = optionalScope(args.scope)
  const namespace = checkedNamespace(args.namespace)
  const confidence = checkedConfidence(args.confidence, 'confidence')
  const ttlMs = checkedTtl(args.ttl_ms)
  return {
    text,
    ...(tags.length === 0 ? {} : { tags }),
    ...(scope === undefined ? {} : { scope }),
    ...(namespace === undefined ? {} : { namespace }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(ttlMs === undefined ? {} : { ttlMs }),
  }
}

/**
 * Validate the model's raw search arguments: `query` must be non-empty after trimming and is
 * collapsed to single internal spaces; `tags` are normalized; `scope` is trimmed to optional;
 * `namespace`/`min_confidence` are validated when present; `limit`, when present, must be a
 * positive integer.
 * @param args - the schema-validated raw arguments.
 * @returns the recall request to forward to the seam.
 * @throws Error when the query is blank or a supplied refinement is malformed.
 */
export function parseSearchArgs(args: MemorySearchArgs): {
  query: string
  tags?: string[]
  scope?: string
  namespace?: MemoryNamespace
  minConfidence?: number
  limit?: number
} {
  const query = args.query.trim().replace(/\s+/gu, ' ')
  if (query.length === 0) throw new Error('query must be a non-empty string')
  const limit = args.limit
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('limit must be a positive integer')
  }
  const tags = normalizeTagList(args.tags)
  const scope = optionalScope(args.scope)
  const namespace = checkedNamespace(args.namespace)
  const minConfidence = checkedConfidence(args.min_confidence, 'min_confidence')
  return {
    query,
    ...(tags.length === 0 ? {} : { tags }),
    ...(scope === undefined ? {} : { scope }),
    ...(namespace === undefined ? {} : { namespace }),
    ...(minConfidence === undefined ? {} : { minConfidence }),
    ...(limit === undefined ? {} : { limit }),
  }
}

/**
 * Validate the model's raw forget argument: `id` must be non-empty after trimming.
 * @param args - the schema-validated raw arguments.
 * @returns the trimmed record identity to forward to the seam.
 * @throws Error when the id is blank.
 */
export function parseForgetArgs(args: MemoryForgetArgs): string {
  const id = args.id.trim()
  if (id.length === 0) throw new Error('id must be a non-empty string')
  return id
}

/**
 * Render ranked recall hits as one line per hit, `[score] id  text [tags] (scope) namespace=x conf=y`,
 * best first as returned by the provider. A distinct no-result line is emitted for an empty page.
 * The complete text is then bounded by `maxResultChars`.
 * @param hits - the tool's flattened recall hits (possibly empty).
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered text.
 */
export function formatHits(hits: readonly MemoryHitItem[], maxResultChars: number): string {
  if (hits.length === 0) return boundResult('No matching memories found.', maxResultChars)
  const lines: string[] = []
  for (const hit of hits) {
    const tags = hit.tags.length === 0 ? '' : ` [${hit.tags.join(', ')}]`
    const scope = hit.scope === undefined ? '' : ` (${hit.scope})`
    const namespace = hit.namespace === undefined ? '' : ` namespace=${hit.namespace}`
    const confidence = hit.confidence === undefined ? '' : ` conf=${hit.confidence}`
    lines.push(`[${hit.score.toFixed(3)}] ${hit.id}  ${hit.text}${tags}${scope}${namespace}${confidence}`)
  }
  return boundResult(lines.join('\n'), maxResultChars)
}

/** Bound a complete rendered result, including the truncation notice itself. */
function boundResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const notice = `\n… results truncated (limit ${maxChars} characters).`
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  return `${text.slice(0, maxChars - notice.length)}${notice}`
}

/** Shorten text to a single bounded line for a card title. */
function titleSnippet(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  if (flat.length <= maxChars) return flat
  return `${flat.slice(0, maxChars - 1)}…`
}

/**
 * UI presentation for a pending `memory_write` call. Uses a generic card whose title carries a
 * short excerpt of the text being remembered.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentWriteCall(args: MemoryWriteArgs): GenericCallView {
  return { card: 'generic', kind: 'other', title: `Remember: ${titleSnippet(args.text, 60)}` }
}

/**
 * UI presentation for a pending `memory_search` call. Uses a generic search card titled with
 * the query.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentSearchCall(args: MemorySearchArgs): GenericCallView {
  return { card: 'generic', kind: 'search', title: `Search memory: ${args.query}` }
}

/**
 * UI presentation for a pending `memory_forget` call. Uses a generic card titled with the id.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentForgetCall(args: MemoryForgetArgs): GenericCallView {
  return { card: 'generic', kind: 'other', title: `Forget memory: ${args.id}` }
}
