/**
 * Model-facing knowledge tools over `ctx.knowledge`: `knowledge_ingest` (persist a titled
 * document to the shared knowledge base), `knowledge_search` (retrieve ranked passages),
 * `knowledge_remove` (delete one by id), and `knowledge_list` (browse by tag). Each normalizes
 * its arguments, renders the provider's result as bounded text, and returns an actionable
 * "knowledge unavailable" answer — without failing the session — when no provider is mounted.
 * Ingested documents re-enter model context on every search hit, so the ingest path scans the
 * untrusted title and text and refuses to persist an unsafe candidate. It runtime-injects only
 * `tools`, `knowledge`, and `systemPrompt` and imports no provider.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-knowledge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { scanUntrustedText, type TextGuardFinding } from '@deepseek-ai/dsh-text-guard'
import { KnowledgeError } from '@deepseek-ai/dsh-knowledge'
import type { KnowledgeHit } from '@deepseek-ai/dsh-knowledge'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  DEFAULT_MAX_RESULT_CHARS,
  formatDocuments,
  formatHits,
  parseIngestArgs,
  parseListArgs,
  parseRemoveArgs,
  parseSearchArgs,
  presentIngestCall,
  presentListCall,
  presentRemoveCall,
  presentSearchCall,
} from './render.ts'
import type { KnowledgeDocItem, KnowledgeHitItem } from './render.ts'

export {
  DEFAULT_MAX_RESULT_CHARS,
  formatDocuments,
  formatHits,
  parseIngestArgs,
  parseListArgs,
  parseRemoveArgs,
  parseSearchArgs,
  presentIngestCall,
  presentListCall,
  presentRemoveCall,
  presentSearchCall,
} from './render.ts'
export type { KnowledgeDocItem, KnowledgeHitItem } from './render.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-knowledge'

/** Services required by this plugin. */
export const inject = ['tools', 'knowledge', 'systemPrompt']

/** Default tool-call timeout budget (ms). */
export const DEFAULT_KNOWLEDGE_TOOL_TIMEOUT_MS = 30_000

/** The stable system-prompt guidance positioning the knowledge tools and their optionality. */
export const KNOWLEDGE_PROMPT_TEXT =
  'Use knowledge_ingest to add a titled document to the shared knowledge base when work produces reusable findings — for example a research summary, a decided approach, or an environment fact worth keeping. Use knowledge_search to retrieve passages from it when earlier stored knowledge may be relevant, knowledge_list to browse stored documents by tag, and knowledge_remove to delete a document by its id. knowledge_search returns ranked best-first hits with excerpts. All four tools are unavailable until a knowledge provider is configured — then continue normally without the knowledge base.'

/** Plugin configuration: the result cap and the timeout budget. */
export interface Config {
  /** Largest complete rendered result in characters, including truncation metadata (default 8000). */
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 30000). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  maxResultChars: z.number().default(DEFAULT_MAX_RESULT_CHARS),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_KNOWLEDGE_TOOL_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

/** Actionable answer returned when no knowledge provider holds the seam. */
const UNAVAILABLE_TEXT =
  'The knowledge base is not available: no provider is configured. Configure a knowledge service (e.g. a knowledge store path) to ingest or search shared documents; otherwise continue without it.'

/** Project one seam search hit onto the tool's serializable output item shape. */
function toOutputHit(hit: KnowledgeHit): KnowledgeHitItem {
  const record = hit.record
  return {
    id: record.id,
    title: record.title,
    snippet: hit.snippet,
    tags: [...record.tags],
    ...record.source === undefined ? {} : { source: record.source },
    createdAt: record.createdAt,
    score: hit.score,
  }
}

/** Project one listed record onto the tool's serializable output item shape. */
function toOutputDocument(record: {
  id: string
  title: string
  tags: readonly string[]
  source?: string
  createdAt: string
}): KnowledgeDocItem {
  return {
    id: record.id,
    title: record.title,
    tags: [...record.tags],
    ...record.source === undefined ? {} : { source: record.source },
    createdAt: record.createdAt,
  }
}

/** Shared findings schema for the `knowledge_ingest` safety-scan rejection. */
const FINDINGS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', required: true, enum: ['invisible-unicode', 'injection-pattern', 'credential-like'] },
      detail: { type: 'string', required: true },
    },
  },
} as const

