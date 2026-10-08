/**
 * Model-facing memory tools over `ctx.memory`: `memory_write` (persist a durable fact or
 * preference), `memory_search` (recall ranked memories), and `memory_forget` (delete one by
 * id). Each normalizes its arguments, renders the provider's result as bounded text, and
 * returns an actionable "memory unavailable" answer — without failing the session — when no
 * provider is mounted. Recall ranks lexically by default; an optional semantic ranking is
 * active only when the deployment supplies its own embedding endpoint, and DSH never selects
 * a model or embedding provider on the model's behalf. It runtime-injects only `tools`,
 * `memory`, and `systemPrompt` and imports no provider.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryHitItem } from './render.ts'
import { scanUntrustedText, type TextGuardFinding } from '@deepseek-ai/dsh-text-guard'
import { MEMORY_NAMESPACES, MemoryError, type MemoryHit } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-memory'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  DEFAULT_MAX_RESULT_CHARS,
  formatHits,
  parseForgetArgs,
  parseSearchArgs,
  parseWriteArgs,
  presentForgetCall,
  presentSearchCall,
  presentWriteCall,
} from './render.ts'

export {
  DEFAULT_MAX_RESULT_CHARS,
  formatHits,
  parseForgetArgs,
  parseSearchArgs,
  parseWriteArgs,
  presentForgetCall,
  presentSearchCall,
  presentWriteCall,
} from './render.ts'
export type { MemoryForgetArgs, MemoryHitItem, MemorySearchArgs, MemoryWriteArgs } from './render.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-memory'

/** Services required by this plugin. */
export const inject = ['tools', 'memory', 'systemPrompt']

/** Default tool-call timeout budget (ms), covering a possible embedding round trip. */
export const DEFAULT_MEMORY_TOOL_TIMEOUT_MS = 30_000

/** The stable system-prompt guidance positioning the memory tools and their optionality. */
export const MEMORY_PROMPT_TEXT =
  'Use memory_write to persist a durable fact or preference when the user asks you to remember something, memory_search to recall stored memories when past context may be relevant, and memory_forget to remove a memory by its id. A written memory may carry a namespace (preference, fact, or style), a confidence, and a ttl_ms expiry after which it stops being recalled. All three tools are unavailable until a memory provider is configured — then continue normally without memory. Recall ranks lexically by default; an optional semantic ranking is active only when the deployment supplies its own embedding endpoint, and DSH never selects a model or embedding provider on your behalf.'

/** Plugin configuration: the result cap and the timeout budget. */
export interface Config {
  /** Largest complete rendered result in characters, including truncation metadata (default 8000). */
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 30000). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  maxResultChars: z.number().default(DEFAULT_MAX_RESULT_CHARS),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MEMORY_TOOL_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

/** Actionable answer returned when no memory provider holds the seam. */
const UNAVAILABLE_TEXT =
  'Memory is not available: no provider is configured. Configure a memory service (e.g. set a memory store path) to persist or recall long-term memories; otherwise continue the conversation without memory.'

/** Project one seam recall hit onto the tool's serializable output item shape. */
function toOutputHit(hit: MemoryHit): MemoryHitItem {
  const record = hit.record
  return {
    id: record.id,
    text: record.text,
    tags: [...record.tags],
    ...record.scope === undefined ? {} : { scope: record.scope },
    ...record.namespace === undefined ? {} : { namespace: record.namespace },
    ...record.confidence === undefined ? {} : { confidence: record.confidence },
    createdAt: record.createdAt,
    ...record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt },
    score: hit.score,
  }
}

/** Shared output schema for `memory_search`: a status plus ranked hit items. */
const SEARCH_OUTPUT_SCHEMA = {
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
          text: { type: 'string', required: true },
          tags: { type: 'array', required: true, items: { type: 'string' } },
          scope: { type: 'string' },
          namespace: { type: 'string', enum: [...MEMORY_NAMESPACES] },
          confidence: { type: 'number' },
          createdAt: { type: 'string', required: true },
          expiresAt: { type: 'string' },
          score: { type: 'number', required: true },
        },
      },
    },
  },
} as const

