/**
 * Alert-raising rules for `ctx.notification`. One plugin instance watches four
 * host signals — an approval waiting past a threshold, a long turn finishing,
 * a scheduled reminder being delivered, and a goal becoming armed — and hands
 * each one to the seam as a provider-agnostic alert. Every rule is a
 * configurable switch or threshold, and a failed alert is logged rather than
 * failing the host operation that raised it.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-notification-triggers
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { NotificationRequest } from '@deepseek-ai/dsh-notification'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-goal/types'
import type {} from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-user-approval/types'

/** Cordis plugin name for loader diagnostics. */
export const name = 'notification-triggers'

/** Services required by this plugin. */
export const inject = ['notification']

/** Default seconds an approval may wait before the operator is reminded. */
export const DEFAULT_APPROVAL_WAIT_SECONDS = 60

/** Default seconds a turn must run before its completion raises an alert. */
export const DEFAULT_TURN_COMPLETE_MIN_SECONDS = 30

/** Configuration for the alert-raising rules; every field has a stated default. */
export interface Config {
  /** Seconds an approval may wait before an alert is raised. Defaults to 60. */
  approvalWaitSeconds?: number
  /** Seconds a turn must run before its completion raises an alert; shorter turns stay silent. Defaults to 30. */
  turnCompleteMinSeconds?: number
  /** Whether a delivered scheduled reminder raises an alert. Defaults to true. */
  notifyScheduled?: boolean
  /** Whether a goal becoming armed raises an alert. Defaults to true. */
  notifyGoalActivation?: boolean
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  approvalWaitSeconds: z.number().step(1).min(1).default(DEFAULT_APPROVAL_WAIT_SECONDS),
  turnCompleteMinSeconds: z.number().step(1).min(0).default(DEFAULT_TURN_COMPLETE_MIN_SECONDS),
  notifyScheduled: z.boolean().default(true),
  notifyGoalActivation: z.boolean().default(true),
})

/**
 * Watch the host signals and raise alerts through `ctx.notification`.
 * @param ctx - the plugin context (must inject `notification`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Direct apply() calls bypass schema defaulting; normalize here so no rule
  // ever sees an absent threshold or switch.
  const approvalWaitSeconds = config.approvalWaitSeconds ?? DEFAULT_APPROVAL_WAIT_SECONDS
  const turnCompleteMinSeconds = config.turnCompleteMinSeconds ?? DEFAULT_TURN_COMPLETE_MIN_SECONDS
  const notifyScheduled = config.notifyScheduled ?? true
  const notifyGoalActivation = config.notifyGoalActivation ?? true

  const raise = (request: NotificationRequest): void => {
    // Alerts are best-effort: a failed or unclaimed alert must never fail the
    // host operation that raised it.
    void ctx.notification.notify(request).catch((error: unknown) => {
      ctx.logger.warn(`notification-triggers: alert was not delivered: ${String(error)}`)
    })
  }

  // Pending approvals: one timer per in-flight decision, cleared as soon as the
  // answerer chain returns one.
  ctx.on('approval/request', async (request, next) => {
    const timer = setTimeout(() => {
      raise({
        title: 'Approval is waiting',
        body: `"${request.toolName}" has been waiting for a decision for over ${approvalWaitSeconds} seconds`,
        tag: `approval:${request.callId ?? request.agent.id}`,
      })
    }, approvalWaitSeconds * 1000)
    timer.unref()
    try {
      return await next()
    } finally {
      clearTimeout(timer)
    }
  })

  // Long turns: start-time tracking per Session; `removed` drops the entry so a
  // closed Session never leaks one.
  const turnStartedAt = new Map<SessionId, number>()
  ctx.on('api-session/status', (sessionId, running) => {
    if (running) {
      turnStartedAt.set(sessionId, Date.now())
      return
    }
    const startedAt = turnStartedAt.get(sessionId)
    turnStartedAt.delete(sessionId)
    if (startedAt === undefined) return
    const seconds = Math.round((Date.now() - startedAt) / 1000)
    if (seconds < turnCompleteMinSeconds) return
    raise({
      title: 'Turn finished',
      body: `Session ${sessionId} finished a turn that ran for ${seconds} seconds`,
      tag: `turn:${sessionId}`,
    })
  })
  ctx.on('api-session/removed', (sessionId) => {
    turnStartedAt.delete(sessionId)
  })

  ctx.on('schedule/delivered', (payload) => {
    if (!notifyScheduled) return
    raise({
      title: 'Reminder delivered',
      body: payload.title,
      tag: `schedule:${payload.id}`,
    })
  })

  ctx.on('goal/activation-changed', (payload) => {
    if (!notifyGoalActivation) return
    if (payload.goal?.activation !== 'armed') return
    raise({
      title: 'Goal armed',
      body: `Session ${payload.sessionId} armed a goal that will continue automatically`,
      tag: `goal:${payload.sessionId}`,
    })
  })
}
