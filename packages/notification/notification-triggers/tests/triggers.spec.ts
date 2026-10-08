/**
 * Behavior of the alert-raising rules: each watched host signal raises the
 * documented alert with its threshold honored, every switch silences its rule,
 * and an undeliverable alert is logged instead of failing the signal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import { GoalId } from '@deepseek-ai/dsh-goal'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import Notification, { type NotificationProvider, type NotificationRequest } from '@deepseek-ai/dsh-notification'
import { ScheduleId } from '@deepseek-ai/dsh-schedule'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import { apply, type Config } from '../src/index.ts'

/** Disposers for every mounted Context, run after each test. */
const disposers: Array<() => Promise<void>> = []

beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
  vi.useRealTimers()
})

/**
 * Mount the notification seam, an optional recording provider, and the
 * triggers plugin on a fresh root Context.
 * @param config - plugin configuration; omission exercises the schema defaults.
 * @param withProvider - whether a provider reserves the seam.
 * @returns the Context and every alert a provider received.
 */
async function mount(config?: Config, withProvider = true): Promise<{ ctx: Context; seen: NotificationRequest[] }> {
  const ctx = new Context()
  await ctx.plugin(Notification)
  const seen: NotificationRequest[] = []
  if (withProvider) {
    const provider: NotificationProvider = {
      id: 'recording',
      notify(request) {
        seen.push(request)
        return Promise.resolve()
      },
    }
    ctx.notification.registerProvider(provider)
  }
  const fiber = await ctx.plugin(Object.assign(
    (inner: Context) => { apply(inner, config) },
    { inject: ['notification'] },
  ))
  disposers.push(() => fiber.dispose())
  return { ctx, seen }
}

/** Let the microtask chain of a raise settle before assertions. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** Stand-in for one Agent identity; approval rules read only its `id`. */
function stubAgent(id: string): Agent {
  return { id: SessionId(id) } as Agent
}

