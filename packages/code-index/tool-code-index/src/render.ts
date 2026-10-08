/**
 * Pure argument validation, result rendering, and UI presentation for the
 * `search_codebase` tool. No I/O — the tool seam performs the query; these helpers
 * only shape arguments in and ranked hits out, so a UI may reuse them on live calls
 * and on replay.
 * @module @deepseek-ai/dsh-tool-code-index/render
 */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { CodeSearchHit } from '@deepseek-ai/dsh-code-index'

/** Default cap on the complete rendered tool result, including truncation metadata. */
export const DEFAULT_MAX_RESULT_CHARS = 16_000

/** The raw, schema-typed argument shape for `search_codebase`. */
export interface SearchCodebaseArgs {
  readonly query: string
  readonly glob?: string
  readonly language?: string
  readonly limit?: number
}

/** Validated `search_codebase` arguments after whitespace and range checks. */
export interface SearchCodebaseInput {
  readonly query: string
  readonly glob?: string
  readonly language?: string
  readonly limit?: number
}

/**
 * Validate the model's raw arguments: `query` must be non-empty after trimming and is
 * collapsed to single internal spaces; `glob`/`language` are trimmed to optional;
 * `limit`, when present, must be a positive integer. Malformed input throws so the tool
 * framework surfaces an actionable argument error rather than a crash.
 * @param args - the schema-validated raw arguments.
 * @returns the normalized request fields to forward to the seam.
 * @throws Error when the query is blank or a supplied limit is not a positive integer.
 */
export function parseSearchArgs(args: SearchCodebaseArgs): SearchCodebaseInput {
  const query = args.query.trim().replace(/\s+/gu, ' ')
  if (query.length === 0) throw new Error('query must be a non-empty string')
  const glob = args.glob?.trim()
  const language = args.language?.trim()
  const limit = args.limit
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('limit must be a positive integer')
  }
  return {
    query,
    ...(glob === undefined || glob.length === 0 ? {} : { glob }),
    ...(language === undefined || language.length === 0 ? {} : { language }),
    ...(limit === undefined ? {} : { limit }),
  }
}

/**
 * Render ranked hits as one line per hit, `path:startLine-endLine [language]  snippet`,
 * best-score first as returned by the provider. A distinct no-result line is emitted
 * for an empty page. The complete text is then bounded by `maxResultChars`.
 * @param hits - the seam's ranked hits (possibly empty).
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered text.
 */
export function formatHits(hits: readonly CodeSearchHit[], maxResultChars: number): string {
  if (hits.length === 0) return boundResult('No matching code found.', maxResultChars)
  const lines: string[] = []
  for (const hit of hits) {
    const range = hit.startLine === hit.endLine ? `${hit.startLine}` : `${hit.startLine}-${hit.endLine}`
    const language = hit.language === undefined ? '' : ` [${hit.language}]`
    lines.push(`${hit.path}:${range}${language}  ${hit.snippet}`)
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

/**
 * UI presentation for a pending `search_codebase` call. Uses a generic search card whose
 * title carries the query; there is no single target file, so no locations are attached.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentSearchCall(args: SearchCodebaseArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'search',
    title: `Search codebase: ${args.query}`,
  }
}
