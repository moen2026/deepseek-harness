/**
 * Pure helpers for the repo-wiki generator: page naming, front-matter
 * (de)serialization, source fingerprints, prompt construction, model-output
 * extraction, and outline/title derivation. Everything here is deterministic
 * and unit-tested without I/O or LLM involvement.
 * @module @deepseek-ai/dsh-repo-wiki-generator/pages
 */

/** Front-matter key recording which workspace source a page was generated from. */
export const FRONT_MATTER_SOURCE_KEY = 'dsh-wiki-source'

/** Front-matter key recording the generation-time source fingerprint. */
export const FRONT_MATTER_FINGERPRINT_KEY = 'dsh-wiki-fingerprint'

/** The system prompt framing one wiki page generation call. */
export const WIKI_GENERATOR_SYSTEM =
  'You maintain a repository wiki. Given one workspace source document, write a concise standalone Markdown wiki page for it: open with the page title as a level-1 heading, summarize the document\'s purpose and structure in a few short sections, and preserve concrete facts (names, paths, defaults, commands). Do not invent facts that are not in the source. Output Markdown only.'

/** Collapse a workspace-relative source path into one flat wiki page name.
 * @param sourceRel - the workspace-relative source path.
 * @returns the flattened `<name>.md` page name.
 */
export function pageNameFor(sourceRel: string): string {
  const flattened = sourceRel.trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/\//g, '-')
  const safe = flattened.replace(/^-+|-+$/g, '')
  if (safe === '') throw new Error(`repo-wiki-generator: source path ${JSON.stringify(sourceRel)} has no usable page name`)
  return `${safe}.md`
}

/** Derive a page title from its first level-1 heading, falling back to a fixed label.
 * @param content - the full page content.
 * @returns the title text, or the fallback label when no level-1 heading exists.
 */
export function headingTitle(content: string): string {
  const line = content.split('\n').find(candidate => candidate.startsWith('# '))
  if (line === undefined) return '(untitled wiki page)'
  return line.slice(2).trim() || '(untitled wiki page)'
}

/** Collect every Markdown heading line, in document order.
 * @param content - the full page content.
 * @returns the heading lines, in document order.
 */
export function outlineHeadings(content: string): string[] {
  return content.split('\n').filter(line => line.startsWith('#'))
}

/** A source fingerprint that changes whenever the file's size or mtime changes.
 * @param stats - the source file's `size` and `mtimeMs` as reported by `stat`.
 * @returns the opaque fingerprint string recorded in the page's front matter.
 */
export function sourceFingerprint(stats: { size: number; mtimeMs: number }): string {
  return `${stats.size}:${Math.round(stats.mtimeMs)}`
}

/** Whether a page's generation-time fingerprint no longer matches its source.
 * @param pageFingerprint - the fingerprint recorded at generation time, if any.
 * @param currentFingerprint - the source's current fingerprint.
 * @returns whether the page should be presented as stale.
 */
export function isStale(pageFingerprint: string | undefined, currentFingerprint: string): boolean {
  return pageFingerprint !== currentFingerprint
}

/**
 * Serialize a page's front matter and body. The front matter carries the
 * generation-time source path and fingerprint so reads can compute staleness
 * without any side table.
 * @param sourceRel - the workspace-relative source path the page was generated from.
 * @param fingerprint - the generation-time source fingerprint.
 * @param body - the generated page body.
 * @returns the full page text, front matter included.
 */
export function serializePage(sourceRel: string, fingerprint: string, body: string): string {
  return [
    '---',
    `${FRONT_MATTER_SOURCE_KEY}: ${sourceRel}`,
    `${FRONT_MATTER_FINGERPRINT_KEY}: ${JSON.stringify(fingerprint)}`,
    '---',
    '',
    body.trimEnd(),
    '',
  ].join('\n')
}

/** A page's parsed front matter and body. */
export interface ParsedPage {
  /** The recorded source path, when present and well-formed. */
  readonly source: string | undefined
  /** The recorded generation-time fingerprint, when present and well-formed. */
  readonly fingerprint: string | undefined
  /** Everything after the front-matter block. */
  readonly body: string
}

/**
 * Parse a page's front matter. A missing or malformed block yields undefined
 * metadata with the full content as the body, so hand-written pages still read.
 * @param content - the full page text read from the wiki directory.
 * @returns the parsed front matter and body.
 */
export function parsePage(content: string): ParsedPage {
  if (!content.startsWith('---\n')) return { source: undefined, fingerprint: undefined, body: content }
  const end = content.indexOf('\n---\n', 4)
  if (end < 0) return { source: undefined, fingerprint: undefined, body: content }
  const header = content.slice(4, end)
  const raw = content.slice(end + 5)
  const body = raw.replace(/^\n/, '').replace(/\n$/, '')
  let source: string | undefined
  let fingerprint: string | undefined
  for (const line of header.split('\n')) {
    if (line.startsWith(`${FRONT_MATTER_SOURCE_KEY}: `)) source = line.slice(FRONT_MATTER_SOURCE_KEY.length + 2).trim()
    if (line.startsWith(`${FRONT_MATTER_FINGERPRINT_KEY}: `)) {
      try {
        const value: unknown = JSON.parse(line.slice(FRONT_MATTER_FINGERPRINT_KEY.length + 2).trim())
        if (typeof value === 'string') fingerprint = value
      } catch {
        // A malformed fingerprint simply reads as stale.
      }
    }
  }
  return { source, fingerprint, body }
}

/**
 * Frame one wiki generation call: a truncated source excerpt plus the
 * instruction to write the page.
 * @param sourceRel - the workspace-relative source path.
 * @param sourceContent - the source document's full text.
 * @param maxSourceChars - the excerpt bound applied to `sourceContent`.
 * @returns the system prompt and user text for the generation call.
 */
export function buildGenerationRequest(sourceRel: string, sourceContent: string, maxSourceChars: number): { system: string; text: string } {
  const excerpt = sourceContent.length > maxSourceChars
    ? `${sourceContent.slice(0, maxSourceChars)}\n\n[... truncated, ${sourceContent.length - maxSourceChars} more characters]`
    : sourceContent
  return {
    system: WIKI_GENERATOR_SYSTEM,
    text: `Source document: \`${sourceRel}\`\n\n${excerpt}\n\nWrite the wiki page for this source document.`,
  }
}

/** Concatenate a model response's text blocks into the page body.
 * @param blocks - the model response's content blocks.
 * @returns the concatenated text of all text blocks.
 */
export function extractText(blocks: readonly { type: string; text?: string }[]): string {
  const text = blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('')
  if (text.trim() === '') throw new Error('repo-wiki-generator: the model returned no text content for the wiki page')
  return text
}
