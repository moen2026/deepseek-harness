/**
 * OpenDocument intermediate-format builders for the office-create provider. A creation
 * request is translated into the smallest valid zipped ODF package for the request's
 * family — text (odt), spreadsheet (ods), or presentation (odp) — which the LibreOffice
 * kit then converts to the requested OOXML format. The builders are deterministic:
 * identical requests produce identical bytes, so provider tests can snapshot the XML.
 * @module @deepseek-ai/dsh-office-create/odf
 */

import { strToU8, zipSync } from 'fflate'
import { DocumentsError } from '@deepseek-ai/dsh-documents'
import type { DocumentBlock, DocumentCreateRequest, DocumentFormat } from '@deepseek-ai/dsh-documents'

/** The OpenDocument mimetype for each supported output format's intermediate package. */
const ODF_MIME_TYPES: Record<'odt' | 'ods' | 'odp', string> = {
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
}

/** The intermediate OpenDocument input suffix each output format converts from. */
export const INTERMEDIATE_SUFFIX: Record<DocumentFormat, keyof typeof ODF_MIME_TYPES> = {
  docx: 'odt',
  xlsx: 'ods',
  pptx: 'odp',
}

/** The namespace declarations every generated content.xml carries. */
const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
].join(' ')

/** Escape one XML text node or attribute value.
 * @param value - the raw text to escape.
 * @returns the text with XML-significant characters replaced by entities.
 */
export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Validate one request against the seam's block vocabulary before any XML is built.
 * @param request - the creation request to validate.
 * @throws {@link DocumentsError} with `DOCUMENTS_INVALID_REQUEST` on the first malformed block.
 */
export function validateRequest(request: DocumentCreateRequest): void {
  if (request.title.trim().length === 0) {
    throw new DocumentsError('a document title must be a non-empty string', 'DOCUMENTS_INVALID_REQUEST')
  }
  for (const block of request.blocks) {
    switch (block.kind) {
      case 'heading':
        if (block.text.trim().length === 0) throw new DocumentsError('a heading must have non-empty text', 'DOCUMENTS_INVALID_REQUEST')
        if (block.level !== undefined && (!Number.isInteger(block.level) || block.level < 1 || block.level > 9)) {
          throw new DocumentsError('a heading level must be an integer between 1 and 9', 'DOCUMENTS_INVALID_REQUEST')
        }
        break
      case 'text':
        if (block.text.trim().length === 0) throw new DocumentsError('a text block must have non-empty text', 'DOCUMENTS_INVALID_REQUEST')
        break
      case 'bullets':
        if (block.items.length === 0 || block.items.some(item => item.trim().length === 0)) {
          throw new DocumentsError('a bullets block must have at least one non-empty item', 'DOCUMENTS_INVALID_REQUEST')
        }
        break
      case 'table': {
        const first = block.rows[0]
        if (first === undefined || first.length === 0
          || block.rows.some(row => row.length !== first.length)
          || block.rows.flat().some(cell => cell.trim().length === 0)) {
          throw new DocumentsError('a table block must be a non-empty rectangular grid of non-empty cells', 'DOCUMENTS_INVALID_REQUEST')
        }
        break
      }
      case 'chartPlaceholder':
        if (block.label.trim().length === 0) throw new DocumentsError('a chart placeholder must have a non-empty label', 'DOCUMENTS_INVALID_REQUEST')
        break
    }
  }
}

/** Render one bullet item, table cell, or frame line as a paragraph element. */
function paragraph(content: string): string {
  return `<text:p>${escapeXml(content)}</text:p>`
}

/** Render text-family blocks (odt body). Charts become labeled placeholder paragraphs. */
function renderTextBlocks(blocks: readonly DocumentBlock[]): string {
  let tableIndex = 0
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        parts.push(`<text:h text:outline-level="${block.level ?? 1}">${escapeXml(block.text)}</text:h>`)
        break
      case 'text':
        parts.push(paragraph(block.text))
        break
      case 'bullets':
        parts.push(`<text:list>${block.items.map(item => `<text:list-item>${paragraph(item)}</text:list-item>`).join('')}</text:list>`)
        break
      case 'table': {
        tableIndex += 1
        // validateRequest guarantees a non-empty rectangular grid before rendering.
        const firstRow = block.rows[0] as readonly string[]
        const columns = `<table:table-column table:number-columns-repeated="${firstRow.length}"/>`
        const rows = block.rows
          .map(row => `<table:table-row>${row.map(cell => `<table:table-cell office:value-type="string">${paragraph(cell)}</table:table-cell>`).join('')}</table:table-row>`)
          .join('')
        parts.push(`<table:table table:name="Table${tableIndex}">${columns}${rows}</table:table>`)
        break
      }
      case 'chartPlaceholder':
        parts.push(paragraph(`[Chart: ${block.label}]`))
        break
    }
  }
  return parts.join('')
}

