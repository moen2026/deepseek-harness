/**
 * One-shot run lifecycle over the fake subprocess handle: spawn arguments and
 * stdin delivery, settlement classification for completed, product-error,
 * invalid-result, and process outcomes, cancellation, and disposal quiescence.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  qoderStartupFailure,
  startQoderRun,
  type QoderRunSpec,
} from '../src/run.ts'
import {
  fakeChild,
  fixture,
  NOT_LOGGED_IN_REPLY,
  SUCCESS_REPLY,
  type FakeChild,
} from './harness.ts'

const STDOUT_CAP_BYTES = 16 * 1024 * 1024

function request(
  prompt: ContentBlock[] = [{ type: 'text', text: 'do the task' }],
  signal = new AbortController().signal,
): Pick<SubagentStartRequest, 'prompt' | 'signal'> {
  return { prompt, signal }
}

function specFor(child: FakeChild, overrides: Partial<QoderRunSpec> = {}): QoderRunSpec {
  return {
    command: ['node', 'qodercli.js'],
    cwd: process.cwd(),
    permissionMode: 'default',
    env: {},
    disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
    spawn: () => child.handle,
    ...overrides,
  }
}

function capturingSpawn(calls: SubprocessSpawnSpec[], child: FakeChild) {
  return (spec: SubprocessSpawnSpec) => {
    calls.push(spec)
    return child.handle
  }
}

describe('startQoderRun', () => {
  it('spawns the pinned print contract and completes on one parsed reply', async () => {
    const child = fakeChild({ stdout: SUCCESS_REPLY })
    const calls: SubprocessSpawnSpec[] = []
    const run = await startQoderRun(
      request(),
      specFor(child, { spawn: capturingSpawn(calls, child) }),
    )
    expect(calls).toHaveLength(1)
    const spec = calls[0]!
    expect(spec.argv).toEqual(['node', 'qodercli.js', '--print', '--output-format', 'json'])
    expect(spec.cwd).toBe(process.cwd())
    expect(spec.stdio).toEqual({
      stdin: { data: 'do the task' },
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
  })

  it('forwards every deployment selection into the argv', async () => {
    const child = fakeChild({ stdout: SUCCESS_REPLY })
    const calls: SubprocessSpawnSpec[] = []
    const run = await startQoderRun(request(), specFor(child, {
      model: 'qoder-pro',
      maxTurns: 4,
      allowedTools: ['Read'],
      disallowedTools: ['Bash'],
      permissionMode: 'bypass',
      spawn: capturingSpawn(calls, child),
    }))
    expect(calls[0]!.argv.slice(2)).toEqual([
      '--print', '--output-format', 'json',
      '--model', 'qoder-pro',
      '--max-turns', '4',
      '--allowed-tools=Read',
      '--disallowed-tools=Bash',
      '--yolo',
    ])
    child.settle()
    await run.result
    await run.dispose()
  })

  it('delivers multiple prompt blocks as one joined stdin task', async () => {
    const child = fakeChild({ stdout: SUCCESS_REPLY })
    const calls: SubprocessSpawnSpec[] = []
    const prompt: ContentBlock[] = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]
    const run = await startQoderRun(
      request(prompt),
      specFor(child, { spawn: capturingSpawn(calls, child) }),
    )
    expect(calls[0]!.stdio.stdin).toEqual({ data: 'first\n\nsecond' })
    child.settle()
    await run.result
    await run.dispose()
  })

  it('maps the token-ceiling stop reason to max-tokens', async () => {
    const child = fakeChild({ stdout: fixture('print-json-max-tokens.json') })
    const run = await startQoderRun(request(), specFor(child))
    child.settle()
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'The refactor begins by extracting the shared option' }],
      stopReason: 'max-tokens',
    })
    await run.dispose()
  })

  it('flattens a product error into an error result without raw output', async () => {
    const child = fakeChild({ stdout: NOT_LOGGED_IN_REPLY })
    const run = await startQoderRun(request(), specFor(child))
    child.settle({ exitCode: 1, signal: null })
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.output).toEqual([])
    expect(result.diagnostic).toContain('category: product-error')
    expect(result.diagnostic).toContain('exit code: 1')
    expect(result.diagnostic).not.toContain('Not logged in')
    await run.dispose()
  })

  it('classifies unusable output on a clean exit as an invalid result', async () => {
    const child = fakeChild({ stdout: fixture('print-json-plain-text.txt') })
    const run = await startQoderRun(request(), specFor(child))
    child.settle()
    const result = await run.result
    expect(result.diagnostic).toBe(
      'Product subagent failure (product: Qoder; stage: run; category: invalid-result; exit code: 0)',
    )
    await run.dispose()
  })

  it('classifies unusable output from a crashed process as a process failure', async () => {
    const child = fakeChild({ stdout: '' })
    const run = await startQoderRun(request(), specFor(child))
    child.settle({ exitCode: 3, signal: null })
    const result = await run.result
    expect(result.diagnostic).toContain('category: process')
    expect(result.diagnostic).toContain('exit code: 3')
    await run.dispose()
  })

  it('records a terminating signal without an exit code', async () => {
    const child = fakeChild({ stdout: '' })
    const run = await startQoderRun(request(), specFor(child))
    child.settle({ exitCode: null, signal: 'SIGKILL' })
    const result = await run.result
    expect(result.diagnostic).toBe(
      'Product subagent failure (product: Qoder; stage: run; category: process; signal: SIGKILL)',
    )
    await run.dispose()
  })

  it('flattens an infrastructure rejection into an error result', async () => {
    const child = fakeChild()
    const run = await startQoderRun(request(), specFor(child))
    child.fail(new Error('provider died'))
    const result = await run.result
    expect(result).toMatchObject({ output: [], stopReason: 'error' })
    expect(result.diagnostic).toBe(
      'Product subagent failure (product: Qoder; stage: run; category: process)',
    )
    await run.dispose()
  })

  it('reports a post-publication failure through the diagnostic sink', async () => {
    const child = fakeChild({ stdout: '' })
    const onError = vi.fn()
    const run = await startQoderRun(request(), specFor(child, { onError }))
    child.settle({ exitCode: 2, signal: null })
    await run.result
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]![1]).toBe('error')
    await run.dispose()
  })

  it('cancels the run and terminates the child', async () => {
    const child = fakeChild({ exitOnTerminate: false })
    const controller = new AbortController()
    const run = await startQoderRun(request(undefined, controller.signal), specFor(child))
    controller.abort()
    expect(child.terminate).toHaveBeenCalledTimes(1)
    child.settle({ exitCode: null, signal: 'SIGTERM' })
    const result = await run.result
    expect(result).toEqual({ output: [], stopReason: 'aborted' })
    expect(result.diagnostic).toBeUndefined()
    await run.dispose()
  })

  it('disposes idempotently and reaches child exit once', async () => {
    const child = fakeChild({ stdout: SUCCESS_REPLY })
    const run = await startQoderRun(request(), specFor(child))
    child.settle()
    await run.result
    const disposal = run.dispose()
    expect(run.dispose()).toBe(disposal)
    await disposal
    expect(child.waitForExit).toHaveBeenCalledTimes(1)
  })

  it('rejects a teardown that cannot reach quiescence', async () => {
    const child = fakeChild({
      stdout: SUCCESS_REPLY,
      waitForExitError: new Error('range unobservable'),
    })
    const run = await startQoderRun(request(), specFor(child))
    child.settle()
    await run.result
    await expect(run.dispose()).rejects.toMatchObject({
      facts: { stage: 'teardown', category: 'unknown' },
    })
  })

  it('rejects a non-text task without spawning', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child.handle)
    await expect(startQoderRun(
      request([{ type: 'reasoning', text: 'planning' }]),
      specFor(child, { spawn }),
    )).rejects.toThrow('only text blocks')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects an aborted request without spawning', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child.handle)
    const controller = new AbortController()
    controller.abort()
    await expect(startQoderRun(request(undefined, controller.signal), specFor(child, { spawn })))
      .rejects.toThrow('aborted before startup')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('wraps a spawn failure as a startup failure', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => { throw new Error('spawn ENOENT') })
    await expect(startQoderRun(request(), specFor(child, { spawn }))).rejects.toMatchObject({
      facts: { stage: 'spawn', category: 'unknown' },
    })
  })
})

describe('qoderStartupFailure', () => {
  it('hides an unpublished cause behind fixed safe facts', () => {
    const failure = qoderStartupFailure(new Error('EACCES: C:\\Users\\secret\\qoder'))
    expect(failure.message).toBe(
      'subagent-qoder: Product subagent failure (product: Qoder; stage: spawn; category: unknown)',
    )
    expect(failure.message).not.toContain('secret')
  })
})
