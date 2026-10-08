/**
 * LibreOffice-kit creation provider for `ctx.documents`. One plugin instance registers a
 * `office-create` provider that translates neutral content blocks into an OpenDocument
 * intermediate package and has the kit's converter (native engine with Node WASM fallback)
 * export the requested OOXML format — DOCX, XLSX, or PPTX. Registration with the seam is
 * effect-scoped: disposal unregisters it and disposes the shared converter.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-office-create
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { DocumentsProvider } from '@deepseek-ai/dsh-documents'
import { createKitCreator } from './create.ts'

export { DOCUMENT_MEDIA_TYPES, createKitCreator, type CreateDocumentConfig, type KitCreator } from './create.ts'
export { buildOdfPackage, escapeXml, validateRequest, INTERMEDIATE_SUFFIX } from './odf.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'office-create'

/** Services required by this plugin. */
export const inject = ['documents']

/** Default conversion deadline (ms) for one creation. */
export const OFFICE_CREATE_DEFAULT_TIMEOUT_MS = 120_000

/** Default maximum complete document bytes one creation may produce. */
export const OFFICE_CREATE_DEFAULT_MAX_OUTPUT_BYTES = 100 * 1024 * 1024

/** Provider configuration: the engine deadline and the output cap. */
export interface Config {
  /** Conversion deadline in milliseconds. Defaults to 120000. */
  timeoutMs?: number
  /** Maximum complete document bytes one creation may produce. Defaults to 104857600. */
  maxOutputBytes?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1).default(OFFICE_CREATE_DEFAULT_TIMEOUT_MS),
  maxOutputBytes: z.number().step(1).min(1).default(OFFICE_CREATE_DEFAULT_MAX_OUTPUT_BYTES),
})

/**
 * Register the LibreOffice-kit creation provider on `ctx.documents`.
 * @param ctx - the plugin context (must inject `documents`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // The Loader resolves Config defaults before apply; the cast only re-states that.
  const creator = createKitCreator(config as Required<Config>)
  // Dispose the shared converter when the plugin's own effect scope unwinds.
  ctx.effect(() => async () => {
    await creator.dispose()
  }, 'office-create.dispose()')
  const provider: DocumentsProvider = {
    id: 'office-create',
    create: (request, signal) => creator.create(request, signal),
  }
  ctx.documents.registerProvider(provider)
}
