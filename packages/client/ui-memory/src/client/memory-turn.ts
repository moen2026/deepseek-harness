/**
 * Turn-scoped remembered-memory projection for the `memory_write` card.
 *
 * This Definition publishes the memories a settled call wrote against its
 * Turn, so the card renders as a turn-level element through ui-chat's
 * `conversation.chat.turnTail` list seat. Each entry is narrowed from the
 * persisted result JSON and the call arguments, so Session-log replay
 * reproduces the card with no Host change and no presentation metadata. The
 * call's own Tool-group cell belongs to ui-tool's generic keyed tool view, so
 * this package contributes only the Turn-level card.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type {
  ConversationNodeDefinition, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MemoryNamespace } from '@deepseek-ai/dsh-memory/client'

/** Wire Tool name whose settled result carries one written memory. */
export const MEMORY_WRITE_TOOL = 'memory_write'

/** One settled `memory_write` write the card renders. */
export interface MemoryRemembered {
  /** The call that wrote this memory. */
  readonly callId: string
  /** Sequence of the settled result; the Turn's own end bounds what it owns. */
  readonly seq: number
  /** Provider-assigned memory identity from the settled result. */
  readonly id: string
  /** The remembered text, from the call's arguments. */
  readonly text: string
  /** Optional namespace from the call's arguments, when it is one of the known values. */
  readonly namespace?: MemoryNamespace
}

/** Immutable remembered-memory facts published against one Turn. */
export interface MemoryTurnData {
  readonly remembered: readonly MemoryRemembered[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** `memory_write` results settled in this Turn, in settlement order. */
    'memory-remembered': MemoryTurnData
  }
}

/**
 * Turn-tail owner currency this row reads: the closing Turn with its sequence.
 *
 * Structurally equal to ui-chat's `TurnTailOwnerProps`; the fields are named
 * locally so this package keeps its existing dependency set.
 */
export interface MemoryTurnOwner {
  readonly turn: TurnLocation
  readonly seq: number
}

/** One in-window root call head, kept to pair it with its result. */
interface MemoryCall {
  readonly name: string
  readonly argsRaw: string
}

interface MemoryTurnState {
  readonly turn: number
  readonly calls: ReadonlyMap<string, MemoryCall>
  readonly remembered: readonly MemoryRemembered[]
}

/** JSON document of one raw wire text, or undefined when the text is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // A streaming call's truncated JSON prefix and a manually edited Session
    // log both reach here; the card falls back instead of failing the render.
    return undefined
  }
}

/** Whether one wire value is a plain JSON object rather than an array or scalar. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Concatenated text of a settled result, or null when it is not exactly one text block. */
function resultText(content: readonly { readonly type: string; readonly text?: string }[]): string | null {
  const first = content[0]
  if (first === undefined || first.type !== 'text' || first.text === undefined || first.text === '') return null
  if (content.length !== 1) return null
  return first.text
}

/**
 * Narrow one settled `memory_write` result and its call arguments into the
 * card's entry, or undefined when either carries no complete write. Malformed
 * and failed results fall through: with no memory identity the Turn tail
 * renders no card.
 * @param callId - the call that settled.
 * @param message - the settling result message: its content blocks and error flag.
 * @param call - paired in-window call head.
 * @param seq - sequence of the settled result.
 * @returns the narrowed write, or undefined when it names no memory.
 */
export function memoryWriteEntry(
  callId: string,
  message: { readonly isError?: boolean; readonly content: readonly { readonly type: string; readonly text?: string }[] },
  call: MemoryCall,
  seq: number,
): MemoryRemembered | undefined {
  if (message.isError === true) return undefined
  const result = parseJson(resultText(message.content) ?? '')
  if (!isRecord(result) || result.status !== 'ok' || typeof result.id !== 'string' || result.id === '') return undefined
  const args = parseJson(call.argsRaw)
  if (!isRecord(args) || typeof args.text !== 'string' || args.text.trim() === '') return undefined
  const namespace = args.namespace === 'preference' || args.namespace === 'fact' || args.namespace === 'style'
    ? args.namespace
    : undefined
  return {
    callId,
    seq,
    id: result.id,
    text: args.text,
    ...(namespace === undefined ? {} : { namespace }),
  }
}

/**
 * Select the memories one Turn wrote, for the Turn-tail list entry to render.
 *
 * The bounded sequence is the Turn's own end, not the closing Assistant text: a
 * Turn whose last text response follows a `memory_write` settlement still owns
 * that write when it ends on a failed request or a user stop. A Turn without a
 * recorded end falls back to the owner's own sequence.
 * @param owner - Turn-tail owner currency for the closing Assistant.
 * @returns remembered memories, or null when the Turn wrote none.
 */
export function selectMemoryRemembered(owner: MemoryTurnOwner): MemoryTurnData | null {
  const data = owner.turn.data.get('memory-remembered')
  const remembered = data === undefined
    ? []
    : data.remembered.filter(entry => entry.seq <= (owner.turn.end?.seq ?? owner.seq))
  return remembered.length === 0 ? null : { remembered }
}

/** Turn-local `memory_write` accumulator; it publishes no view Node. */
export const memoryTurnDefinition: ConversationNodeDefinition<MemoryTurnState> = {
  kind: 'memory-remembered',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('memory-remembered start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), remembered: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), {
        name: match.event.data.name,
        argsRaw: match.event.data.arguments,
      })
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const callId = String(match.event.data.message.source.callId)
    const call = context.state.calls.get(callId)
    if (call?.name !== MEMORY_WRITE_TOOL) return context.state
    const entry = memoryWriteEntry(callId, match.event.data.message, call, match.event.seq)
    if (entry === undefined) return context.state
    return { ...context.state, remembered: [...context.state.remembered, entry] }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn'
      && previous.turn === context.state.turn
      && previous.key === 'memory-remembered'
      && previous.value.remembered === context.state.remembered) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'memory-remembered',
      value: { remembered: context.state.remembered },
    }
  },
}
