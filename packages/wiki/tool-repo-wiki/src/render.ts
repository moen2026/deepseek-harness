/**
 * Pure argument validation, result rendering, and UI presentation for the
 * `read_wiki` tool. No I/O — the tool seam performs the read; these helpers only
 * shape arguments in and pages out, so a UI may reuse them on live calls and on
 * replay.
 * @module @deepseek-ai/dsh-tool-repo-wiki/render
 */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { WikiListing, WikiOutlineEntry, WikiPage } from '@deepseek-ai/dsh-repo-wiki'

/** Default cap on the complete rendered tool result, including truncation metadata. */
export const DEFAULT_MAX_RESULT_CHARS = 16_000

/** Actionable answer rendered when no repo-wiki provider holds the seam. */
export const UNAVAILABLE_TEXT =
  'Repo wiki is not available: no provider is configured. Configure a repo-wiki generator (e.g. set its storage directory and LLM route) or use search_codebase/grep/read to work from the repository directly.'

/** The raw, schema-typed argument shape for `read_wiki`. */
export interface ReadWikiArgs {
  readonly path?: string
  readonly outline?: boolean
}

/** Validated `read_wiki` arguments after whitespace and mode checks. */
export interface ReadWikiInput {
  readonly path?: string
  readonly outline?: boolean
}

/**
 * Validate the model's raw arguments: `path`, when present, must be a non-empty
 * `.md` path after trimming; `outline` must be a boolean when present. Omitting
 * `path` selects the listing mode. Malformed input throws so the tool framework
 * surfaces an actionable argument error rather than a crash.
 * @param args - the schema-validated raw arguments.
 * @returns the normalized request fields to forward to the seam.
 * @throws Error when `path` is blank or not `.md`, or `outline` is not a boolean.
 */
export function parseReadWikiArgs(args: ReadWikiArgs): ReadWikiInput {
  const path = args.path?.trim()
  const outline = args.outline
  if (outline !== undefined && typeof outline !== 'boolean') {
    throw new Error('outline must be a boolean when present')
  }
  if (path === undefined || path.length === 0) {
    if (outline === true) throw new Error('outline requires a wiki page path')
    return {}
  }
  if (!path.endsWith('.md')) throw new Error('path must name a wiki page ending in .md')
  return { path, ...(outline === undefined ? {} : { outline }) }
}

/**
 * Render one page's body, prefixed by a staleness notice when the page's sources
 * have changed since generation. The complete text is bounded by `maxResultChars`.
 * @param page - the page read from the seam.
 * @param maxResultChars - the bound on the complete rendered result.
 * @returns the rendered page text, truncation notice included.
 */
export function formatPage(page: WikiPage, maxResultChars: number): string {
  const notice = page.stale ? '[stale: the sources behind this page changed after it was generated]\n\n' : ''
  return boundResult(`${notice}${page.content}`, maxResultChars)
}

/** Render the page listing as one `path — title [stale]` line per page.
 * @param listing - the listing read from the seam.
 * @param maxResultChars - the bound on the complete rendered result.
 * @returns the rendered listing text, truncation notice included.
 */
export function formatListing(listing: WikiListing, maxResultChars: number): string {
  if (listing.pages.length === 0) return boundResult('The wiki has no pages yet.', maxResultChars)
  const lines = listing.pages.map(page => `${page.path} — ${page.title}${page.stale ? ' [stale]' : ''}`)
  return boundResult(lines.join('\n'), maxResultChars)
}

/** Render the outline as one line per page followed by its indented headings.
 * @param entries - the outline entries read from the seam.
 * @param maxResultChars - the bound on the complete rendered result.
 * @returns the rendered outline text, truncation notice included.
 */
export function formatOutline(entries: readonly WikiOutlineEntry[], maxResultChars: number): string {
  if (entries.length === 0) return boundResult('The wiki has no pages yet.', maxResultChars)
  const lines: string[] = []
  for (const entry of entries) {
    lines.push(`${entry.path} — ${entry.title}${entry.stale ? ' [stale]' : ''}`)
    for (const heading of entry.headings) lines.push(`  ${heading}`)
  }
  return boundResult(lines.join('\n'), maxResultChars)
}

/** Bound a complete rendered result, including the truncation notice itself.
 * @param text - the complete rendered text.
 * @param maxChars - the bound on the result.
 * @returns the text, ellipsized with a truncation notice when it exceeds the bound.
 */
export function boundResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const notice = `\n… result truncated (limit ${maxChars} characters).`
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  return `${text.slice(0, maxChars - notice.length)}${notice}`
}

/** The execute-branch output shape fed back through the renderers. */
export interface ReadWikiResult {
  readonly status: 'ok' | 'unavailable'
  readonly path?: string
  readonly title?: string
  readonly stale?: boolean
  readonly content?: string
  readonly pages?: readonly { path: string; title: string; stale: boolean; headings?: readonly string[] }[]
}

/** Render one tool output value, dispatching on which fields the execute branch filled.
 * @param value - the execute branch's output.
 * @param maxResultChars - the bound on the complete rendered result.
 * @returns the rendered text, or {@link UNAVAILABLE_TEXT} when no provider holds the seam.
 */
export function renderValue(value: ReadWikiResult, maxResultChars: number): string {
  if (value.status === 'unavailable') return UNAVAILABLE_TEXT
  if (value.content !== undefined && value.path !== undefined) {
    return formatPage({ path: value.path, title: value.title ?? '(untitled wiki page)', stale: value.stale ?? false, content: value.content }, maxResultChars)
  }
  return formatOutlineOrListing(value.pages ?? [], maxResultChars)
}

/** A listing entry with headings renders as outline; without, as the page list.
 * @param pages - the execute branch's page entries.
 * @param maxResultChars - the bound on the complete rendered result.
 * @returns the rendered outline or listing text, truncation notice included.
 */
export function formatOutlineOrListing(
  pages: readonly { path: string; title: string; stale: boolean; headings?: readonly string[] }[],
  maxResultChars: number,
): string {
  const hasHeadings = pages.some(page => page.headings !== undefined)
  if (hasHeadings) {
    return formatOutline(
      pages.map(page => ({ path: page.path, title: page.title, stale: page.stale, headings: page.headings ?? [] })),
      maxResultChars,
    )
  }
  return formatListing({ pages }, maxResultChars)
}

/**
 * UI presentation for a pending `read_wiki` call. A path names the page being
 * read; the listing mode reads the whole wiki.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentReadWikiCall(args: ReadWikiArgs): GenericCallView {
  const path = args.path?.trim()
  return {
    card: 'generic',
    kind: 'search',
    title: path === undefined || path.length === 0 ? 'Read wiki: list pages' : `Read wiki: ${path}`,
  }
}
