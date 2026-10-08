/**
 * Pure argument validation, result rendering, and UI presentation for the knowledge tools
 * (`knowledge_ingest`, `knowledge_search`, `knowledge_remove`, `knowledge_list`). No I/O —
 * the tool seam performs the ingest, search, removal, and listing; these helpers only shape
 * arguments in and stored documents out, so a UI may reuse them on live calls and on replay.
 * @module @deepseek-ai/dsh-tool-knowledge/render
 */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/** Default cap on the complete rendered tool result, including truncation metadata. */
export const DEFAULT_MAX_RESULT_CHARS = 8_000

/** One serializable search hit as the `knowledge_search` tool renders it (a flattened seam hit). */
export interface KnowledgeHitItem {
  readonly id: string
  readonly title: string
  readonly snippet: string
  readonly tags: string[]
  readonly source?: string
  readonly createdAt: string
  readonly score: number
}

/** One serializable document summary as the `knowledge_list` tool renders it. */
export interface KnowledgeDocItem {
  readonly id: string
  readonly title: string
  readonly tags: string[]
  readonly source?: string
  readonly createdAt: string
}

/** The raw, schema-typed argument shape for `knowledge_ingest`. */
export interface KnowledgeIngestArgs {
  readonly title: string
  readonly text: string
  readonly tags?: readonly string[]
  readonly source?: string
}

/** The raw, schema-typed argument shape for `knowledge_search`. */
export interface KnowledgeSearchArgs {
  readonly query: string
  readonly tags?: readonly string[]
  readonly limit?: number
}

/** The raw, schema-typed argument shape for `knowledge_remove`. */
export interface KnowledgeRemoveArgs {
  readonly id: string
}

/** The raw, schema-typed argument shape for `knowledge_list`. */
export interface KnowledgeListArgs {
  readonly tags?: readonly string[]
  readonly limit?: number
}

/** Trim, de-duplicate, and drop-empty a caller tag list, preserving first-seen order. */
function normalizeTagList(tags: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const tag of tags ?? []) {
    const trimmed = typeof tag === 'string' ? tag.trim() : ''
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/** Validate one optional positive-integer limit. */
function checkedLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer')
  return limit
}

/**
 * Validate the model's raw ingest arguments: `title` collapses to a non-empty single line,
 * `text` must be non-empty after trimming, `tags` are normalized, and `source` is trimmed
 * to optional. Malformed input throws so the tool framework surfaces an actionable argument
 * error rather than a crash.
 * @param args - the schema-validated raw arguments.
 * @returns the draft to forward to the seam.
 * @throws Error when the title or text is blank.
 */
export function parseIngestArgs(args: KnowledgeIngestArgs): {
  title: string
  text: string
  tags?: string[]
  source?: string
} {
  const title = args.title.trim().replace(/\s+/gu, ' ')
  if (title.length === 0) throw new Error('title must be a non-empty string')
  const text = args.text.trim()
  if (text.length === 0) throw new Error('text must be a non-empty string')
  const tags = normalizeTagList(args.tags)
  const source = args.source?.trim()
  return {
    title,
    text,
    ...(tags.length === 0 ? {} : { tags }),
    ...(source === undefined || source.length === 0 ? {} : { source }),
  }
}

/**
 * Validate the model's raw search arguments: `query` must be non-empty after trimming and
 * collapsed to single internal spaces; `tags` are normalized; `limit`, when present, must
 * be a positive integer.
 * @param args - the schema-validated raw arguments.
 * @returns the search request to forward to the seam.
 * @throws Error when the query is blank or the limit is malformed.
 */
export function parseSearchArgs(args: KnowledgeSearchArgs): {
  query: string
  tags?: string[]
  limit?: number
} {
  const query = args.query.trim().replace(/\s+/gu, ' ')
  if (query.length === 0) throw new Error('query must be a non-empty string')
  const tags = normalizeTagList(args.tags)
  return {
    query,
    ...(tags.length === 0 ? {} : { tags }),
    ...(checkedLimit(args.limit) === undefined ? {} : { limit: args.limit as number }),
  }
}