/**
 * Register the four knowledge tools and their system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `knowledge`, `systemPrompt`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertTimer('timeoutMs', resolved.timeoutMs)

  ctx.systemPrompt.section({
    name: 'tool:knowledge',
    order: ctx.systemPrompt.getSectionOrder('TOOL_KNOWLEDGE'),
    text: KNOWLEDGE_PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'knowledge_ingest',
    description:
      'Persist one titled document to the shared knowledge base and return its id. Use when work produces reusable findings — a research summary, a decided approach, or a durable environment fact. title is a short human title; text is the document body. Optionally attach tags (classification labels) and a source (provenance such as a URL or path). Returns an actionable unavailable message when no knowledge provider is configured.',
    parameters: {
      title: { type: 'string', required: true, description: 'A short human title for the document.' },
      text: { type: 'string', required: true, description: 'The document body to persist, as free text.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional classification tags stored with the document and filterable on search and listing.' },
      source: { type: 'string', description: 'Optional provenance (a URL, path, or other citation) stored verbatim.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['ok', 'rejected', 'unavailable'] },
          id: { type: 'string' },
          findings: FINDINGS_SCHEMA,
        },
      },
      render: (_args, value) => [
        { type: 'text', text: ingestResultText(value.status, value.findings, value.id) },
      ],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const input = parseIngestArgs(args)
      // Ingested documents re-enter model context on every search hit, so the ingest
      // path scans the untrusted title and text and refuses an unsafe candidate.
      const findings = scanUntrustedText(`${input.title}\n${input.text}`)
      if (findings.length > 0) return { status: 'rejected' as const, findings }
      try {
        const id = await ctx.knowledge.ingest(input, exec.signal)
        return { status: 'ok' as const, id }
      } catch (error) {
        if (error instanceof KnowledgeError && error.code === 'KNOWLEDGE_UNAVAILABLE') {
          return { status: 'unavailable' as const }
        }
        throw error
      }
    },
    presentCall: presentIngestCall,
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_search',
    description:
      'Search the shared knowledge base for documents matching a query, returned ranked best-first with id, title, excerpt, tags, source, and score. Use when earlier stored knowledge may be relevant to the current task. query is required text to match. Optionally filter by tags and cap results with limit. Returns an actionable unavailable message when no knowledge provider is configured.',
    parameters: {
      query: { type: 'string', required: true, description: 'Text or tokens to match against document titles and bodies.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags restricting search to documents carrying them.' },
      limit: { type: 'number', description: 'Optional maximum number of ranked hits to return.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['ok', 'unavailable'] },
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                source: { type: 'string' },
                createdAt: { type: 'string', required: true },
                score: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: value.status === 'unavailable' ? UNAVAILABLE_TEXT : formatHits(value.hits, resolved.maxResultChars) },
      ],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseSearchArgs(args)
      try {
        const result = await ctx.knowledge.search(input, exec.signal)
        return { status: 'ok' as const, hits: result.hits.map(toOutputHit) }
      } catch (error) {
        if (error instanceof KnowledgeError && error.code === 'KNOWLEDGE_UNAVAILABLE') {
          return { status: 'unavailable' as const, hits: [] }
        }
        throw error
      }
    },
    presentCall: presentSearchCall,
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_remove',
    description:
      'Delete one stored knowledge document by its id. Use when a stored document is obsolete or wrong. id is the document identity returned by an earlier knowledge_ingest or knowledge_search. Reports whether a document was removed, and returns an actionable unavailable message when no knowledge provider is configured.',
    parameters: {
      id: { type: 'string', required: true, description: 'The identity of the document to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['ok', 'not_found', 'unavailable'] },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: removeResultText(value.status) },
      ],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const id = parseRemoveArgs(args)
      try {
        const removed = await ctx.knowledge.remove(id, exec.signal)
        const status: 'ok' | 'not_found' = removed ? 'ok' : 'not_found'
        return { status }
      } catch (error) {
        if (error instanceof KnowledgeError && error.code === 'KNOWLEDGE_UNAVAILABLE') {
          return { status: 'unavailable' as const }
        }
        throw error
      }
    },
    presentCall: presentRemoveCall,
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_list',
    description:
      'List stored knowledge documents, most recent first, with id, title, tags, and source. Use to browse the knowledge base when a query is not yet formed. Optionally filter by tags and cap results with limit. Returns an actionable unavailable message when no knowledge provider is configured.',
    parameters: {
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags restricting the listing to documents carrying them.' },
      limit: { type: 'number', description: 'Optional maximum number of documents to return.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['ok', 'unavailable'] },
          documents: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                source: { type: 'string' },
                createdAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: value.status === 'unavailable' ? UNAVAILABLE_TEXT : formatDocuments(value.documents, resolved.maxResultChars) },
      ],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseListArgs(args)
      try {
        const result = await ctx.knowledge.list(input, exec.signal)
        return { status: 'ok' as const, documents: result.records.map(toOutputDocument) }
      } catch (error) {
        if (error instanceof KnowledgeError && error.code === 'KNOWLEDGE_UNAVAILABLE') {
          return { status: 'unavailable' as const, documents: [] }
        }
        throw error
      }
    },
    presentCall: presentListCall,
  }))
}

/** Actionable per-status text for a `knowledge_ingest` result; findings stay redacted. */
function ingestResultText(
  status: 'ok' | 'rejected' | 'unavailable',
  findings: readonly TextGuardFinding[] | undefined,
  id: string | undefined,
): string {
  if (status === 'unavailable') return UNAVAILABLE_TEXT
  if (status === 'rejected') {
    return `Knowledge text rejected by the safety scan: ${findings?.map(finding => finding.detail).join('; ') ?? 'unsafe content'}. Rewrite the document without that content and ingest again.`
  }
  return `Ingested (id: ${id ?? 'unknown'}).`
}

/** Actionable per-status text for a `knowledge_remove` result. */
function removeResultText(status: 'ok' | 'not_found' | 'unavailable'): string {
  if (status === 'unavailable') return UNAVAILABLE_TEXT
  if (status === 'not_found') return 'That knowledge id was not found.'
  return 'Knowledge document removed.'
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-knowledge: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-knowledge: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
