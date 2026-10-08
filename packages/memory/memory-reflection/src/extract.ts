/**
 * Pure extraction policy for turn-end memory reflection: the extraction system
 * prompt, input framing and byte-bounded clamping, candidate parsing and
 * validation, route resolution, and terminal-finish translation. No I/O — the
 * plugin performs the model call and the write-back through the memory seam.
 * @module @deepseek-ai/dsh-memory-reflection/extract
 */

import type { FinishReason } from '@deepseek-ai/dsh-llm'
import { MEMORY_NAMESPACES, type MemoryNamespace } from '@deepseek-ai/dsh-memory'
import type { SessionSeq } from '@deepseek-ai/dsh-session'

/** Largest number of candidates one reflection may produce. */
export const MAX_REFLECTION_CANDIDATES = 10

/** Confidence assigned to a candidate whose reported confidence is missing or invalid. */
export const DEFAULT_REFLECTION_CONFIDENCE = 0.7

/** One extractable memory candidate before write-back. */
export interface ReflectionCandidate {
  /** The remembered statement, non-empty after trimming. */
  readonly text: string
  /** Validated namespace; an unclassifiable candidate defaults to `fact`. */
  readonly namespace: MemoryNamespace
  /** Confidence from 0 through 1; an invalid report defaults to {@link DEFAULT_REFLECTION_CONFIDENCE}. */
  readonly confidence: number
}

/** One conversation message considered for extraction. */
export interface ReflectionTurnMessage {
  /** Whether the message came from the human or the assistant. */
  readonly role: 'user' | 'assistant'
  /** The message's text content. */
  readonly text: string
}

/** One considered message with the session seq it was recorded at. */
export interface ReflectionTurnEntry extends ReflectionTurnMessage {
  /** Seq of the exact `user/message` or `assistant/message` event represented. */
  readonly seq: SessionSeq
}

/** A resolved model route for one reflection call. */
export interface ReflectionRoute {
  /** Provider route name. */
  readonly provider: string
  /** Model id. */
  readonly model: string
}

/**
 * The extraction system instruction shared by every reflection call.
 * @returns the system instruction text.
 */
export function buildReflectionSystem(): string {
  return [
    'You extract durable memories from one coding-assistant conversation turn.',
    'Return only a JSON object of the form {"memories":[{"text":"...","namespace":"preference|fact|style","confidence":0.0}]} and no other prose.',
    'Extract only durable user preferences, collaboration-style guidance, or project facts worth carrying into future sessions; skip transient details.',
    'Return {"memories":[]} when nothing qualifies.',
  ].join('\n')
}

/**
 * Frame messages as JSON so user text cannot break structural delimiters.
 * @param messages - the conversation turns to frame.
 * @returns the framed user-turn text.
 */
export function frameReflectionInput(messages: readonly ReflectionTurnMessage[]): string {
  return `Extract durable memories from this JSON array of conversation messages:\n${JSON.stringify(messages.map(({ role, text }) => ({ role, text })))}`
}

/** True for a non-null, non-array object. */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True when an untrusted value names a declared {@link MemoryNamespace}. */
function isMemoryNamespace(value: unknown): value is MemoryNamespace {
  return typeof value === 'string' && (MEMORY_NAMESPACES as readonly string[]).includes(value)
}

/** Validate one reported namespace, defaulting an unclassifiable value to `fact`. */
function candidateNamespace(value: unknown): MemoryNamespace {
  return isMemoryNamespace(value) ? value : 'fact'
}

/** Validate one reported confidence, defaulting an invalid value to the standard floor. */
function candidateConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : DEFAULT_REFLECTION_CONFIDENCE
}

/**
 * Parse one model answer into validated candidates. The scan tolerates prose
 * around a single JSON object and stops at {@link MAX_REFLECTION_CANDIDATES}.
 * @param output - the complete assistant text of the reflection call.
 * @returns validated candidates; empty for any unparseable or non-conforming answer.
 */
export function parseReflectionCandidates(output: string): ReflectionCandidate[] {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(output.slice(start, end + 1))
  } catch {
    // A non-JSON model answer yields no candidates; the turn itself is unaffected.
    return []
  }
  if (!isRecordValue(parsed)) return []
  const reported = parsed['memories']
  if (!Array.isArray(reported)) return []
  const candidates: ReflectionCandidate[] = []
  for (const item of reported) {
    if (candidates.length >= MAX_REFLECTION_CANDIDATES) break
    if (!isRecordValue(item)) continue
    const text = typeof item['text'] === 'string' ? item['text'].trim() : ''
    if (text.length === 0) continue
    candidates.push({
      text,
      namespace: candidateNamespace(item['namespace']),
      confidence: candidateConfidence(item['confidence']),
    })
  }
  return candidates
}

/** Truncate text to at most `maxBytes` UTF-8 bytes without splitting a character. */
function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0
  let end = 0
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) break
    bytes += size
    end += character.length
  }
  return text.slice(0, end)
}

/**
 * Keep the most recent messages that fit the complete JSON-framed input inside
 * `maxBytes`; when no message fits whole, an oversized final message is truncated
 * instead of dropped.
 * @param messages - the turn's messages in log order.
 * @param maxBytes - cap on the complete framed input in UTF-8 bytes.
 * @returns the messages to send; empty when even one framed empty message exceeds the cap.
 */
export function clampReflectionMessages(
  messages: readonly ReflectionTurnEntry[],
  maxBytes: number,
): ReflectionTurnEntry[] {
  const kept: ReflectionTurnEntry[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index]
    if (entry === undefined) break
    const candidate = [entry, ...kept]
    if (Buffer.byteLength(frameReflectionInput(candidate), 'utf8') > maxBytes) break
    kept.unshift(entry)
  }
  if (kept.length > 0) return kept
  const last = messages[messages.length - 1]
  if (last === undefined) return []
  const empty: ReflectionTurnEntry = { ...last, text: '' }
  const room = maxBytes - Buffer.byteLength(frameReflectionInput([empty]), 'utf8')
  if (room <= 0) return []
  return [{ ...last, text: truncateUtf8(last.text, room) }]
}

/**
 * Resolve the reflection route: an explicit provider/model pair wins, otherwise
 * the session's logged request route, otherwise nothing.
 * @param config - validated reflection configuration.
 * @param sessionRoute - the route captured from the session's `request/header`, if any.
 * @returns the route to call, or `undefined` when none is available.
 */
export function resolveReflectionRoute(
  config: { readonly provider?: string; readonly model?: string },
  sessionRoute: ReflectionRoute | undefined,
): ReflectionRoute | undefined {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  return sessionRoute
}

/**
 * Translate a terminal finish reason into a reflection-call failure.
 * @param finish - the assembler's terminal finish reason.
 * @returns the failure to throw, or `undefined` for a clean stop.
 */
export function finishFailure(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('memory-reflection: reflection output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('memory-reflection: reflection model unexpectedly requested a tool')
    default:
      return new Error(`memory-reflection: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}
