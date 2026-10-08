/**
 * Model-facing presentation for `create_document`: argument normalization, the created
 * document envelope, and the call presentation shared by the tool and its tests.
 * @module @deepseek-ai/dsh-tool-document/render
 */

import { DocumentsError } from '@deepseek-ai/dsh-documents'
import type { DocumentBlock, DocumentFormat } from '@deepseek-ai/dsh-documents'

/** The Office formats `create_document` accepts. */
export const DOCUMENT_FORMATS: readonly DocumentFormat[] = ['docx', 'xlsx', 'pptx']

/** Normalized `create_document` arguments. */
export interface CreateDocumentArgs {
  /** The target Office format. */
  readonly format: DocumentFormat
  /** The document title. */
  readonly title: string
  /** The workspace path to write the document to. */
  readonly filePath: string
  /** The content blocks, in document order. */
  readonly blocks: readonly DocumentBlock[]
}

/**
 * Translate one raw block object into the seam's block vocabulary, or throw an
 * actionable error naming the offending field.
 */
function parseBlock(raw: unknown, index: number): DocumentBlock {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`create_document: blocks[${index}] must be an object`)
  }
  const block = raw as { kind?: unknown; text?: unknown; level?: unknown; items?: unknown; rows?: unknown; label?: unknown }
  switch (block.kind) {
    case 'heading': {
      if (typeof block.text !== 'string' || block.text.trim() === '') {
        throw new Error(`create_document: blocks[${index}] heading requires non-empty text`)
      }
      if (block.level !== undefined && (!Number.isInteger(block.level) || (block.level as number) < 1 || (block.level as number) > 9)) {
        throw new Error(`create_document: blocks[${index}] heading level must be an integer between 1 and 9`)
      }
      return { kind: 'heading', text: block.text, ...block.level === undefined ? {} : { level: block.level as number } }
    }
    case 'text':
      if (typeof block.text !== 'string' || block.text.trim() === '') {
        throw new Error(`create_document: blocks[${index}] text requires non-empty text`)
      }
      return { kind: 'text', text: block.text }
    case 'bullets': {
      if (!Array.isArray(block.items) || block.items.length === 0 || block.items.some(item => typeof item !== 'string' || item.trim() === '')) {
        throw new Error(`create_document: blocks[${index}] bullets requires a non-empty items array of non-empty strings`)
      }
      return { kind: 'bullets', items: block.items as string[] }
    }
    case 'table': {
      const rows = block.rows
      if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(rows[0]) || rows[0].length === 0
        || rows.some(row => !Array.isArray(row) || row.length !== (rows[0] as unknown[]).length)
        || (rows as string[][]).flat().some(cell => typeof cell !== 'string' || cell.trim() === '')) {
        throw new Error(`create_document: blocks[${index}] table requires a non-empty rectangular rows array of non-empty string cells`)
      }
      return { kind: 'table', rows: rows as string[][] }
    }
    case 'chartPlaceholder':
      if (typeof block.label !== 'string' || block.label.trim() === '') {
        throw new Error(`create_document: blocks[${index}] chartPlaceholder requires a non-empty label`)
      }
      return { kind: 'chartPlaceholder', label: block.label }
    default:
      throw new Error(`create_document: blocks[${index}].kind must be heading, text, bullets, table, or chartPlaceholder`)
  }
}

/**
 * Normalize the raw `create_document` arguments, rejecting shapes the schema already
 * narrows but defensive callers (nested dispatches) can still send.
 * @param args - the raw tool arguments.
 * @returns the normalized arguments.
 */
export function parseCreateDocumentArgs(args: unknown): CreateDocumentArgs {
  if (typeof args !== 'object' || args === null) {
    throw new Error('create_document: arguments must be an object')
  }
  const raw = args as { format?: unknown; title?: unknown; file_path?: unknown; blocks?: unknown }
  if (typeof raw.format !== 'string' || !DOCUMENT_FORMATS.includes(raw.format as DocumentFormat)) {
    throw new Error('create_document: format must be docx, xlsx, or pptx')
  }
  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    throw new Error('create_document: title must be a non-empty string')
  }
  if (typeof raw.file_path !== 'string' || raw.file_path.trim() === '') {
    throw new Error('create_document: file_path must be a non-empty string')
  }
  if (!Array.isArray(raw.blocks)) {
    throw new Error('create_document: blocks must be an array')
  }
  return {
    format: raw.format as DocumentFormat,
    title: raw.title.trim(),
    filePath: raw.file_path.trim(),
    blocks: raw.blocks.map(parseBlock),
  }
}

/**
 * Render the model-facing confirmation envelope for one created document.
 * @param displayPath - the backend-resolved path the document was written to.
 * @param mediaType - the Office media type of the created bytes.
 * @param bytes - the size of the created document in bytes.
 * @returns the envelope text.
 */
export function formatCreatedDocument(displayPath: string, mediaType: string, bytes: number): string {
  return `<path>${displayPath}</path>\n<type>document</type>\n<meta>${mediaType}, ${bytes} bytes</meta>\n<content>\nCreated document; it has been presented as a deliverable.\n</content>`
}

/**
 * Render the `presentCall` summary for a document-creation request.
 * @param args - the raw tool arguments, carrying the requested path.
 * @returns the user-facing call presentation.
 */
export function presentCreateDocumentCall(args: { file_path: string }): { card: 'generic'; kind: 'other'; title: string } {
  // split() never returns an empty array, so pop() always yields the last segment.
  const name = args.file_path.split(/[\\/]/).pop() as string
  return { card: 'generic', kind: 'other', title: `Create document: ${name}` }
}

/**
 * Whether an error is the seam's "no provider mounted" answer, which the tool reports
 * as an actionable `unavailable` result instead of failing the session.
 * @param error - the thrown value.
 * @returns true when the documents seam has no provider.
 */
export function isDocumentsUnavailable(error: unknown): boolean {
  return error instanceof DocumentsError && error.code === 'DOCUMENTS_UNAVAILABLE'
}
