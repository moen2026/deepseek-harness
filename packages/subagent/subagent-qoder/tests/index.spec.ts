/**
 * Plugin-level behavior: config resolution and validation, provider
 * registration through `apply`, and runs driven end-to-end through
 * `ctx.subagents` with a spied subprocess service.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { DEFAULT_QODER_PERMISSION_MODE, QODER_PERMISSION_MODES } from '../src/cli.ts'
import * as qoder from '../src/index.ts'
import { DEFAULT_DISPOSE_GRACE_MS } from '../src/run.ts'
import { fakeChild, SUCCESS_REPLY } from './harness.ts'

const STDOUT_CAP_BYTES = 16 * 1024 * 1024

/** A structurally minimal parent Agent backed by a real detached Session. */
function parentAgent(cwd: string | undefined): Agent {
  const id = SessionId('parent')
  return {
    id,
    session: Session.create(id, [], {
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: 0,
      ...cwd === undefined ? {} : { cwd },
      isSeeded: false,
    }),
  } as Agent
}

async function setup(config: qoder.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  const spawn = vi.fn((spec: SubprocessSpawnSpec): SubprocessHandle => {
    throw new Error(`unexpected spawn: ${spec.argv.join(' ')}`)
  })
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spawn)
  const fiber = await ctx.plugin(qoder, config)
  return { ctx, spawn, fiber }
}

function start(parent: Agent, prompt = 'do the task') {
  return { prompt: [{ type: 'text' as const, text: prompt }], parent, signal: new AbortController().signal }
}

describe('resolveQoderConfig', () => {
  it('applies the safe defaults', () => {
    expect(qoder.resolveQoderConfig({})).toEqual({
      providerName: 'qoder',
      env: {},
      permissionMode: DEFAULT_QODER_PERMISSION_MODE,
      disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
    })
  })

  it('keeps an explicit deployment selection', () => {
    expect(qoder.resolveQoderConfig({
      providerName: 'qoder-team',
      model: 'qoder-pro',
      maxTurns: 6,
      allowedTools: ['Read', 'Write'],
      disallowedTools: ['Bash'],
      env: { QODER_PERSONAL_ACCESS_TOKEN: 'token' },
      permissionMode: 'bypass',
      disposeGraceMs: 1_000,
    })).toEqual({
      providerName: 'qoder-team',
      model: 'qoder-pro',
      maxTurns: 6,
      allowedTools: ['Read', 'Write'],
      disallowedTools: ['Bash'],
      env: { QODER_PERSONAL_ACCESS_TOKEN: 'token' },
      permissionMode: 'bypass',
      disposeGraceMs: 1_000,
    })
  })

  it('accepts the exact timer bound and rejects invalid bounds', () => {
    expect(qoder.resolveQoderConfig({ disposeGraceMs: MAX_TIMER_DELAY_MS }).disposeGraceMs)
      .toBe(MAX_TIMER_DELAY_MS)
    for (const disposeGraceMs of [0, Number.NaN, MAX_TIMER_DELAY_MS + 1]) {
      expect(() => qoder.resolveQoderConfig({ disposeGraceMs })).toThrow()
    }
  })

  it('requires a positive integer turn cap', () => {
    for (const maxTurns of [0, 1.5]) {
      expect(() => qoder.resolveQoderConfig({ maxTurns })).toThrow('positive integer')
    }
  })
})

describe('Config schema', () => {
  it('applies schema defaults and rejects invalid input', () => {
    expect(qoder.Config({}).providerName).toBe('qoder')
    expect(qoder.Config({}).model).toBeUndefined()
    expect(() => qoder.Config({ providerName: '' })).toThrow()
    for (const permissionMode of QODER_PERMISSION_MODES) {
      expect(qoder.Config({ permissionMode }).permissionMode).toBe(permissionMode)
    }
    expect(() => qoder.Config({ permissionMode: 'future-mode' } as never)).toThrow()
  })
})

