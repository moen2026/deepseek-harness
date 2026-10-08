import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { TrackedPullRequest, TrackedWorktree } from '@deepseek-ai/dsh-tool-git-track'
import type { Agent } from '@deepseek-ai/dsh-agent'

import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/**
 * Drives the REAL plugin body: mounts `dsh-tool-git-track` on a real
 * `ToolRuntime` over a real memory-backed storage domain and invokes the
 * registered tools through `ctx.tools.execute`, with a fake parent Agent
 * carrying a real `Session` — so the puts the tools make are observable
 * through the shipping domain tables (only the agent wrapper is a stand-in;
 * the session, the storage domain, and the tools are the shipping code).
 */

/** A parent Agent backed by a real Session — the tools key records by `agent.session.id`. */
function agentWithSession(id = 'parent-1'): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  const pool = new MemoryMediaPool()
  const backend = new MemoryStorageBackend(pool)
  ctx.effect(() => ctx.storage.backend.register('fixture', backend))
  ctx.effect(() => async () => { await backend.close() })
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.effect(() => {
    const unmount = ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    return async () => { await facility.closeAll(); unmount() }
  })
  await ctx.plugin(tool)
  return ctx
}

let callCounter = 0
function callTrack(
  ctx: Context,
  name: 'worktree_track' | 'pull_request_track',
  args: unknown,
  over: { agent?: Agent | undefined } = {},
) {
  const agent = 'agent' in over ? over.agent : agentWithSession()
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...agent ? { agent } : {},
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-tool-git-track', () => {
  it('registers the two tracking tools with their required keys', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('worktree_track')
    expect(names).toContain('pull_request_track')
    const schema = ctx.tools.schemas().find(entry => entry.name === 'worktree_track')
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['base', 'branch', 'path'])
  })

  it('records a worktree and returns the current list', async () => {
    const ctx = await setup()
    const agent = agentWithSession('recorder')
    const result = await callTrack(ctx, 'worktree_track', {
      path: 'E:/repo/.worktrees/fix-auth',
      branch: 'worktree/fix-auth',
      base: 'master',
    }, { agent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected worktree_track success')
    expect(result.value).toEqual({
      worktrees: [{ path: 'E:/repo/.worktrees/fix-auth', branch: 'worktree/fix-auth', base: 'master' }] satisfies TrackedWorktree[],
    })
    expect(text(result)).toContain('Now tracking 1 worktree(s)')
  })

  it('upserts by path: re-recording a worktree updates its entry in place', async () => {
    const ctx = await setup()
    const agent = agentWithSession('upserter')
    await callTrack(ctx, 'worktree_track', { path: 'E:/w/one', branch: 'a' }, { agent })
    await callTrack(ctx, 'worktree_track', { path: 'E:/w/two', branch: 'b' }, { agent })
    const result = await callTrack(ctx, 'worktree_track', { path: 'E:/w/one', branch: 'a2' }, { agent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected worktree_track success')
    expect(result.value).toEqual({
      worktrees: [
        { path: 'E:/w/one', branch: 'a2' },
        { path: 'E:/w/two', branch: 'b' },
      ],
    })
  })

  it('records a pull request and upserts by URL when it is re-recorded', async () => {
    const ctx = await setup()
    const agent = agentWithSession('pr-recorder')
    await callTrack(ctx, 'pull_request_track', { url: 'https://git.test/org/repo/pull/7', title: 'Old' }, { agent })
    const result = await callTrack(ctx, 'pull_request_track', {
      url: 'https://git.test/org/repo/pull/7',
      number: 7,
      title: 'New title',
      branch: 'worktree/fix',
    }, { agent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected pull_request_track success')
    expect(result.value).toEqual({
      pullRequests: [{
        url: 'https://git.test/org/repo/pull/7',
        number: 7,
        title: 'New title',
        branch: 'worktree/fix',
      }] satisfies TrackedPullRequest[],
    })
    expect(text(result)).toContain('https://git.test/org/repo/pull/7')
  })

  it('rejects a non-agent caller for both tools', async () => {
    const ctx = await setup()
    const worktree = await callTrack(ctx, 'worktree_track', { path: 'E:/w/none' }, { agent: undefined })
    expect(worktree.isError).toBe(true)
    if (!worktree.isError) throw new Error('expected worktree_track rejection')
    expect(text(worktree)).toContain('requires an owning agent session')
    const pull = await callTrack(ctx, 'pull_request_track', { url: 'https://git.test/x' }, { agent: undefined })
    expect(pull.isError).toBe(true)
  })

  it('rejects a relative worktree path and a non-positive pull-request number', async () => {
    const ctx = await setup()
    const relative = await callTrack(ctx, 'worktree_track', { path: 'relative/path' })
    expect(relative.isError).toBe(true)
    const number = await callTrack(ctx, 'pull_request_track', { url: 'https://git.test/x', number: 0 })
    expect(number.isError).toBe(true)
  })

  it('keeps the records of different sessions isolated', async () => {
    const ctx = await setup()
    const first = agentWithSession('first')
    const second = agentWithSession('second')
    await callTrack(ctx, 'worktree_track', { path: 'E:/w/first' }, { agent: first })
    const worktree = await callTrack(ctx, 'worktree_track', { path: 'E:/w/second' }, { agent: second })
    expect(worktree.isError).toBe(false)
    if (worktree.isError) throw new Error('expected worktree_track success')
    expect(worktree.value).toEqual({ worktrees: [{ path: 'E:/w/second' }] })
    await callTrack(ctx, 'pull_request_track', { url: 'https://git.test/first' }, { agent: first })
    const pull = await callTrack(ctx, 'pull_request_track', { url: 'https://git.test/second' }, { agent: second })
    expect(pull.isError).toBe(false)
    if (pull.isError) throw new Error('expected pull_request_track success')
    expect(pull.value).toEqual({ pullRequests: [{ url: 'https://git.test/second' }] })
  })
})
