/**
 * Turn-end memory reflection over the memory seam: after each completed root-session
 * turn, one auxiliary model call extracts durable user preferences and style guidance
 * from that turn's human and assistant text, and the validated candidates are written
 * back through `ctx.memory` — after user approval by default (`write: 'ask'`) or
 * directly (`write: 'auto'`). The exact model-visible request and the recorded
 * outcome are session events, so every reflection is reconstructable from the log.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-memory-reflection
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-memory-reflection': { kind: 'dsh-memory-reflection' } & ContextFormed
  }
}

import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { scanUntrustedText } from '@deepseek-ai/dsh-text-guard'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  buildReflectionSystem,
  clampReflectionMessages,
  finishFailure,
  frameReflectionInput,
  parseReflectionCandidates,
  resolveReflectionRoute,
} from './extract.ts'
import type { ReflectionCandidate, ReflectionRoute, ReflectionTurnEntry } from './extract.ts'

export {
  DEFAULT_REFLECTION_CONFIDENCE,
  MAX_REFLECTION_CANDIDATES,
  buildReflectionSystem,
  clampReflectionMessages,
  finishFailure,
  frameReflectionInput,
  parseReflectionCandidates,
  resolveReflectionRoute,
} from './extract.ts'
export type {
  ReflectionCandidate,
  ReflectionRoute,
  ReflectionTurnEntry,
  ReflectionTurnMessage,
} from './extract.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'memory-reflection'

/** Services required by this plugin. */
export const inject = ['llm', 'memory']

/** Capability-owned timeout reason code for reflection requests. */
export const MEMORY_REFLECTION_TIMEOUT_CODE = 'MEMORY_REFLECTION_TIMEOUT'

/** Default end-to-end reflection-call deadline in milliseconds. */
export const DEFAULT_MEMORY_REFLECTION_TIMEOUT_MS = 30_000

/** Default reflection output-token cap. */
export const DEFAULT_MEMORY_REFLECTION_MAX_OUTPUT_TOKENS = 512

/** Default cap on the complete framed reflection input in UTF-8 bytes. */
export const DEFAULT_MEMORY_REFLECTION_MAX_INPUT_BYTES = 32_768

/** Exact model-visible request recorded before one memory-reflection dispatch. */
export interface MemoryReflectionLlmRequestEventData {
  /** Turn number whose end triggered this reflection. */
  readonly turn: number
  /** Exact conversation-message seqs represented in `messages`. */
  readonly inputSeqs: SessionSeq[]
  /** Exact auxiliary LLM route. */
  readonly route: ReflectionRoute
  /** Exact auxiliary system prompt. */
  readonly system: string
  /** Exact auxiliary message list. */
  readonly messages: Message[]
  /** Exact auxiliary output-token cap. */
  readonly maxTokens: number
}

/** Recorded outcome of one turn-end reflection. */
export interface MemoryReflectionEventData {
  /** Turn number whose end triggered this reflection. */
  readonly turn: number
  /** Validated candidates the reflection produced. */
  readonly candidates: ReflectionCandidate[]
  /** What happened to the candidates. */
  readonly outcome: 'written' | 'rejected' | 'unavailable'
  /** Provider-assigned ids of written memories; present exactly when `outcome` is `written`. */
  readonly ids?: string[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one memory-reflection model request. */
    'memory/reflection-llm-request': MemoryReflectionLlmRequestEventData
    /** Result of one turn-end memory reflection. */
    'memory/reflection': MemoryReflectionEventData
  }
}

/** Plugin configuration. */
export interface Config {
  /** Write path: `ask` the user to approve candidates (default), or `auto` write them directly. */
  write?: 'ask' | 'auto'
  /** End-to-end reflection-call deadline in milliseconds (default 30000). */
  timeoutMs?: number
  /** Reflection output-token cap (default 512). */
  maxOutputTokens?: number
  /** Maximum UTF-8 bytes in the final JSON-framed user prompt (default 32768). */
  maxInputBytes?: number
  /** Optional explicit provider route; must be paired with `model`. */
  provider?: string
  /** Optional explicit model id; must be paired with `provider`. */
  model?: string
}

export const Config: z<Config> = z.object({
  write: z.union(['ask', 'auto'] as const).default('ask'),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MEMORY_REFLECTION_TIMEOUT_MS),
  maxOutputTokens: z.number().default(DEFAULT_MEMORY_REFLECTION_MAX_OUTPUT_TOKENS),
  maxInputBytes: z.number().default(DEFAULT_MEMORY_REFLECTION_MAX_INPUT_BYTES),
  provider: z.string(),
  model: z.string(),
})

