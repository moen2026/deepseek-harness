/**
 * Heartbeat tools: mount the real plugin over a real ToolRuntime with a
 * Schedule double, then call the tools through `ctx.tools.execute` so the
 * shipping `apply` registration and execution paths are exercised unmodified.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createEveryScheduleRecord, ScheduleId } from '@deepseek-ai/dsh-schedule'
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import heartbeat, { assertConfig, heartbeatPrompt } from '../src/index.ts'
import type { Config } from '../src/index.ts'

/** One stored task; built through the real constructor so the view stays truthful. */
function record(id: string, prompt: string): ScheduleRecord {
  return createEveryScheduleRecord(ScheduleId(id), prompt, 1800, Date.parse('2026-01-01T00:00:00.000Z'), 'Heartbeat')
}

/** Schedule double; only the members the tools call are materialized. */
interface ScheduleDouble {
  list: Mock<(request: { sessionId: SessionId }) => Promise<ScheduleRecord[]>>
  create: Mock<(sessionId: SessionId, request: Record<string, unknown>, signal?: AbortSignal) => Promise<ScheduleRecord>>
  delete: Mock<(request: { sessionId: SessionId; id: string }, signal?: AbortSignal) => Promise<{ id: string; deleted: boolean }>>
}

function scheduleDouble(overrides: Partial<ScheduleDouble> = {}): ScheduleDouble {
  return {
    list: vi.fn(async () => [] as ScheduleRecord[]),
    create: vi.fn(async (_sessionId: SessionId, request: Record<string, unknown>) =>
      record('schedule-1', typeof request.prompt === 'string' ? request.prompt : '')),
    delete: vi.fn(async (request: { sessionId: SessionId; id: string }) => ({ id: request.id, deleted: true })),
    ...overrides,
  }
}

/** A calling Agent backed by a real Session; the tool reads `agent.session.id`. */
function callingAgent(ctx: Context): Agent {
  const session = Session.create(SessionId('heartbeat'))
  return {
    id: session.id, session, ctx: ctx.extend(), options: {}, status: 'idle', inbox: unsupportedInbox(),
    followup() {}, send() {}, steer() {}, inject() {}, cancel() {},
    whenIdle: async () => {}, runMaintenance: operation => operation(new AbortController().signal),
  }
}

interface Test {
  ctx: Context
  agent: Agent
  schedule: ScheduleDouble
}

async function setup(config: Config = {}, schedule: ScheduleDouble = scheduleDouble()): Promise<Test> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('schedule', schedule as never)
  await ctx.plugin(heartbeat, config)
  return { ctx, agent: callingAgent(ctx), schedule }
}

let callCounter = 0
const signal = new AbortController().signal

function callTool(ctx: Context, agent: Agent, name: 'heartbeat_enable' | 'heartbeat_disable', args: Record<string, unknown> = {}) {
  return ctx.tools.execute({
    signal, callId: ToolCallId(`call-${++callCounter}`), name, arguments: args, agent,
  })
}

