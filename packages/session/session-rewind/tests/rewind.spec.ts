/** The plugin captures each turn's file-tool paths before their first change and restores one turn's pre-turn state. */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as Rewind from '../src/index.ts'
import { mutationPath } from '../src/capture.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

const signal = new AbortController().signal

/** A minimal `tools` seat: registers definitions and executes them without the pipeline. */
function toolsStub() {
  const registry = new Map<string, Record<string, unknown>>()
  return {
    register: (definition: Record<string, unknown>) => {
      registry.set(definition.name as string, definition)
      return () => registry.delete(definition.name as string)
    },
    get: (name: string) => registry.get(name),
    execute: async (input: { name: string; arguments: unknown; agent?: unknown; signal: AbortSignal }) => {
      const definition = registry.get(input.name)
      if (definition === undefined) throw new Error(`unknown tool "${input.name}"`)
      const exec = { agent: input.agent, signal: input.signal }
      const value = await (definition.execute as (args: unknown, exec: unknown) => Promise<unknown>)(input.arguments, exec)
      const render = (definition.output as { render: (args: unknown, value: unknown) => unknown[] }).render
      return { content: render(input.arguments, value), isError: false }
    },
  } as never
}

async function boot(config: Partial<Rewind.Config> = {}) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin({ name: 'tools-stub', apply: (seat: Context) => { seat.provide('tools', toolsStub()) } })
  const fiber = await ctx.plugin(Rewind, config as Rewind.Config)
  return { ctx, fiber }
}

/** A temporary directory removed by the returned cleanup. */
async function scratchDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Open a turn with its first step. */
function startTurn(session: Session, turn: number): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
}