/**
 * Validate the model's raw remove argument: `id` must be non-empty after trimming.
 * @param args - the schema-validated raw arguments.
 * @returns the trimmed document identity to forward to the seam.
 * @throws Error when the id is blank.
 */
export function parseRemoveArgs(args: KnowledgeRemoveArgs): string {
  const id = args.id.trim()
  if (id.length === 0) throw new Error('id must be a non-empty string')
  return id
}

/**
 * Validate the model's raw list arguments: `tags` are normalized and `limit`, when present,
 * must be a positive integer.
 * @param args - the schema-validated raw arguments.
 * @returns the listing request to forward to the seam.
 * @throws Error when the limit is malformed.
 */
export function parseListArgs(args: KnowledgeListArgs): {
  tags?: string[]
  limit?: number
} {
  const tags = normalizeTagList(args.tags)
  return {
    ...(tags.length === 0 ? {} : { tags }),
    ...(checkedLimit(args.limit) === undefined ? {} : { limit: args.limit as number }),
  }
}

/**
 * Render ranked search hits as one line per hit, `[score] id  title — snippet [tags] (source)`,
 * best first as returned by the provider. A distinct no-result line is emitted for an empty
 * page. The complete text is then bounded by `maxResultChars`.
 * @param hits - the tool's flattened search hits (possibly empty).
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered text.
 */
export function formatHits(hits: readonly KnowledgeHitItem[], maxResultChars: number): string {
  if (hits.length === 0) return boundResult('No matching knowledge found.', maxResultChars)
  const lines: string[] = []
  for (const hit of hits) {
    const tags = hit.tags.length === 0 ? '' : ` [${hit.tags.join(', ')}]`
    const source = hit.source === undefined ? '' : ` (${hit.source})`
    const snippet = hit.snippet.length === 0 ? hit.title : `${hit.title} — ${hit.snippet}`
    lines.push(`[${hit.score.toFixed(3)}] ${hit.id}  ${snippet}${tags}${source}`)
  }
  return boundResult(lines.join('\n'), maxResultChars)
}

/**
 * Render listed documents as one line per document, `id  title [tags] (source)`, most recent
 * first as returned by the provider. The complete text is then bounded by `maxResultChars`.
 * @param documents - the tool's flattened document summaries (possibly empty).
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered text.
 */
export function formatDocuments(documents: readonly KnowledgeDocItem[], maxResultChars: number): string {
  if (documents.length === 0) return boundResult('The knowledge base is empty.', maxResultChars)
  const lines = documents.map((document) => {
    const tags = document.tags.length === 0 ? '' : ` [${document.tags.join(', ')}]`
    const source = document.source === undefined ? '' : ` (${document.source})`
    return `${document.id}  ${document.title}${tags}${source}`
  })
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
 * UI presentation for a pending `knowledge_ingest` call. Uses a generic card whose title
 * carries the document title being ingested.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentIngestCall(args: KnowledgeIngestArgs): GenericCallView {
  return { card: 'generic', kind: 'other', title: `Ingest knowledge: ${titleSnippet(args.title, 60)}` }
}

/**
 * UI presentation for a pending `knowledge_search` call. Uses a generic search card titled
 * with the query.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentSearchCall(args: KnowledgeSearchArgs): GenericCallView {
  return { card: 'generic', kind: 'search', title: `Search knowledge: ${args.query}` }
}

/**
 * UI presentation for a pending `knowledge_remove` call. Uses a generic card titled with the id.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentRemoveCall(args: KnowledgeRemoveArgs): GenericCallView {
  return { card: 'generic', kind: 'other', title: `Remove knowledge: ${args.id}` }
}

/**
 * UI presentation for a pending `knowledge_list` call. Uses a generic card titled with the
 * tag filter, when one is supplied.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentListCall(args: KnowledgeListArgs): GenericCallView {
  const tags = args.tags === undefined || args.tags.length === 0 ? '' : `: ${args.tags.join(', ')}`
  return { card: 'generic', kind: 'other', title: `List knowledge${tags}` }
}