/**
 * Register the three memory tools and their system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `memory`, `systemPrompt`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertTimer('timeoutMs', resolved.timeoutMs)

  ctx.systemPrompt.section({
    name: 'tool:memory',
    order: ctx.systemPrompt.getSectionOrder('TOOL_MEMORY'),
    text: MEMORY_PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'memory_write',
    description:
      'Persist one durable fact or preference to long-term memory and return its id. Use when the user asks you to remember something. text is required free-form content. Optionally attach tags (classification labels), a scope (a partition such as a project), a namespace (preference, fact, or style), a confidence between 0 and 1, and ttl_ms (positive milliseconds after which the memory stops being recalled). Returns an actionable unavailable message when no memory provider is configured.',
    parameters: {
      text: { type: 'string', required: true, description: 'The fact or preference to remember, as free text.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional classification tags stored with the memory and filterable on recall.' },
      scope: { type: 'string', description: 'Optional scope (for example a project or workspace) partitioning the store.' },
      namespace: { type: 'string', enum: [...MEMORY_NAMESPACES], description: 'Optional namespace classifying the memory: preference (how the user wants work done), fact (durable project facts), or style (collaboration-style guidance).' },
      confidence: { type: 'number', description: 'Optional confidence in this memory, from 0 through 1.' },
      ttl_ms: { type: 'number', description: 'Optional time-to-live in milliseconds; after it elapses the memory is no longer recalled.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['ok', 'rejected', 'unavailable'] },
          id: { type: 'string' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, enum: ['invisible-unicode', 'injection-pattern', 'credential-like'] },
                detail: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: writeResultText(value.status, value.findings, value.id) },
      ],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const input = parseWriteArgs(args)
      // Persisted memories re-enter model context on every recall, so the write
      // path scans the untrusted text and refuses to persist an unsafe candidate.
      const findings = scanUntrustedText(input.text)
      if (findings.length > 0) return { status: 'rejected' as const, findings }
      try {
        const id = await ctx.memory.remember(input, exec.signal)
        return { status: 'ok' as const, id }
      } catch (error) {
        if (error instanceof MemoryError && error.code === 'MEMORY_UNAVAILABLE') {
          return { status: 'unavailable' as const }
        }
        throw error
      }
    },
    presentCall: presentWriteCall,
  }))

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description:
      'Recall stored memories matching a query, returned ranked best-first with id, text, tags, scope, namespace, confidence, and score. Use when past context may be relevant. query is required text to match. Optionally filter by tags, scope, namespace, and min_confidence, and cap results with limit. Expired memories are never returned. Returns an actionable unavailable message when no memory provider is configured.',
    parameters: {
      query: { type: 'string', required: true, description: 'Text or tokens to match against stored memories.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags restricting recall to memories carrying them.' },
      scope: { type: 'string', description: 'Optional scope restricting recall to one partition of the store.' },
      namespace: { type: 'string', enum: [...MEMORY_NAMESPACES], description: 'Optional namespace restricting recall to memories classified with it.' },
      min_confidence: { type: 'number', description: 'Optional lowest recorded confidence eligible; memories without one are excluded.' },
      limit: { type: 'number', description: 'Optional maximum number of ranked hits to return.' },
    },
    output: {
      schema: SEARCH_OUTPUT_SCHEMA,
      render: (_args, value) => [
        { type: 'text', text: value.status === 'unavailable' ? UNAVAILABLE_TEXT : formatHits(value.hits, resolved.maxResultChars) },
      ],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseSearchArgs(args)
      try {
        const result = await ctx.memory.recall(input, exec.signal)
        return { status: 'ok' as const, hits: result.hits.map(toOutputHit) }
      } catch (error) {
        if (error instanceof MemoryError && error.code === 'MEMORY_UNAVAILABLE') {
          return { status: 'unavailable' as const, hits: [] }
        }
        throw error
      }
    },
    presentCall: presentSearchCall,
  }))

  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description:
      'Delete one stored memory by its id. Use when the user asks you to forget something you previously remembered. id is the record identity returned by an earlier memory_write or memory_search. Reports whether a memory was removed, and returns an actionable unavailable message when no memory provider is configured.',
    parameters: {
      id: { type: 'string', required: true, description: 'The identity of the memory to forget.' },
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
        { type: 'text', text: forgetText(value.status) },
      ],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const id = parseForgetArgs(args)
      try {
        const removed = await ctx.memory.forget(id, exec.signal)
        const status: 'ok' | 'not_found' = removed ? 'ok' : 'not_found'
        return { status }
      } catch (error) {
        if (error instanceof MemoryError && error.code === 'MEMORY_UNAVAILABLE') {
          return { status: 'unavailable' as const }
        }
        throw error
      }
    },
    presentCall: presentForgetCall,
  }))
}

/** Actionable per-status text for a `memory_forget` result. */
function forgetText(status: 'ok' | 'not_found' | 'unavailable'): string {
  if (status === 'unavailable') return UNAVAILABLE_TEXT
  if (status === 'not_found') return 'That memory id was not found.'
  return 'Memory forgotten.'
}

/** Actionable per-status text for a `memory_write` result; findings stay redacted. */
function writeResultText(
  status: 'ok' | 'rejected' | 'unavailable',
  findings: readonly TextGuardFinding[] | undefined,
  id: string | undefined,
): string {
  if (status === 'unavailable') return UNAVAILABLE_TEXT
  if (status === 'rejected') {
    return `Memory text rejected by the safety scan: ${findings?.map(finding => finding.detail).join('; ') ?? 'unsafe content'}. Rewrite the memory without that content and write again.`
  }
  return `Remembered (id: ${id ?? 'unknown'}).`
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-memory: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-memory: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
