/**
 * Model-facing `create_document` tool over `ctx.documents` and `ctx.fs`: send the title
 * and content blocks to the reserved provider, durably write the created bytes into the
 * Session workspace, and declare the file through the shared `deliverables/presented`
 * chain (the same display path the `present` tool uses). The tool returns an actionable
 * "documents unavailable" answer — without failing the session — when no provider is
 * mounted. It runtime-injects only `tools`, `fs`, `documents`, and `sessionProjections`
 * and imports no provider.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-document
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { FsError } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from './types.ts'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  formatCreatedDocument,
  isDocumentsUnavailable,
  parseCreateDocumentArgs,
  presentCreateDocumentCall,
} from './render.ts'

export {
  DOCUMENT_FORMATS,
  formatCreatedDocument,
  isDocumentsUnavailable,
  parseCreateDocumentArgs,
  presentCreateDocumentCall,
} from './render.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-document'

/** Services required by this plugin. */
export const inject = ['tools', 'fs', 'documents', 'systemPrompt', 'sessionProjections']

/** Default tool-call timeout budget (ms), covering one engine conversion. */
export const DEFAULT_DOCUMENT_TOOL_TIMEOUT_MS = 180_000

/** The stable system-prompt guidance positioning the creation tool and its optionality. */
export const DOCUMENT_PROMPT_TEXT =
  'Use create_document to produce an Office file (Word DOCX, Excel XLSX, or PowerPoint PPTX) from a title and content blocks. It is unavailable until a documents provider is configured — then write plain text files instead, for example by suggesting the user configure one.'

/** Plugin configuration: the timeout budget. */
export interface Config {
  /** Tool-call timeout budget in ms (default 180000). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_DOCUMENT_TOOL_TIMEOUT_MS),
})

/** The schema shape of one content block, mirroring the seam's neutral vocabulary. */
const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['heading', 'text', 'bullets', 'table', 'chartPlaceholder'] },
    text: { type: 'string', description: 'heading/text: the block text.' },
    level: { type: 'integer', description: 'heading only: 1-based outline level (default 1).' },
    items: { type: 'array', items: { type: 'string' }, description: 'bullets only: the bullet items.' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table only: rectangular rows; the first row is the header.' },
    label: { type: 'string', description: 'chartPlaceholder only: what the reserved chart will show.' },
  },
} as const

/** The structured outcome declared by the `create_document` output schema. */
export interface CreateDocumentValue {
  status: 'ok' | 'unavailable'
  path?: string
  mediaType?: string
  bytes?: number
}

/**
 * Register the `create_document` tool and its system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `fs`, `documents`, `sessionProjections`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // The Loader resolves Config defaults before apply; the cast only re-states that.
  const resolved = config as Required<Config>
  const { timeoutMs } = resolved
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-document: timeoutMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }

  ctx.systemPrompt.section({
    name: 'tool:document',
    order: ctx.systemPrompt.getSectionOrder('TOOL_DOCUMENT'),
    text: DOCUMENT_PROMPT_TEXT,
  })

  // Like `present`, the delivery event is appended when the tool result settles, so the
  // declaration only lands for a successful call and carries the settled turn number.
  const pending = new WeakMap<ToolExecution, { session: Session; turn: number; path: string; title: string }>()
  ctx.tools.register(defineTool({
    name: 'create_document',
    description:
      'Create an Office document (DOCX, XLSX, or PPTX) from a title and content blocks, write it into the workspace, and present it to the user as a deliverable. Returns an actionable unavailable message when no documents provider is configured.',
    parameters: {
      format: { type: 'string', required: true, enum: ['docx', 'xlsx', 'pptx'], description: 'The Office format to create.' },
      title: { type: 'string', required: true, description: 'The document title.' },
      file_path: { type: 'string', required: true, description: 'Workspace path for the new document; an existing file at that path is never overwritten.' },
      blocks: {
        type: 'array', required: true,
        description: 'Content blocks in document order: heading, text, bullets, table, or chartPlaceholder objects.',
        items: BLOCK_SCHEMA,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['ok', 'unavailable'] },
          path: { type: 'string' },
          mediaType: { type: 'string' },
          bytes: { type: 'integer' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'ok' && value.path !== undefined && value.mediaType !== undefined && value.bytes !== undefined
          ? formatCreatedDocument(value.path, value.mediaType, value.bytes)
          : 'Document creation is unavailable: no documents provider is configured on this deployment. Ask the user to configure one, or write a plain text file instead.',
      }],
    },
    timeoutMs,
    async execute(args, exec: ToolExecution) {
      const input = parseCreateDocumentArgs(args)
      if (exec.agent === undefined) throw new Error('create_document requires an agent Session')
      const boundary = ctx.sessionProjections.stateOf(exec.agent.session, 'turnBoundary')
      if (boundary === undefined || boundary.openTurnStartSeq === null) throw new Error('create_document requires an open turn')
      const cwd = exec.agent.session.header.cwd
      if (cwd === undefined) throw new Error('create_document requires a workspace')
      try {
        const result = await ctx.documents.create({
          format: input.format,
          title: input.title,
          blocks: input.blocks,
        }, exec.signal)
        const target = await ctx.fs.resolve(input.filePath, { cwd, signal: exec.signal })
        // A created document is a new artifact: never clobber an existing file. The
        // createIfAbsent guard turns an occupied path into an actionable retry.
        const outcome = await ctx.fs.writeBytes(target, result.data, { kind: 'createIfAbsent' }, exec.signal)
        ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
        exec.signal.throwIfAborted()
        pending.set(exec, { session: exec.agent.session, turn: boundary.lastTurn, path: target.displayPath, title: input.title })
        return {
          status: 'ok' as const,
          path: target.displayPath,
          mediaType: result.mediaType,
          bytes: result.data.byteLength,
        }
      } catch (error) {
        if (error instanceof FsError && error.code === 'FS_NOT_OBSERVED') {
          throw new FsError(
            `Cannot create ${input.filePath}: a file already exists at that path. Choose a different file_path and retry.`,
            error.code,
            { cause: error },
          )
        }
        if (isDocumentsUnavailable(error)) {
          return { status: 'unavailable' as const }
        }
        throw error
      }
    },
    presentCall: presentCreateDocumentCall,
  }))
  ctx.on('tools/result', (exec, result) => {
    const delivery = pending.get(exec)
    pending.delete(exec)
    if (delivery === undefined || result.isError) return
    const { session, turn, path, title } = delivery
    session.append('deliverables/presented', {
      turn, callId: exec.callId, files: [{ path, description: title }],
    })
  })
}
