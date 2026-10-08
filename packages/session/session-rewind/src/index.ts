/**
 * Per-turn file-tool rewind: before a file tool first changes a path in a
 * turn, its pre-turn content is captured content-addressed under the Session's
 * temporary directory. A model-facing `workspace_rewind` tool reproduces one
 * turn's pre-turn state — stored copies are written back, paths absent before
 * the turn are deleted — and the `sessionRewind` service serves the same to
 * the Host. Nothing is appended to the Session log: captures stay on the
 * Host, and the restore is already recorded as its own tool call and result.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-session-rewind
 */
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionRewindStore } from './store.ts'
import type { RewindOutcome, SessionRewind } from './types.ts'

export type { RewindOutcome, RewindSkippedPath, RewindSummary, SessionRewind } from './types.ts'
export { SessionRewindStore } from './store.ts'

/** Stable Loader identity. */
export const name = 'session-rewind'

/** Services used to register the restore tool. */
export const inject = ['tools']

/** Capture and restore bounds. Invalid values fail plugin load. */
export interface Config {
  /** Inclusive byte cap on a stored pre-turn copy; a larger file is skipped by a restore (default 2 MiB). */
  maxFileBytes: number
  /** Maximum paths one turn's checkpoint captures (default 200). */
  maxPaths: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  maxFileBytes: z.number().default(2 * 1024 * 1024),
  maxPaths: z.number().default(200),
})

/** The outcome shape of `workspace_rewind`. */
const REWIND_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['ok', 'unknown_turn', 'unavailable'] },
    turn: { type: 'number' },
    restored: { type: 'array', items: { type: 'string' } },
    removed: { type: 'array', items: { type: 'string' } },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          reason: { type: 'string', required: true, enum: ['oversized', 'unwritable'] },
        },
      },
    },
  },
} as const

function eligible(session: Session): string | undefined {
  const { cwd, origin, delegationDepth } = session.header
  return origin === 'subagent' || (delegationDepth ?? 0) > 0 ? undefined : cwd
}

/** Actionable text per `workspace_rewind` status. */
function rewindResultText(
  status: 'ok' | 'unknown_turn' | 'unavailable',
  outcome: RewindOutcome | undefined,
): string {
  if (status === 'unavailable') {
    return 'Rewind is not available for this call: no session context carries a rewind record.'
  }
  if (status === 'unknown_turn') {
    return 'No rewind record exists for that turn in this session. Use the turn numbers from earlier file-tool turns; records exist only for turns whose file tools changed files in this Host process.'
  }
  const parts: string[] = []
  if (outcome !== undefined) {
    if (outcome.restored.length > 0) parts.push(`restored: ${outcome.restored.join(', ')}`)
    if (outcome.removed.length > 0) parts.push(`deleted (created during the turn): ${outcome.removed.join(', ')}`)
    if (outcome.skipped.length > 0) {
      parts.push(`skipped: ${outcome.skipped.map(item => `${item.path} (${item.reason})`).join(', ')}`)
    }
  }
  return parts.length > 0
    ? `Workspace restored to the state before that turn. ${parts.join('; ')}.`
    : 'Workspace restored to the state before that turn.'
}

/**
 * Capture every top-level turn's file-tool mutations and serve
 * `workspace_rewind` and the `sessionRewind` service.
 * @param ctx - host context with `tools`.
 * @param config - validated bounds.
 */
export function apply(ctx: Context, config: Config): void {
  for (const [field, value] of [
    ['maxFileBytes', config.maxFileBytes], ['maxPaths', config.maxPaths],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`session-rewind requires a positive integer ${field}`)
  }
  const lifetime = new AbortController()
  const stores = new Map<Session, SessionRewindStore>()
  const byId = new Map<SessionId, SessionRewindStore>()
  const forget = (session: Session): Promise<void> => {
    const store = stores.get(session)
    stores.delete(session)
    byId.delete(session.id)
    return store?.dispose() ?? Promise.resolve()
  }
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.all([...stores.keys()].map(forget))
  })
  const service: SessionRewind = {
    list: sessionId => byId.get(sessionId)?.list() ?? [],
    restore: (sessionId, turn, signal) =>
      byId.get(sessionId)?.restore(turn, signal ?? new AbortController().signal) ?? Promise.resolve(undefined),
  }
  ctx.provide('sessionRewind', service)
  const storeFor = (session: Session, cwd: string): SessionRewindStore => {
    let store = stores.get(session)
    if (store === undefined) {
      store = new SessionRewindStore(cwd, {
        tempRoot: tmpdir(), maxFileBytes: config.maxFileBytes, maxPaths: config.maxPaths,
        warn: (message) => { ctx.logger.warn(message) },
      })
      stores.set(session, store)
      byId.set(session.id, store)
    }
    return store
  }
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/start') return
    const cwd = eligible(session)
    if (cwd !== undefined) storeFor(session, cwd).start(event.data.turn)
  })
  ctx.on('session/disposed', (session) => { void forget(session) })
  ctx.on('tools/pre-execute', async (exec, next) => {
    const session = exec.agent?.session
    const store = session === undefined ? undefined : stores.get(session)
    if (store !== undefined) {
      store.capture(exec.name, exec.arguments)
      await store.settled()
    }
    return next()
  })
  ctx.tools.register(defineTool({
    name: 'workspace_rewind',
    description:
      'Restore the workspace files this session\'s file tools changed during one turn to their content before that turn: ' +
      'edited files are written back, files created during the turn are deleted, and files a rewind record could not cover ' +
      '(larger than the capture cap) are skipped and reported. turn is the turn number whose pre-turn state to reproduce. ' +
      'A covered path is overwritten even if later turns edited it again, so confirm with the user before rewinding a past turn. ' +
      'Edits made through shell commands are never captured and never restored. Returns an unknown_turn answer when no ' +
      'record exists for that turn; rewind records live only as long as their session in this Host process.',
    parameters: {
      turn: { type: 'number', required: true, description: 'The turn whose pre-turn state to reproduce.' },
    },
    output: {
      schema: REWIND_OUTPUT_SCHEMA,
      render: (_args, value) => [
        {
          type: 'text',
          text: value.status === 'ok'
            ? rewindResultText('ok', {
              turn: value.turn ?? 0,
              restored: value.restored ?? [],
              removed: value.removed ?? [],
              skipped: value.skipped ?? [],
            })
            : rewindResultText(value.status, undefined),
        },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const turn = typeof args.turn === 'number' && Number.isInteger(args.turn) && args.turn >= 0 ? args.turn : undefined
      if (turn === undefined) throw new Error('workspace_rewind requires a non-negative integer turn')
      const session = exec.agent?.session
      if (session === undefined) return { status: 'unavailable' as const }
      const outcome = await ctx.sessionRewind.restore(session.id, turn, exec.signal)
      if (outcome === undefined) return { status: 'unknown_turn' as const }
      return { status: 'ok' as const, ...outcome }
    },
    presentCall: args => ({
      card: 'generic' as const,
      kind: 'other' as const,
      title: `Rewind workspace: turn ${String(typeof args.turn === 'number' ? args.turn : '?')}`,
    }),
  }))
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provided by {@link apply}; typed in `./types.ts`. */
    sessionRewind: SessionRewind
  }
}