/** One-line JSON text of a tool result's text blocks. */
function text(result: unknown): string {
  const blocks = (result as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('heartbeat plugin', () => {
  it('registers exactly the two heartbeat tools', async () => {
    const test = await setup()
    expect(test.ctx.tools.schemas().map(schema => schema.name).sort())
      .toEqual(['heartbeat_disable', 'heartbeat_enable'])
  })

  it('enables the patrol with the deployment defaults', async () => {
    const test = await setup()
    const result = await callTool(test.ctx, test.agent, 'heartbeat_enable')
    expect(JSON.parse(text(result)))
      .toEqual({ id: 'schedule-1', interval_seconds: 1800, path: 'HEARTBEAT.md' })
    expect(test.schedule.create).toHaveBeenCalledWith(SessionId('heartbeat'), expect.objectContaining({
      title: 'Heartbeat',
      every_seconds: 1800,
      prompt: heartbeatPrompt('HEARTBEAT.md'),
    }), expect.anything())
  })

  it('enables with the supplied interval and the configured path', async () => {
    const test = await setup({ heartbeatPath: '.dsh/HEARTBEAT.md' })
    const result = await callTool(test.ctx, test.agent, 'heartbeat_enable', { interval_seconds: 600 })
    expect(JSON.parse(text(result)))
      .toEqual({ id: 'schedule-1', interval_seconds: 600, path: '.dsh/HEARTBEAT.md' })
  })

  it('rejects a non-integer and an out-of-range interval', async () => {
    const test = await setup()
    for (const interval of [90.5, 30, 100_000_000]) {
      const result = await callTool(test.ctx, test.agent, 'heartbeat_enable', { interval_seconds: interval })
      const value = JSON.parse(text(result)) as { code: string }
      expect(['invalid_rule', 'frequency_too_high']).toContain(value.code)
    }
  })

  it('refuses a second patrol and withholds internal storage failures', async () => {
    const existing = await setup({}, scheduleDouble({
      list: vi.fn(async () => [record('schedule-9', heartbeatPrompt('HEARTBEAT.md'))]),
    }))
    const again = await callTool(existing.ctx, existing.agent, 'heartbeat_enable')
    expect(JSON.parse(text(again)))
      .toMatchObject({ code: 'heartbeat_already_enabled' })

    const failing = await setup({}, scheduleDouble({
      create: vi.fn(async () => { throw new Error('storage down') }),
    }))
    const failed = await callTool(failing.ctx, failing.agent, 'heartbeat_enable')
    expect(JSON.parse(text(failed)))
      .toMatchObject({ code: 'internal_error' })
  })

  it('deletes only the heartbeat tasks of the session', async () => {
    const test = await setup({}, scheduleDouble({
      list: vi.fn(async () => [
        record('schedule-1', heartbeatPrompt('HEARTBEAT.md')),
        record('schedule-2', 'Standup reminder'),
        record('schedule-3', heartbeatPrompt('HEARTBEAT.md')),
      ]),
    }))
    const result = await callTool(test.ctx, test.agent, 'heartbeat_disable')
    expect(JSON.parse(text(result)))
      .toEqual({ deleted: 2, ids: ['schedule-1', 'schedule-3'] })
    expect(test.schedule.delete).toHaveBeenCalledTimes(2)
    expect(test.schedule.delete).toHaveBeenCalledWith({ sessionId: SessionId('heartbeat'), id: 'schedule-1' }, expect.anything())
    expect(test.schedule.delete).toHaveBeenCalledWith({ sessionId: SessionId('heartbeat'), id: 'schedule-3' }, expect.anything())
  })

  it('answers heartbeat_not_enabled when no patrol exists', async () => {
    const test = await setup()
    const result = await callTool(test.ctx, test.agent, 'heartbeat_disable')
    expect(JSON.parse(text(result)))
      .toMatchObject({ code: 'heartbeat_not_enabled' })
  })
})

describe('heartbeat config', () => {
  it('rejects absolute paths, parent escapes, and a default above the cap', () => {
    expect(() => { assertConfig({ heartbeatPath: '/etc/HEARTBEAT.md' }) }).toThrow(/workspace-relative/)
    expect(() => { assertConfig({ heartbeatPath: 'C:\\HEARTBEAT.md' }) }).toThrow(/workspace-relative/)
    expect(() => { assertConfig({ heartbeatPath: '../HEARTBEAT.md' }) }).toThrow(/workspace-relative/)
    expect(() => { assertConfig({ heartbeatPath: '' }) }).toThrow(/workspace-relative/)
    expect(() => { assertConfig({ defaultIntervalSeconds: 100_000, maxIntervalSeconds: 86_400 }) }).toThrow(/must not exceed/)
  })

  it('accepts the shipped defaults', () => {
    expect(() => { assertConfig({}) }).not.toThrow()
  })
})
