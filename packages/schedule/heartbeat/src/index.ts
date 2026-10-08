/**
 * Heartbeat patrol: two model-facing tools that manage one recurring Schedule
 * reminder per session. Each heartbeat delivery reads the heartbeat file in
 * the workspace and acts on its pending items; a file with nothing pending is
 * answered with `HEARTBEAT_OK` and nothing else. The reminder prompt carries
 * the whole semantic, so the session log reconstructs every model-visible
 * input from ordinary Schedule deliveries.
 * @module @deepseek-ai/dsh-heartbeat
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MIN_EVERY_INTERVAL_SECONDS, ScheduleInputError } from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-schedule'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'heartbeat'
export const inject = ['schedule', 'tools']

/** Title stored on every heartbeat task, shown on the task card and lists. */
const HEARTBEAT_TITLE = 'Heartbeat'

/** Prompt prefix that identifies a heartbeat task among the session's reminders. */
const HEARTBEAT_MARK = '[HEARTBEAT]'

/** Reply the model produces when the heartbeat file has nothing pending. */
const HEARTBEAT_ACK = 'HEARTBEAT_OK'

/** Largest allowed heartbeat interval, in seconds: one week. */
const MAX_CONFIG_INTERVAL_SECONDS = 604_800

/** Default heartbeat interval applied when the deployment states none, in seconds. */
const DEFAULT_INTERVAL_SECONDS = 1800

/** Default deployment-wide heartbeat interval cap, in seconds. */
const DEFAULT_MAX_INTERVAL_SECONDS = 86_400

/** Default heartbeat file path inside the workspace. */
const DEFAULT_HEARTBEAT_PATH = 'HEARTBEAT.md'

/** Model-facing heartbeat tool configuration. */
export interface Config {
  /**
   * Heartbeat interval used when `heartbeat_enable` omits `interval_seconds`,
   * in whole seconds; omission defaults to 1800 (half an hour).
   */
  defaultIntervalSeconds?: number
  /** Largest interval `heartbeat_enable` accepts, in whole seconds; omission defaults to 86400 (one day). */
  maxIntervalSeconds?: number
  /** Workspace-relative heartbeat file path the reminder text names; omission defaults to `HEARTBEAT.md`. */
  heartbeatPath?: string
}

/** Schemastery configuration for the heartbeat tool plugin. */
export const Config: z<Config> = z.object({
  defaultIntervalSeconds: z.number().step(1).min(MIN_EVERY_INTERVAL_SECONDS).max(MAX_CONFIG_INTERVAL_SECONDS)
    .default(DEFAULT_INTERVAL_SECONDS),
  maxIntervalSeconds: z.number().step(1).min(MIN_EVERY_INTERVAL_SECONDS).max(MAX_CONFIG_INTERVAL_SECONDS)
    .default(DEFAULT_MAX_INTERVAL_SECONDS),
  heartbeatPath: z.string().default(DEFAULT_HEARTBEAT_PATH),
})

/**
 * Validate the deployment-varying heartbeat file path and the interval pair.
 * A workspace-relative path keeps the reminder inside the operator's tree;
 * an absolute path or a parent escape would point the patrol outside it.
 * @param config - Resolved plugin configuration.
 * @throws When the path is absolute, escapes the workspace, or the default interval exceeds the cap.
 */
export function assertConfig(config: Config): void {
  const path = config.heartbeatPath ?? DEFAULT_HEARTBEAT_PATH
  if (path === '' || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path) || path.includes('\\')
    || path.split('/').some(segment => segment === '..')) {
    throw new Error('heartbeat: heartbeatPath must be a workspace-relative path without parent segments')
  }
  if ((config.defaultIntervalSeconds ?? DEFAULT_INTERVAL_SECONDS) > (config.maxIntervalSeconds ?? DEFAULT_MAX_INTERVAL_SECONDS)) {
    throw new Error('heartbeat: defaultIntervalSeconds must not exceed maxIntervalSeconds')
  }
}

/**
 * Build the reminder prompt one heartbeat delivery presents: the fixed
 * framing names the file, the patrol duty, the file-update duty, and the
 * exact nothing-pending reply.
 * @param path - Workspace-relative heartbeat file path.
 * @returns The prompt stored on the recurring task.
 */
export function heartbeatPrompt(path: string): string {
  return `${HEARTBEAT_MARK}\nPeriodic heartbeat patrol. Read ${path} in the workspace and act on its pending items; `
    + 'after handling them, update the file so completed items are recorded. '
    + `If the file is missing or lists nothing pending, reply exactly ${HEARTBEAT_ACK} and do nothing else.`
}

const ENABLE_DESCRIPTION =
  'Start the heartbeat patrol in this session: a recurring reminder is created so this session periodically receives '
  + 'a heartbeat that reads the heartbeat file (HEARTBEAT.md by default) and acts on its pending items. '
  + 'One patrol per session; call heartbeat_disable first to change the interval.'

const DISABLE_DESCRIPTION =
  'Stop the heartbeat patrol in this session by deleting its recurring reminder. '
  + 'A heartbeat reminder that is already delivered is not retracted.'

/** Enable result: the stored task id, the effective interval, and the watched path. */
interface HeartbeatEnableValue {
  id: string
  interval_seconds: number
  path: string
}

