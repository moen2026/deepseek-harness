/**
 * Vocabulary for the document-creation capability seam (`ctx.documents`): a creation
 * request over neutral content blocks, the finished document bytes a provider answers
 * with, the provider contract that reserves the seam, and the `DocumentsService` surface
 * the seam and its model-facing tool share.
 * @module @deepseek-ai/dsh-documents/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Office document formats a creation request can target. The seam speaks format, not
 * template engine: providers own how bytes are produced.
 */
export type DocumentFormat = 'docx' | 'xlsx' | 'pptx'

/**
 * Stable, machine-routable codes for document-creation failures, carried on
 * {@link DocumentsError} so callers branch on `code` instead of parsing `message`.
 */
export type DocumentsErrorCode =
  | 'DOCUMENTS_INVALID_PROVIDER'
  | 'DOCUMENTS_CONFLICT'
  | 'DOCUMENTS_UNAVAILABLE'
  | 'DOCUMENTS_DISPOSED'
  | 'DOCUMENTS_INVALID_REQUEST'
  | 'DOCUMENTS_PROVIDER_FAILED'

/**
 * Structured document-creation failure. Extends {@link HarnessError} with one
 * {@link DocumentsErrorCode}.
 */
export class DocumentsError extends HarnessError {
  override readonly code: DocumentsErrorCode

  constructor(message: string, code: DocumentsErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** One neutral content block. Blocks are template-agnostic: providers translate them. */
export type DocumentBlock =
  /** A section heading; `level` is 1-based and defaults to 1. */
  | { readonly kind: 'heading'; readonly text: string; readonly level?: number }
  /** A body paragraph. */
  | { readonly kind: 'text'; readonly text: string }
  /** An unordered bullet list. */
  | { readonly kind: 'bullets'; readonly items: readonly string[] }
  /** A table; the first row is the header row. Every row must have equal length. */
  | { readonly kind: 'table'; readonly rows: readonly (readonly string[])[] }
  /**
   * A placeholder reserving space for a chart the caller will insert later; providers
   * render it as a labeled placeholder frame, never as real chart data.
   */
  | { readonly kind: 'chartPlaceholder'; readonly label: string }

/**
 * A caller's creation request. `title` names the document (providers may also use it as
 * the document's visible title); `blocks` are the content in document order.
 */
export interface DocumentCreateRequest {
  /** The target Office format. */
  readonly format: DocumentFormat
  /** The document title. */
  readonly title: string
  /** The content blocks, in document order. */
  readonly blocks: readonly DocumentBlock[]
}

/** One created document: the raw bytes plus the media type they decode as. */
export interface DocumentResult {
  /** Raw document bytes. */
  readonly data: Uint8Array
  /** The media type the bytes decode as (the Office media type for the format). */
  readonly mediaType: string
}

/**
 * A document-creation backend that reserves `ctx.documents` and answers creation
 * requests. The provider owns engines, intermediate formats, and any layout policy; the
 * seam only routes to it.
 */
export interface DocumentsProvider {
  /** Opaque provider identity reserved atomically at registration. */
  readonly id: string
  /**
   * Create one document against the provider's backend.
   * @param request - the creation request with format, title, and blocks.
   * @param signal - cancellation honored across the creation's I/O.
   * @returns the created document.
   */
  create(request: DocumentCreateRequest, signal?: AbortSignal): Promise<DocumentResult>
}

/**
 * The `ctx.documents` surface: a single-provider reservation registry plus the routed
 * `create` operation. The seam exposes no protocol escape hatch — engines and
 * intermediate representations are the provider's private concern.
 */
export interface DocumentsService {
  /**
   * Reserve the seam for one provider. Validate and conflict-check everything before
   * mutating: an invalid or conflicting registration publishes nothing, and its
   * disposer releases the reservation.
   * @param provider - the backend claiming the seam.
   * @returns a synchronous disposer releasing this provider's reservation.
   */
  registerProvider(provider: DocumentsProvider): () => void
  /**
   * Route one creation to the registered provider.
   * @param request - the creation request.
   * @param signal - cancellation forwarded to the provider.
   * @returns the created document.
   * @throws {@link DocumentsError} with `DOCUMENTS_UNAVAILABLE` when no provider is registered.
   */
  create(request: DocumentCreateRequest, signal?: AbortSignal): Promise<DocumentResult>
}
