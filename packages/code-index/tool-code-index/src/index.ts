/**
 * Model-facing `search_codebase` tool over `ctx.codeIndex`. One read-only lexical code
 * search with optional `glob` and `language` refinements; it normalizes arguments, caps and
 * renders the provider's BM25-ranked hits as `path:lines  snippet` lines, and returns an
 * actionable "index unavailable" answer — without failing the session — when no provider is
 * mounted. It runtime-injects only `tools`, `codeIndex`, and `systemPrompt` and imports no
 * provider.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-code-index
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CodeIndexError } from '@deepseek-ai/dsh-code-index'
import type {} from '@deepseek-ai/dsh-code-index'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  DEFAULT_MAX_RESULT_CHARS,
  formatHits,
  parseSearchArgs,
  presentSearchCall,
} from './render.ts'

export {
  DEFAULT_MAX_RESULT_CHARS,
  formatHits,
  parseSearchArgs,
  presentSearchCall,
} from './render.ts'
export type { SearchCodebaseArgs, SearchCodebaseInput } from './render.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-code-index'

/** Services required by this plugin. */
export const inject = ['tools', 'codeIndex', 'systemPrompt']

/** Default tool-call timeout budget (ms), covering the first-search index reconcile and query. */
export const DEFAULT_CODE_INDEX_TOOL_TIMEOUT_MS = 120_000

/** The stable system-prompt guidance positioning the code index among search tools. */
export const CODE_INDEX_PROMPT_TEXT =
  'Use search_codebase for lexical full-text search over the workspace\'s indexed source when you know names or text but not their files; it returns ranked line ranges with snippets. It is unavailable until a code-index provider is configured — then fall back to grep/glob/read. Narrow with glob (e.g. packages/**/*.ts) or language (e.g. typescript) and raise limit only when the first page is not enough.'

/** Plugin configuration: the result cap and the timeout budget. */
export interface Config {
  /** Largest complete rendered result in characters, including truncation metadata (default 16000). */
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 120000). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  maxResultChars: z.number().default(DEFAULT_MAX_RESULT_CHARS),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_CODE_INDEX_TOOL_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

/** Actionable answer returned when no code-index provider holds the seam. */
const UNAVAILABLE_TEXT =
  'Code index is not available: no provider is configured. Configure a code-index service (e.g. set an index path) or use grep/glob/read to search the workspace instead.'

/**
 * Register the `search_codebase` tool and its system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `codeIndex`, `systemPrompt`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertTimer('timeoutMs', resolved.timeoutMs)

  ctx.systemPrompt.section({
    name: 'tool:code-index',
    order: ctx.systemPrompt.getSectionOrder('TOOL_CODE_INDEX'),
    text: CODE_INDEX_PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'search_codebase',
    description:
      'Lexical full-text search over the workspace\'s indexed source, returning ranked line ranges with snippets. query is required text to match. Optionally narrow with glob (e.g. packages/**/*.ts) and language (e.g. typescript); limit caps the number of hits. Returns an actionable unavailable message when no code-index provider is configured.',
    parameters: {
      query: { type: 'string', required: true, description: 'Text or tokens to match against indexed source chunks.' },
      glob: { type: 'string', description: 'Optional glob limiting which file paths are searched (e.g. packages/**/*.ts).' },
      language: { type: 'string', description: 'Optional syntax id restricting results (e.g. typescript, python, go).' },
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
                path: { type: 'string', required: true },
                startLine: { type: 'integer', required: true },
                endLine: { type: 'integer', required: true },
                language: { type: 'string' },
                score: { type: 'number', required: true },
                snippet: { type: 'string', required: true },
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
        const page = await ctx.codeIndex.search(input, exec.signal)
        return {
          status: 'ok' as const,
          hits: page.hits.map(hit => ({
            path: hit.path,
            startLine: hit.startLine,
            endLine: hit.endLine,
            ...hit.language === undefined ? {} : { language: hit.language },
            score: hit.score,
            snippet: hit.snippet,
          })),
        }
      } catch (error) {
        if (error instanceof CodeIndexError && error.code === 'CODE_INDEX_UNAVAILABLE') {
          return { status: 'unavailable' as const, hits: [] }
        }
        throw error
      }
    },
    presentCall: presentSearchCall,
  }))
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-code-index: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-code-index: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