/** Close the step and the turn. */
function endTurn(session: Session, turn: number): void {
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/**
 * Apply a file-tool mutation the way the runtime does: announce it through
 * `tools/pre-execute` so the store captures the path, then apply it.
 */
async function mutate(
  ctx: Context, session: Session, name: string, args: unknown, apply: () => Promise<void>,
): Promise<void> {
  await ctx.waterfall('tools/pre-execute', { agent: { session }, name, arguments: args } as never, () => Promise.resolve(undefined as never))
  await apply()
}

describe('mutationPath', () => {
  it('extracts only the mutating file-tool paths', () => {
    expect(mutationPath('write', { file_path: 'a.txt', content: 'x' })).toBe('a.txt')
    expect(mutationPath('write', { file_path: 'a.txt' })).toBeUndefined()
    expect(mutationPath('edit', { file_path: 'a.txt', old_string: 'a', new_string: 'b' })).toBe('a.txt')
    expect(mutationPath('edit', { file_path: 'a.txt', old_string: 'a' })).toBeUndefined()
    expect(mutationPath('str_replace_editor', { command: 'create', path: 'a.txt', file_text: 'x' })).toBe('a.txt')
    expect(mutationPath('str_replace_editor', { command: 'view', path: 'a.txt' })).toBeUndefined()
    expect(mutationPath('bash', { command: 'echo hi' })).toBeUndefined()
    expect(mutationPath('write', 'not-an-object')).toBeUndefined()
  })
})

describe('session-rewind plugin', () => {
  it("restores one turn's pre-turn content, deleting files the turn created", async () => {
    const cwd = await scratchDir('dsh-session-rewind-')
    await writeFile(join(cwd, 'a.txt'), 'before\n')
    const { ctx } = await boot()
    const session = ctx.sessions.create(SessionId('cp'), { meta: { cwd } })
    startTurn(session, 1)
    await mutate(ctx, session, 'edit', { file_path: 'a.txt', old_string: 'before', new_string: 'after' },
      () => writeFile(join(cwd, 'a.txt'), 'after\n'))
    await mutate(ctx, session, 'str_replace_editor', { command: 'create', path: 'new.txt', file_text: 'n' },
      () => writeFile(join(cwd, 'new.txt'), 'n\n'))
    endTurn(session, 1)

    expect(ctx.sessionRewind.list(session.id)).toEqual([{ turn: 1, paths: 2 }])
    const outcome = await ctx.sessionRewind.restore(session.id, 1, signal)
    expect(outcome).toEqual({ turn: 1, restored: ['a.txt'], removed: ['new.txt'], skipped: [] })
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('before\n')
    await expect(readFile(join(cwd, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('captures once per turn and reports an unknown turn without captures', async () => {
    const cwd = await scratchDir('dsh-session-rewind-')
    await writeFile(join(cwd, 'a.txt'), 'v0\n')
    const { ctx } = await boot()
    const session = ctx.sessions.create(SessionId('cp'), { meta: { cwd } })
    startTurn(session, 1)
    await mutate(ctx, session, 'write', { file_path: 'a.txt', content: 'v1' }, () => writeFile(join(cwd, 'a.txt'), 'v1\n'))
    await mutate(ctx, session, 'write', { file_path: 'a.txt', content: 'v2' }, () => writeFile(join(cwd, 'a.txt'), 'v2\n'))
    endTurn(session, 1)

    // The turn's first mutation captured v0; a later one did not overwrite it.
    expect(ctx.sessionRewind.list(session.id)).toEqual([{ turn: 1, paths: 1 }])
    expect(ctx.sessionRewind.list(SessionId('other'))).toEqual([])
    await expect(ctx.sessionRewind.restore(session.id, 9, signal)).resolves.toBeUndefined()
    await ctx.sessionRewind.restore(session.id, 1, signal)
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('v0\n')
  })

  it('skips an oversized path and still restores the rest', async () => {
    const cwd = await scratchDir('dsh-session-rewind-')
    await writeFile(join(cwd, 'a.txt'), 'small\n')
    await writeFile(join(cwd, 'big.txt'), 'x'.repeat(64))
    const { ctx } = await boot({ maxFileBytes: 16 })
    const session = ctx.sessions.create(SessionId('cp'), { meta: { cwd } })
    startTurn(session, 1)
    await mutate(ctx, session, 'write', { file_path: 'a.txt', content: 'small2' }, () => writeFile(join(cwd, 'a.txt'), 'small2\n'))
    await mutate(ctx, session, 'write', { file_path: 'big.txt', content: 'y' }, () => writeFile(join(cwd, 'big.txt'), 'y'.repeat(64)))
    endTurn(session, 1)

    const outcome = await ctx.sessionRewind.restore(session.id, 1, signal)
    expect(outcome).toEqual({ turn: 1, restored: ['a.txt'], removed: [], skipped: [{ path: 'big.txt', reason: 'oversized' }] })
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('small\n')
    expect(await readFile(join(cwd, 'big.txt'), 'utf8')).toBe('y'.repeat(64))
  })

  it('excludes subagent sessions and removes the temporary directory on disposal', async () => {
    const cwd = await scratchDir('dsh-session-rewind-')
    const { ctx } = await boot()
    const session = ctx.sessions.create(SessionId('sub'), { meta: { cwd, origin: 'subagent' } })
    startTurn(session, 1)
    await mutate(ctx, session, 'write', { file_path: 'a.txt', content: 'x' }, () => writeFile(join(cwd, 'a.txt'), 'x\n'))
    endTurn(session, 1)
    expect(ctx.sessionRewind.list(session.id)).toEqual([])

    const session2 = ctx.sessions.create(SessionId('live'), { meta: { cwd } })
    startTurn(session2, 1)
    await mutate(ctx, session2, 'write', { file_path: 'a.txt', content: 'x' }, () => writeFile(join(cwd, 'a.txt'), 'x\n'))
    endTurn(session2, 1)
    ctx.emit('session/disposed', session2)
    await vi.waitFor(() => { expect(ctx.sessionRewind.list(session2.id)).toEqual([]) })
  })

  it('registers a workspace_rewind tool that reports an unknown turn', async () => {
    const cwd = await scratchDir('dsh-session-rewind-')
    const { ctx } = await boot()
    const session = ctx.sessions.create(SessionId('tool'), { meta: { cwd } })
    startTurn(session, 1)
    endTurn(session, 1)
    const result = await ctx.tools.execute({
      signal, callId: ToolCallId('call-rewind-unknown'), name: 'workspace_rewind',
      arguments: { turn: 3 }, agent: { session } as never,
    })
    const text = result.content[0]
    expect(result.isError).toBe(false)
    expect(text !== undefined && 'text' in text && text.text).toMatch(/No rewind record exists/)
  })

  it('fails loud on invalid bounds', async () => {
    const { ctx } = await boot()
    // A plugin whose inject is unmet never runs its apply, so the bad config
    // is applied against a context whose dependencies are already mounted.
    await expect(ctx.plugin(Rewind, { maxPaths: 0 } as Rewind.Config)).rejects.toThrow(/maxPaths/)
  })
})

describe('capture hygiene', () => {
  it('removes its temporary scratch directory on disposal', async () => {
    const dir = await scratchDir('dsh-session-rewind-captures-')
    await writeFile(join(dir, 'a'), 'same\n')
    const store = new Rewind.SessionRewindStore(dir, {
      tempRoot: dir, maxFileBytes: 1024, maxPaths: 10, warn: () => undefined,
    })
    store.start(1)
    store.capture('write', { file_path: 'a', content: 'x' })
    await store.settled()
    const siblings = (await readdir(dir)).filter(name => name.startsWith('dsh-session-rewind-'))
    expect(siblings).toHaveLength(1)
    await store.dispose()
    const after = (await readdir(dir)).filter(name => name.startsWith('dsh-session-rewind-'))
    expect(after).toEqual([])
  })
})