/** Disable result: how many heartbeat tasks were removed and their ids. */
interface HeartbeatDisableValue {
  deleted: number
  ids: string[]
}

/** One non-mutating tool failure. */
interface HeartbeatToolError {
  code: 'invalid_rule' | 'frequency_too_high' | 'heartbeat_already_enabled' | 'heartbeat_not_enabled' | 'internal_error'
  message: string
}

const ENABLE_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        interval_seconds: { type: 'integer', required: true },
        path: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
    },
  ],
} as const

const DISABLE_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        deleted: { type: 'integer', required: true },
        ids: { type: 'array', required: true, items: { type: 'string' } },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
    },
  ],
} as const

/** Deterministic model content for every heartbeat value. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  // The ToolRuntime has already validated the value against the lossless-JSON output schema.
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Pure generic pending card. */
function present(title: string, kind: 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Stable error for failures not safe to expose. */
function internalError(): HeartbeatToolError {
  return { code: 'internal_error', message: 'The heartbeat operation failed.' }
}

/** Translate Schedule input failures while withholding internal storage failures. */
function operationError(error: unknown): HeartbeatToolError {
  return error instanceof ScheduleInputError ? { code: error.code as HeartbeatToolError['code'], message: error.message } : internalError()
}

/**
 * Register the two heartbeat tools in the host tool registry; every call binds
 * to the calling agent's session through the execution context.
 * @param ctx - Host context owning the Schedule service and the tool registry.
 * @param config - Resolved plugin configuration.
 * @returns Idempotent aggregate disposer for both registrations.
 */
export function apply(ctx: Context, config: Config): () => void {
  assertConfig(config)
  const defaultInterval = config.defaultIntervalSeconds ?? DEFAULT_INTERVAL_SECONDS
  const maxInterval = config.maxIntervalSeconds ?? DEFAULT_MAX_INTERVAL_SECONDS
  const path = config.heartbeatPath ?? DEFAULT_HEARTBEAT_PATH
  const disposers: Array<() => void> = []

  try {
    disposers.push(ctx.tools.register(defineTool({
      name: 'heartbeat_enable',
      description: ENABLE_DESCRIPTION,
      parameters: {
        interval_seconds: {
          type: 'number',
          description: 'Heartbeat interval in whole seconds, at least 60. Omission uses the deployment default.',
        },
      },
      output: { schema: ENABLE_OUTPUT_SCHEMA, render: renderValue },
      async execute(args, exec): Promise<HeartbeatEnableValue | HeartbeatToolError> {
        if (exec.agent === undefined || exec.signal.aborted) return internalError()
        const interval = args.interval_seconds ?? defaultInterval
        if (!Number.isSafeInteger(interval)) {
          return { code: 'invalid_rule', message: 'interval_seconds must be a safe integer.' }
        }
        if (interval < MIN_EVERY_INTERVAL_SECONDS || interval > maxInterval) {
          return {
            code: 'frequency_too_high',
            message: `interval_seconds must be from ${MIN_EVERY_INTERVAL_SECONDS} through ${maxInterval}.`,
          }
        }
        const sessionId = exec.agent.session.id
        try {
          const existing = (await ctx.schedule.list({ sessionId }))
            .find(record => record.prompt.startsWith(HEARTBEAT_MARK))
          if (existing !== undefined) {
            return {
              code: 'heartbeat_already_enabled',
              message: `The heartbeat patrol is already enabled in this session (${existing.id}); disable it first.`,
            }
          }
          const record = await ctx.schedule.create(sessionId, {
            prompt: heartbeatPrompt(path),
            title: HEARTBEAT_TITLE,
            every_seconds: interval,
          }, exec.signal)
          return { id: record.id, interval_seconds: interval, path }
        } catch (error: unknown) {
          return operationError(error)
        }
      },
      presentCall: args => present('Start heartbeat patrol', 'other', args.interval_seconds),
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'heartbeat_disable',
      description: DISABLE_DESCRIPTION,
      parameters: {},
      output: { schema: DISABLE_OUTPUT_SCHEMA, render: renderValue },
      async execute(_args, exec): Promise<HeartbeatDisableValue | HeartbeatToolError> {
        if (exec.agent === undefined || exec.signal.aborted) return internalError()
        const sessionId = exec.agent.session.id
        try {
          const own = (await ctx.schedule.list({ sessionId }))
            .filter(record => record.prompt.startsWith(HEARTBEAT_MARK))
          if (own.length === 0) {
            return { code: 'heartbeat_not_enabled', message: 'The heartbeat patrol is not enabled in this session.' }
          }
          const ids: string[] = []
          for (const record of own) {
            const result = await ctx.schedule.delete({ sessionId, id: record.id }, exec.signal)
            if (result.deleted) ids.push(record.id)
          }
          return { deleted: ids.length, ids }
        } catch (error: unknown) {
          return operationError(error)
        }
      },
      presentCall: () => present('Stop heartbeat patrol', 'other'),
    })))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }

  let active = true
  return () => {
    if (!active) return
    active = false
    for (const dispose of disposers.reverse()) dispose()
  }
}

/** Cordis plugin entry: the heartbeat tools with their validated configuration. */
export default { name, inject, Config, apply }