/** Render one spreadsheet cell row; every block lands in row-major string cells. */
function spreadsheetRows(blocks: readonly DocumentBlock[]): string {
  const rows: string[][] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': case 'text':
        rows.push([block.text])
        break
      case 'bullets':
        rows.push(...block.items.map(item => [item]))
        break
      case 'table':
        rows.push(...block.rows.map(row => [...row]))
        break
      case 'chartPlaceholder':
        rows.push([`[Chart: ${block.label}]`])
        break
    }
  }
  return rows
    .map(row => `<table:table-row>${row.map(cell => `<table:table-cell office:value-type="string">${paragraph(cell)}</table:table-cell>`).join('')}</table:table-row>`)
    .join('')
}

/** Plain paragraph text of one block as it appears inside a presentation frame. */
function frameLines(block: Exclude<DocumentBlock, { kind: 'heading' }>): string[] {
  switch (block.kind) {
    case 'text': return [block.text]
    case 'bullets': return block.items.map(item => `• ${item}`)
    case 'table': return block.rows.map(row => row.join(' | '))
    case 'chartPlaceholder': return [`[Chart: ${block.label}]`]
  }
}

/** Render presentation-family slides: the title slide, then one slide per heading group. */
function renderSlides(title: string, blocks: readonly DocumentBlock[]): string {
  const frame = (x: string, y: string, width: string, height: string, class_: string, lines: readonly string[]): string =>
    `<draw:frame svg:x="${x}" svg:y="${y}" svg:width="${width}" svg:height="${height}" presentation:class="${class_}">`
    + `<draw:text-box>${lines.map(paragraph).join('')}</draw:text-box></draw:frame>`
  const groups: { heading?: string; lines: string[] }[] = []
  for (const block of blocks) {
    if (block.kind === 'heading') groups.push({ heading: block.text, lines: [] })
    else {
      const lines = frameLines(block)
      const current = groups.at(-1)
      if (current === undefined) groups.push({ lines })
      else current.lines.push(...lines)
    }
  }
  const pages = [frame('2cm', '2cm', '22cm', '3cm', 'title', [title])]
  for (const group of groups) {
    // Every group carries at least one line: non-heading blocks push their frame lines
    // on creation, and a heading group repeats the heading itself.
    const lines = group.heading === undefined ? group.lines : [group.heading, ...group.lines]
    pages.push(frame('2cm', '2cm', '22cm', '12cm', 'outline', lines))
  }
  return pages
    .map((body, index) => `<draw:page draw:name="page${index + 1}">${body}</draw:page>`)
    .join('')
}

/**
 * Make the title visible in the document body: a leading heading for text and
 * spreadsheet families (the presentation carries it on the title slide). Skipped when
 * the caller's own first block is already that heading.
 */
function titledBlocks(request: DocumentCreateRequest): readonly DocumentBlock[] {
  const first = request.blocks[0]
  if (first?.kind === 'heading' && first.text === request.title) return request.blocks
  return [{ kind: 'heading', text: request.title }, ...request.blocks]
}

/** Build the complete zipped OpenDocument intermediate package for one request.
 * @param request - the creation request to render and package.
 * @returns the zipped ODF package bytes, deterministic for identical requests.
 * @throws {@link DocumentsError} with `DOCUMENTS_INVALID_REQUEST` when the request is malformed.
 */
export function buildOdfPackage(request: DocumentCreateRequest): Uint8Array {
  validateRequest(request)
  const suffix = INTERMEDIATE_SUFFIX[request.format]
  const body = suffix === 'odt'
    ? `<office:text>${renderTextBlocks(titledBlocks(request))}</office:text>`
    : suffix === 'ods'
      ? `<office:spreadsheet><table:table table:name="Sheet1">${spreadsheetRows(titledBlocks(request))}</table:table></office:spreadsheet>`
      : `<office:presentation>${renderSlides(request.title, request.blocks)}</office:presentation>`
  const content = '<?xml version="1.0" encoding="UTF-8"?>'
    + `<office:document-content ${NS} office:version="1.2"><office:body>${body}</office:body></office:document-content>`
  const manifest = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
    + `<manifest:file-entry manifest:full-path="/" manifest:media-type="${ODF_MIME_TYPES[suffix]}"/>`
    + '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
    + '</manifest:manifest>'
  // The ODF spec requires the mimetype entry first and uncompressed (stored).
  return zipSync({
    mimetype: [strToU8(ODF_MIME_TYPES[suffix]), { level: 0 }],
    'META-INF/manifest.xml': strToU8(manifest),
    'content.xml': strToU8(content),
  })
}
