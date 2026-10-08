/**
 * Query normalization, FTS5 escaping, and result rendering for the code-index provider.
 * The caller's query text is always treated as an inert literal phrase, never FTS5 syntax,
 * so an unbalanced quote in user input cannot break the match expression.
 * @module @deepseek-ai/dsh-code-index-sqlite/query
 */

import { CodeIndexError } from '@deepseek-ai/dsh-code-index'

/** Collision-free marker inserted before an FTS5 match by `highlight()`. */
export const FTS_HIGHLIGHT_START = '\uFDD0'
/** Collision-free marker inserted after an FTS5 match by `highlight()`. */
export const FTS_HIGHLIGHT_END = '\uFDD1'

/** A normalized, ready-to-bind code-search request. */
export interface NormalizedSearch {
  /** Sanitized single-phrase FTS5 match expression. */
  readonly match: string
  /** Optional translated `LIKE` pattern over the indexed path, or `undefined`. */
  readonly pathLike?: string
  /** Optional exact language id filter. */
  readonly language?: string
  /** Bounded result count. */
  readonly limit: number
}

/**
 * Remove reserved marker collisions before text enters FTS5 or a snippet.
 * @param text - indexed document text or a normalized caller query.
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
 * @throws {@link CodeIndexError} with `CODE_INDEX_INVALID_REQUEST` for blank or NUL-bearing text.
 */
export function normalizeQuery(value: string): string {
  if (typeof value !== 'string') {
    throw new CodeIndexError('code-index query must be text', 'CODE_INDEX_INVALID_REQUEST')
  }
  const query = value.trim().replace(/\s+/gu, ' ')
  if (query.length === 0) {
    throw new CodeIndexError('code-index query must contain non-whitespace text', 'CODE_INDEX_INVALID_REQUEST')
  }
  if (query.includes('\0')) {
    throw new CodeIndexError('code-index query must not contain NUL', 'CODE_INDEX_INVALID_REQUEST')
  }
  return quoteFtsData(sanitizeFtsText(query))
}

/**
 * Translate a `*`/`?` glob into a SQLite `LIKE` pattern over `/`-normalized paths.
 * `**` collapses to `%`, `*` becomes a segment-free `%` that still cannot cross `/`
 * only when the caller used a bare `*`; both map to `%` here because indexed paths are
 * compared as whole strings, so the filter narrows by prefix/suffix rather than by tree
 * depth. Returns `undefined` for an absent glob, and the raw pattern (with `_` and `%`
 * escaped) when it contains no glob metacharacters (an exact path).
 * @param glob - the caller glob, or `undefined`.
 * @returns a `LIKE` pattern and its escape character, or `undefined`.
 */
export function globToLike(glob: string | undefined): string | undefined {
  if (glob === undefined) return undefined
  const trimmed = glob.trim()
  if (trimmed.length === 0) return undefined
  let out = ''
  for (const ch of trimmed) {
    if (ch === '*') out += '%'
    else if (ch === '?') out += '_'
    else if (ch === '\\' || ch === '/') out += '/'
    else if (ch === '%' || ch === '_') out += `\\${ch}`
    else out += ch
  }
  return out
}

/**
 * Build the parameterized search statement and its bindings.
 * @param request - the raw caller request.
 * @param limits - configured default and maximum result counts.
 * @returns the match expression plus optional path/language predicates and limit.
 */
export function normalizeSearch(
  request: { query: string; glob?: string; language?: string; limit?: number },
  limits: { defaultLimit: number; maxLimit: number },
): NormalizedSearch {
  const limit = request.limit ?? limits.defaultLimit
  const maxLimit = Math.min(limits.maxLimit, Number.MAX_SAFE_INTEGER - 1)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new CodeIndexError(`code-index limit must be an integer between 1 and ${maxLimit}`, 'CODE_INDEX_INVALID_REQUEST')
  }
  const language = request.language?.trim()
  const pathLike = globToLike(request.glob)
  return {
    match: normalizeQuery(request.query),
    ...(pathLike === undefined ? {} : { pathLike }),
    ...(language === undefined || language.length === 0 ? {} : { language }),
    limit,
  }
}

/**
 * Strip FTS5 highlight markers and bound a snippet to `maxChars` code points.
 * @param markedText - snippet text with the provider's start/end markers.
 * @param maxChars - maximum snippet length in Unicode code points.
 * @returns a single-line, marker-free, bounded excerpt.
 */
export function makeSnippet(markedText: string, maxChars: number): string {
  const characters: string[] = []
  for (const character of markedText) {
    if (character === FTS_HIGHLIGHT_START || character === FTS_HIGHLIGHT_END) continue
    if (/\s/u.test(character)) {
      if (characters.length > 0 && characters.at(-1) !== ' ') characters.push(' ')
    } else {
      characters.push(character)
    }
  }
  if (characters.at(-1) === ' ') characters.pop()
  if (characters.length <= maxChars) return characters.join('')
  if (maxChars <= 1) return '…'
  return `${characters.slice(0, maxChars - 1).join('')}…`
}