describe('alert-raising rules', () => {
  it('raises an approval alert after the configured wait, tagged with the tool call', async () => {
    const { ctx, seen } = await mount({ approvalWaitSeconds: 1 })
    const agent = stubAgent('approval-call')
    const request: ApprovalRequestEvent = { agent, toolName: 'bash', callId: ToolCallId('call-1') }
    // A decision that never arrives keeps the waterfall open while the timer runs.
    void ctx.waterfall(
      scopeTarget(agent, agent), 'approval/request', request, () => new Promise<ApprovalOutcome>(() => {}),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    expect(seen).toEqual([{
      title: 'Approval is waiting',
      body: '"bash" has been waiting for a decision for over 1 seconds',
      tag: 'approval:call-1',
    }])
  })

  it('tags an approval alert by the Agent when the call id is absent', async () => {
    const { ctx, seen } = await mount({ approvalWaitSeconds: 1 })
    const agent = stubAgent('approval-uncalled')
    const request: ApprovalRequestEvent = { agent, toolName: 'read' }
    void ctx.waterfall(
      scopeTarget(agent, agent), 'approval/request', request, () => new Promise<ApprovalOutcome>(() => {}),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    expect(seen).toEqual([{
      title: 'Approval is waiting',
      body: '"read" has been waiting for a decision for over 1 seconds',
      tag: 'approval:approval-uncalled',
    }])
  })

  it('stays silent when the decision arrives before the wait elapses', async () => {
    const { ctx, seen } = await mount({ approvalWaitSeconds: 60 })
    const agent = stubAgent('approval-fast')
    const request: ApprovalRequestEvent = { agent, toolName: 'bash' }
    await expect(ctx.waterfall(
      scopeTarget(agent, agent), 'approval/request', request, () => Promise.resolve<ApprovalOutcome>('allowed-once'),
    )).resolves.toBe('allowed-once')
    // The answered request cleared its timer, so the elapsed budget raises nothing.
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(seen).toEqual([])
  })

  it('raises a completion alert only for a turn at or above the configured minimum', async () => {
    const { ctx, seen } = await mount({ turnCompleteMinSeconds: 60 })
    const sessionId = SessionId('long-turn')
    ctx.emit('api-session/status', sessionId, true)
    await vi.advanceTimersByTimeAsync(65_000)
    ctx.emit('api-session/status', sessionId, false)
    await settle()
    expect(seen).toEqual([{
      title: 'Turn finished',
      body: 'Session long-turn finished a turn that ran for 65 seconds',
      tag: 'turn:long-turn',
    }])
  })

  it('stays silent for a short turn and for a completion without a recorded start', async () => {
    const { ctx, seen } = await mount({ turnCompleteMinSeconds: 60 })
    const sessionId = SessionId('short-turn')
    ctx.emit('api-session/status', sessionId, true)
    await vi.advanceTimersByTimeAsync(5_000)
    ctx.emit('api-session/status', sessionId, false)
    ctx.emit('api-session/status', SessionId('never-started'), false)
    await settle()
    expect(seen).toEqual([])
  })

  it('drops a removed Session so its later completion stays silent', async () => {
    const { ctx, seen } = await mount({ turnCompleteMinSeconds: 0 })
    const sessionId = SessionId('removed-turn')
    ctx.emit('api-session/status', sessionId, true)
    await vi.advanceTimersByTimeAsync(5_000)
    ctx.emit('api-session/removed', sessionId)
    ctx.emit('api-session/status', sessionId, false)
    await settle()
    expect(seen).toEqual([])
  })

  it('raises a reminder alert for a delivered scheduled task', async () => {
    const { ctx, seen } = await mount()
    ctx.emit('schedule/delivered', {
      sessionId: SessionId('receipt'),
      id: ScheduleId('sch-1'),
      title: 'Standup',
      deliveredAt: '2026-09-27T00:00:00.000Z',
    })
    await settle()
    expect(seen).toEqual([{ title: 'Reminder delivered', body: 'Standup', tag: 'schedule:sch-1' }])
  })

  it('stays silent for deliveries when the scheduled switch is off', async () => {
    const { ctx, seen } = await mount({ notifyScheduled: false })
    ctx.emit('schedule/delivered', {
      sessionId: SessionId('receipt-off'),
      id: ScheduleId('sch-2'),
      title: 'Standup',
      deliveredAt: '2026-09-27T00:00:00.000Z',
    })
    await settle()
    expect(seen).toEqual([])
  })

  it('raises a goal alert only when activation becomes armed', async () => {
    const { ctx, seen } = await mount()
    ctx.emit('goal/activation-changed', {
      sessionId: SessionId('goal-armed'),
      goal: { id: GoalId('goal-1'), revision: 1, activation: 'armed' },
    })
    ctx.emit('goal/activation-changed', {
      sessionId: SessionId('goal-disarmed'),
      goal: { id: GoalId('goal-2'), revision: 2, activation: 'disarmed' },
    })
    ctx.emit('goal/activation-changed', { sessionId: SessionId('goal-cleared') })
    await settle()
    expect(seen).toEqual([{
      title: 'Goal armed',
      body: 'Session goal-armed armed a goal that will continue automatically',
      tag: 'goal:goal-armed',
    }])
  })

  it('stays silent for goal transitions when the activation switch is off', async () => {
    const { ctx, seen } = await mount({ notifyGoalActivation: false })
    ctx.emit('goal/activation-changed', {
      sessionId: SessionId('goal-off'),
      goal: { id: GoalId('goal-3'), revision: 1, activation: 'armed' },
    })
    await settle()
    expect(seen).toEqual([])
  })

  it('logs a failed alert instead of failing the signal when no provider is registered', async () => {
    const { ctx } = await mount(undefined, false)
    const warn = vi.spyOn(ctx.logger, 'warn')
    ctx.emit('goal/activation-changed', {
      sessionId: SessionId('orphan'),
      goal: { id: GoalId('goal-4'), revision: 1, activation: 'armed' },
    })
    await settle()
    expect(warn).toHaveBeenCalledWith(
      'notification-triggers: alert was not delivered: NotificationError: no notification provider is registered',
    )
  })
})