/** Validated immutable reflection policy. */
export interface ResolvedMemoryReflectionConfig {
  /** Write path: `ask` or `auto`. */
  readonly write: 'ask' | 'auto'
  /** End-to-end reflection-call deadline in milliseconds. */
  readonly timeoutMs: number
  /** Reflection output-token cap. */
  readonly maxOutputTokens: number
  /** Maximum UTF-8 bytes in the final JSON-framed user prompt. */
  readonly maxInputBytes: number
  /** Optional explicit provider route; present only with `model`. */
  readonly provider?: string
  /** Optional explicit model id; present only with `provider`. */
  readonly model?: string
}

/** Complete configuration key set for direct construction validation. */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'write',
  'timeoutMs',
  'maxOutputTokens',
  'maxInputBytes',
  'provider',
  'model',
])

/** Stable id of the write-back question. */
const REFLECTION_QUESTION_ID = 'memory-reflection'

/** Approve label of the write-back question. */
const APPROVE_LABEL = 'Save'

/** Reject label of the write-back question. */
const DISCARD_LABEL = 'Discard'

/** Tag recorded on every memory written by reflection. */
const REFLECTION_TAG = 'reflection'

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`memory-reflection: ${name} must be a positive integer`)
  }
}

/**
 * Fill defaults, then validate and detach reflection configuration.
 * @param config - untrusted plugin configuration.
 * @returns immutable policy with optional route absence preserved.
 */
