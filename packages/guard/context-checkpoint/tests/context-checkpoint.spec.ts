import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ContextCheckpoint from '@deepseek-ai/dsh-context-checkpoint'
import type { Config } from '@deepseek-ai/dsh-context-checkpoint'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test': { kind: 'test' } & ContextFormed
  }
}

const PIN_TEXT = 'Pinned constraint: every query must filter by tenant id before it reaches storage.'

/**
 * Behavior suite for the pinned-context checkpoint guard: presence detection
 * over the step's entered messages, seen-then-lost reminder delivery,
 * presence-based suppression (and re-arm when the reminder is itself
 * compacted away), never-seen silence, reject pass-through, and fail-loud
 * config validation — loop-driven where the full context flows, and
 * pre-step-waterfall-driven where the message series must be controlled.
 */

/** Boot the core spine + the guard; the caller registers adapters. */
async function harness(config: Config): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ContextCheckpoint, config)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

/** Every injected checkpoint reminder in the agent's log, flattened to text + source for terse assertions. */
function checkpointReminders(agent: Agent): { text: string; source: unknown }[] {
  return agent.session.snapshotEvents()
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind === 'context-checkpoint')
    .map(e => ({
      text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: e.data.source,
    }))
}

/** Run one pre-step waterfall against the real agent with a controlled message series. */
async function preStep(ctx: Context, agent: Agent, messages: readonly unknown[]): Promise<PreStepDecision> {
  return ctx.waterfall('agent/pre-step', { agent, messages } as never, () => Promise.resolve({ kind: 'enter' as const, messages } as never))
}

const testMessage = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'test' } })

describe('presence detection', () => {
  it('never reminds while the pinned text stays in context', async () => {
    const ctx = await harness({ pins: [{ label: 'tenant filter', text: PIN_TEXT }] })
    const adapter = new MockAdapter([textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: `Follow this. ${PIN_TEXT}` }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(checkpointReminders(agent)).toHaveLength(0)
  })

  it('reminds once when a seen pin leaves the context, naming the lost label', async () => {
    const ctx = await harness({ pins: [{ label: 'tenant filter', text: PIN_TEXT }] })
    const agent = await ctx.agentLoop.create(SessionId('a2'), { provider: 'mock', model: 'mock' })
    const withPin = [testMessage(`plan. ${PIN_TEXT}`)]
    const withoutPin = [testMessage('plan.')]

    const seen = await preStep(ctx, agent, withPin)
    expect(seen).toEqual({ kind: 'enter', messages: withPin })

    const lost = await preStep(ctx, agent, withoutPin)
    if (lost.kind !== 'enter') throw new Error('expected an enter decision')
    expect(lost.messages).toHaveLength(2)
    expect(lost.messages[1]!.source).toMatchObject({ kind: 'context-checkpoint', form: 'notice', summary: 'tenant filter' })
    expect(lost.messages[1]!.content).toEqual([{
      type: 'text',
      text: 'Pinned context (tenant filter) is no longer present in the conversation — an earlier compaction or prune removed it. '
        + 'Do not act on remembered content you can no longer see: re-read or re-obtain the source before continuing work that depends on it.',
    }])
  })

  it('stays quiet while its own reminder survives, and re-reminds once it is compacted away too', async () => {
    const ctx = await harness({ pins: [{ label: 'tenant filter', text: PIN_TEXT }] })
    const agent = await ctx.agentLoop.create(SessionId('a3'), { provider: 'mock', model: 'mock' })
    const withPin = [testMessage(`plan. ${PIN_TEXT}`)]
    const withoutPin = [testMessage('plan.')]

    await preStep(ctx, agent, withPin)
    const lost = await preStep(ctx, agent, withoutPin)
    if (lost.kind !== 'enter') throw new Error('expected an enter decision')
    const reminded = [testMessage('plan.'), lost.messages[1]!]

    const suppressed = await preStep(ctx, agent, reminded)
    expect(suppressed).toEqual({ kind: 'enter', messages: reminded })

    const reReminded = await preStep(ctx, agent, withoutPin)
    if (reReminded.kind !== 'enter') throw new Error('expected an enter decision')
    expect(reReminded.messages).toHaveLength(2)
    expect(reReminded.messages[1]!.source).toMatchObject({ kind: 'context-checkpoint' })
  })

  it('does not remind for a pin the context never carried', async () => {
    const ctx = await harness({ pins: [{ label: 'tenant filter', text: PIN_TEXT }] })
    const agent = await ctx.agentLoop.create(SessionId('a4'), { provider: 'mock', model: 'mock' })
    const messages = [testMessage('no pin here')]

    const decision = await preStep(ctx, agent, messages)
    expect(decision).toEqual({ kind: 'enter', messages })
  })

  it('marks a pin seen again when its text returns, resetting the reminder cycle', async () => {
    const ctx = await harness({ pins: [{ label: 'tenant filter', text: PIN_TEXT }] })
    const agent = await ctx.agentLoop.create(SessionId('a5'), { provider: 'mock', model: 'mock' })
    const withPin = [testMessage(`plan. ${PIN_TEXT}`)]
    const withoutPin = [testMessage('plan.')]

    await preStep(ctx, agent, withPin)
    const lost = await preStep(ctx, agent, withoutPin)
    if (lost.kind !== 'enter') throw new Error('expected an enter decision')
    await preStep(ctx, agent, [testMessage(`back. ${PIN_TEXT}`)])

    const lostAgain = await preStep(ctx, agent, withoutPin)
    if (lostAgain.kind !== 'enter') throw new Error('expected an enter decision')
    expect(lostAgain.messages).toHaveLength(2)
    expect(lostAgain.messages[1]!.source).toMatchObject({ kind: 'context-checkpoint' })
  })
})

describe('decision pass-through', () => {
  it('passes a rejected pre-step decision through untouched', async () => {
    const ctx = await harness({ pins: [{ label: 'tenant filter', text: PIN_TEXT }] })
    const agent = await ctx.agentLoop.create(SessionId('a6'), { provider: 'mock', model: 'mock' })
    await ctx.waterfall('agent/pre-step', { agent, messages: [testMessage(`plan. ${PIN_TEXT}`)] } as never, () => Promise.resolve({ kind: 'enter' as const, messages: [testMessage(`plan. ${PIN_TEXT}`)] }))

    const decision = await ctx.waterfall('agent/pre-step', { agent, messages: [testMessage('plan.')] } as never, () => Promise.resolve({ kind: 'reject' as const } as never))
    expect(decision).toEqual({ kind: 'reject' })
  })
})

describe('fail-loud configuration', () => {
  it('rejects an empty pin list at load', async () => {
    await expect(harness({ pins: [] })).rejects.toThrow('`pins` must list at least one pinned text')
  })

  it('rejects an empty pin text at load', async () => {
    await expect(harness({ pins: [{ label: 'a', text: '   ' }] })).rejects.toThrow('has an empty text')
  })

  it('rejects duplicate pin labels at load', async () => {
    await expect(harness({ pins: [{ label: 'a', text: 'x' }, { label: 'a', text: 'y' }] })).rejects.toThrow('duplicate pin label "a"')
  })
})