describe('subagent-qoder plugin', () => {
  it('has the namespace-plugin export shape', () => {
    expect('default' in qoder).toBe(false)
    expect(qoder.name).toBe('subagent-qoder')
    expect(qoder.inject).toEqual(['subagents', 'subprocess'])
  })

  it('registers a provider that drives one pinned print-mode run', async () => {
    const { ctx, spawn, fiber } = await setup()
    const child = fakeChild({ stdout: SUCCESS_REPLY })
    spawn.mockReturnValue(child.handle)
    expect(ctx.subagents.list()).toEqual(['qoder'])
    const run = await ctx.subagents.start('qoder', start(parentAgent(process.cwd()), 'rename the module'))
    const spec = spawn.mock.calls[0]![0]
    expect(spec.argv[0]).toBe(process.execPath)
    expect(spec.argv[1]).toMatch(/qodercli/i)
    expect(spec.argv.slice(2)).toEqual(['--print', '--output-format', 'json'])
    expect(spec.cwd).toBe(process.cwd())
    expect(spec.stdio).toEqual({
      stdin: { data: 'rename the module' },
      stdout: { maxBytes: STDOUT_CAP_BYTES },
      stderr: 'inherit',
    })
    expect(spec.graceMs).toBe(DEFAULT_DISPOSE_GRACE_MS)
    expect(spec.env).toEqual({})
    child.settle()
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'ok' }],
      stopReason: 'completed',
    })
    await run.dispose()
    await fiber.dispose()
  })

  it('forwards the resolved selection and environment to the child', async () => {
    const { ctx, spawn, fiber } = await setup({
      providerName: 'qoder-team',
      model: 'qoder-pro',
      maxTurns: 3,
      allowedTools: ['Read', 'Write'],
      disallowedTools: ['Bash'],
      env: { QODER_PERSONAL_ACCESS_TOKEN: 'token' },
      permissionMode: 'bypass',
      disposeGraceMs: 2_000,
    })
    const child = fakeChild({ stdout: SUCCESS_REPLY })
    spawn.mockReturnValue(child.handle)
    expect(ctx.subagents.list()).toEqual(['qoder-team'])
    const run = await ctx.subagents.start('qoder-team', start(parentAgent(process.cwd())))
    const spec = spawn.mock.calls[0]![0]
    expect(spec.argv.slice(2)).toEqual([
      '--print', '--output-format', 'json',
      '--model', 'qoder-pro',
      '--max-turns', '3',
      '--allowed-tools=Read,Write',
      '--disallowed-tools=Bash',
      '--yolo',
    ])
    expect(spec.env).toEqual({ QODER_PERSONAL_ACCESS_TOKEN: 'token' })
    expect(spec.graceMs).toBe(2_000)
    child.settle()
    await run.result
    await run.dispose()
    await fiber.dispose()
  })

  it('rejects a parent session without a working directory', async () => {
    const { ctx, spawn, fiber } = await setup()
    await expect(ctx.subagents.start('qoder', start(parentAgent(undefined))))
      .rejects.toThrow('no working directory for the child')
    expect(spawn).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('reports an unusable child workspace as a startup failure', async () => {
    const { ctx, spawn, fiber } = await setup()
    // An absolute path that is a file, not an enterable directory, is unusable.
    await expect(ctx.subagents.start('qoder', start(parentAgent(join(process.cwd(), 'package.json')))))
      .rejects.toThrow(
        'Product subagent failure (product: Qoder; stage: spawn; category: unknown)',
      )
    expect(spawn).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('reports cancellation that lands before startup', async () => {
    const { ctx, spawn, fiber } = await setup()
    const controller = new AbortController()
    controller.abort()
    await expect(ctx.subagents.start('qoder', {
      prompt: [{ type: 'text', text: 'do the task' }],
      parent: parentAgent(process.cwd()),
      signal: controller.signal,
    })).rejects.toThrow('aborted before startup')
    expect(spawn).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('reports cancellation that lands during workspace resolution', async () => {
    const { ctx, spawn, fiber } = await setup()
    const controller = new AbortController()
    controller.abort()
    // Workspace resolution fails on the file path, and the pending abort wins.
    await expect(ctx.subagents.start('qoder', {
      prompt: [{ type: 'text', text: 'do the task' }],
      parent: parentAgent(join(process.cwd(), 'package.json')),
      signal: controller.signal,
    })).rejects.toThrow('aborted before startup')
    expect(spawn).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('logs a post-publication failure and flattens it into an error result', async () => {
    const { ctx, spawn, fiber } = await setup()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const child = fakeChild({ stdout: '' })
    spawn.mockReturnValue(child.handle)
    const run = await ctx.subagents.start('qoder', start(parentAgent(process.cwd())))
    child.settle({ exitCode: 1, signal: null })
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: process')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('child run failed (error)')
    await run.dispose()
    await fiber.dispose()
  })

  it('unregisters the provider when its fiber is disposed', async () => {
    const { ctx, fiber } = await setup({ providerName: 'qoder-hmr' })
    expect(ctx.subagents.list()).toEqual(['qoder-hmr'])
    await fiber.dispose()
    expect(ctx.subagents.list()).toEqual([])
  })
})