export function resolveMemoryReflectionConfig(config: Config = {}): ResolvedMemoryReflectionConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`memory-reflection: unknown config key "${key}"`)
  }
  const write = config.write ?? 'ask'
  const timeoutMs = config.timeoutMs ?? DEFAULT_MEMORY_REFLECTION_TIMEOUT_MS
  assertPositiveInteger('timeoutMs', timeoutMs)
  if (timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`memory-reflection: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MEMORY_REFLECTION_MAX_OUTPUT_TOKENS
  assertPositiveInteger('maxOutputTokens', maxOutputTokens)
  const maxInputBytes = config.maxInputBytes ?? DEFAULT_MEMORY_REFLECTION_MAX_INPUT_BYTES
  assertPositiveInteger('maxInputBytes', maxInputBytes)
  const hasProvider = config.provider !== undefined
  const hasModel = config.model !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('memory-reflection: provider and model must be supplied together')
  }
  if (hasProvider
    && (typeof config.provider !== 'string' || config.provider.length === 0
      || typeof config.model !== 'string' || config.model.length === 0)) {
    throw new Error('memory-reflection: provider and model overrides must be non-empty strings')
  }
  return deepFreeze({
    write,
    timeoutMs,
    maxOutputTokens,
    maxInputBytes,
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
  })
}

/** Concatenate the text blocks of one message content, ignoring non-text blocks. */
function textOfContent(blocks: readonly { readonly type: string; readonly text?: string }[]): string {
  const texts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
  }
  return texts.join('\n')
}

/**
 * Ask the user to approve the extracted candidates.
 * @param ctx - the plugin context.
 * @param session - the session the reflection belongs to.
 * @param candidates - validated candidates awaiting approval.
 * @returns the decision, or `unavailable` when no user-questions service is mounted.
 */
async function requestApproval(
  ctx: Context,
  session: Session,
  candidates: readonly ReflectionCandidate[],
): Promise<'approved' | 'rejected' | 'unavailable'> {
  const userQuestions = ctx.get('userQuestions')
  if (userQuestions === undefined) return 'unavailable'
  const agent = ctx.get('agents')?.get(session.id)
  const answer = await userQuestions.ask({
    questions: [{
      id: REFLECTION_QUESTION_ID,
      question: candidates.length === 1
        ? 'Save this extracted memory?'
        : `Save these ${candidates.length} extracted memories?`,
      detail: candidates.map(candidate => `- ${candidate.text}`).join('\n'),
      options: [{ label: APPROVE_LABEL }, { label: DISCARD_LABEL }],
    }],
    ...(agent === undefined ? {} : { agent }),
  })
  return answer.answers.some(item => item.id === REFLECTION_QUESTION_ID && item.selected.includes(APPROVE_LABEL))
    ? 'approved'
    : 'rejected'
}

/**
 * Register the turn-end reflection over `session/event`.
 * @param ctx - the plugin context (must inject `llm` and `memory`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveMemoryReflectionConfig(config)
  // One root session buffers its current turn's conversation text; child sessions
  // share the root's turns and are skipped at `turn/start`.
  const buffers = new Map<SessionId, ReflectionTurnEntry[]>()
  /** Sessions with an in-flight reflection; a second turn end while one runs is dropped. */
  const active = new Set<SessionId>()

  const writeCandidates = async (
    session: Session,
    turn: number,
    candidates: readonly ReflectionCandidate[],
  ): Promise<void> => {
    const ids: string[] = []
    for (const candidate of candidates) {
      ids.push(await ctx.memory.remember({
        text: candidate.text,
        namespace: candidate.namespace,
        confidence: candidate.confidence,
        tags: [REFLECTION_TAG],
      }))
    }
    session.append('memory/reflection', { turn, candidates: [...candidates], outcome: 'written', ids })
  }

  const reflect = async (
    session: Session,
    turn: number,
    entries: readonly ReflectionTurnEntry[],
  ): Promise<void> => {
    if (active.has(session.id)) return
    active.add(session.id)
    try {
      const messages = entries
        .map(entry => ({ ...entry, text: entry.text.trim() }))
        .filter(entry => entry.text.length > 0)
      if (messages.length === 0) return
      const clamped = clampReflectionMessages(messages, resolved.maxInputBytes)
      if (clamped.length === 0) return
      // Extraction is only possible while a provider holds the seam; probing first
      // avoids paying for a model call whose result could never be written.
      const available = await ctx.memory.list({ limit: 1 }).then(() => true, () => false)
      if (!available) return
      const headerConfig = session.requestHeader()?.config
      const route = resolveReflectionRoute(
        resolved,
        headerConfig === undefined
          ? undefined
          : { provider: headerConfig.provider, model: headerConfig.model },
      )
      if (route === undefined) return
      const system = buildReflectionSystem()
      const request: Message[] = [createUserMessage({
        content: [{ type: 'text', text: frameReflectionInput(clamped) }],
        source: { kind: 'dsh-memory-reflection' },
      })]
      using callDeadline = deadline(undefined, resolved.timeoutMs, MEMORY_REFLECTION_TIMEOUT_CODE)
      const options: GenerateOptions = deepFreeze({
        provider: route.provider,
        model: route.model,
        messages: request,
        system,
        maxTokens: resolved.maxOutputTokens,
        sessionId: session.id,
        purpose: 'memory-reflection',
        signal: callDeadline.signal,
      })
      session.append('memory/reflection-llm-request', {
        turn,
        inputSeqs: clamped.map(entry => entry.seq),
        route,
        system,
        messages: request,
        maxTokens: resolved.maxOutputTokens,
      })
      callDeadline.signal.throwIfAborted()
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream(options)) {
        callDeadline.signal.throwIfAborted()
        assembler.push(chunk)
      }
      callDeadline.signal.throwIfAborted()
      const failure = finishFailure(assembler.finish)
      if (failure !== undefined) throw failure
      const blocks = assembler.blocks()
      const output = blocks
        .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('')
      const extracted = parseReflectionCandidates(output)
      if (extracted.length === 0) return
      // Extracted candidates re-enter model context through recall, so an unsafe
      // candidate is dropped here instead of being offered for approval.
      const candidates = extracted.filter((candidate) => {
        const findings = scanUntrustedText(candidate.text)
        if (findings.length === 0) return true
        ctx.logger.warn(`memory-reflection: candidate dropped by safety scan (${findings.map(finding => finding.kind).join(', ')}): ${candidate.text.slice(0, 60)}`)
        return false
      })
      if (candidates.length === 0) {
        session.append('memory/reflection', { turn, candidates: [...extracted], outcome: 'rejected' })
        return
      }
      if (resolved.write === 'ask') {
        const approval = await requestApproval(ctx, session, candidates)
        if (approval !== 'approved') {
          session.append('memory/reflection', { turn, candidates: [...candidates], outcome: approval })
          return
        }
      }
      await writeCandidates(session, turn, candidates)
    } catch (error) {
      ctx.logger.warn(`memory-reflection: extraction failed: ${String(error)}`)
    } finally {
      active.delete(session.id)
    }
  }

  ctx.on('session/event', (session, event) => {
    switch (event.type) {
      case 'turn/start':
        if (session.header.parentSession === undefined) buffers.set(session.id, [])
        return
      case 'user/message':
        if (event.data.source.kind === 'user') {
          buffers.get(session.id)?.push({ seq: event.seq, role: 'user', text: textOfContent(event.data.content) })
        }
        return
      case 'assistant/message':
        buffers.get(session.id)?.push({ seq: event.seq, role: 'assistant', text: textOfContent(event.data.message.content) })
        return
      case 'turn/end': {
        const entries = buffers.get(session.id)
        buffers.delete(session.id)
        if (entries !== undefined) void reflect(session, event.data.turn, entries)
        return
      }
      default:
        // SessionEventMap is merge-extensible; other events carry no reflection input.
        return
    }
  }, { global: true })
}
