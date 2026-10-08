/**
 * LibreOffice-kit-backed creation engine for the office-create provider. Each creation
 * translates the request into an OpenDocument intermediate package ({@link buildOdfPackage}),
 * writes it to a private scratch directory, and has the kit's converter export the requested
 * OOXML format. One converter is created lazily and shared; kit failures surface as typed
 * `DOCUMENTS_PROVIDER_FAILED` errors and scratch directories never outlive the call.
 * @module @deepseek-ai/dsh-office-create/create
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConverter, type Converter, type ConverterOptions } from '@deepseek-ai/libreoffice-kit'
import { DocumentsError } from '@deepseek-ai/dsh-documents'
import type { DocumentCreateRequest, DocumentFormat, DocumentResult } from '@deepseek-ai/dsh-documents'
import { buildOdfPackage, INTERMEDIATE_SUFFIX } from './odf.ts'

/** The Office media type each output format decodes as. */
export const DOCUMENT_MEDIA_TYPES: Record<DocumentFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/** Engine and output limits for one creator lifetime. */
export interface CreateDocumentConfig {
  /** Conversion deadline in milliseconds after a queued conversion starts. */
  timeoutMs: number
  /** Maximum complete document bytes the creator accepts from the engine. */
  maxOutputBytes: number
}

/** The creation engine one provider registration wraps. */
export interface KitCreator {
  create(request: DocumentCreateRequest, signal?: AbortSignal): Promise<DocumentResult>
  /** Abort active work and dispose the shared converter. */
  dispose(): Promise<void>
}

/** Read the engine output, refusing bytes beyond the configured cap. */
async function readOutput(path: string, maxOutputBytes: number, signal: AbortSignal | undefined): Promise<Uint8Array> {
  const data = await readFile(path, signal === undefined ? {} : { signal })
  if (data.byteLength > maxOutputBytes) {
    throw new DocumentsError(
      `the document engine produced ${data.byteLength} bytes, beyond the ${maxOutputBytes}-byte output cap`,
      'DOCUMENTS_PROVIDER_FAILED',
    )
  }
  return data
}

/**
 * Create one kit-backed creator. The converter is created lazily on first use so a
 * mounted-but-unused provider never pays the engine startup.
 * @param config - engine timeout and output cap.
 * @returns the creator plus its disposer, shared across calls.
 */
export function createKitCreator(config: CreateDocumentConfig): KitCreator {
  const options: ConverterOptions = { timeoutMs: config.timeoutMs }
  let converter: Promise<Converter> | undefined
  const acquire = (): Promise<Converter> => {
    if (converter === undefined) {
      converter = createConverter(options).catch((error: unknown) => {
        converter = undefined
        throw error
      })
    }
    return converter
  }

  return {
    async create(request, signal): Promise<DocumentResult> {
      // Validation happens before any engine work so a bad request never starts a
      // conversion (and its DocumentsError is the caller's actionable answer).
      const pkg = buildOdfPackage(request)
      const suffix = INTERMEDIATE_SUFFIX[request.format]
      const directory = await mkdtemp(join(tmpdir(), 'dsh-office-create-'))
      try {
        const engine = await acquire()
        signal?.throwIfAborted()
        const inputPath = join(directory, `source.${suffix}`)
        await writeFile(inputPath, pkg, { flag: 'wx', mode: 0o600, signal })
        const outputPath = join(directory, `out.${request.format}`)
        await engine.convert({ inputPath, outputPath }, signal)
        signal?.throwIfAborted()
        const data = await readOutput(outputPath, config.maxOutputBytes, signal)
        return { data, mediaType: DOCUMENT_MEDIA_TYPES[request.format] }
      } catch (cause) {
        signal?.throwIfAborted()
        if (cause instanceof DocumentsError) throw cause
        const detail = cause instanceof Error ? cause.message : String(cause)
        throw new DocumentsError(
          `the document engine failed to create a ${request.format}: ${detail}`,
          'DOCUMENTS_PROVIDER_FAILED',
          { cause },
        )
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    async dispose(): Promise<void> {
      if (converter === undefined) return
      const engine = await converter
      converter = undefined
      await engine.dispose()
    },
  }
}
