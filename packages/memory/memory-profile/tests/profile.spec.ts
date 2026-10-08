import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import Memory, {
  type MemoryListRequest,
  type MemoryPage,
  type MemoryProvider,
  type MemoryRecord,
} from '@deepseek-ai/dsh-memory'
import * as MemoryProfile from '@deepseek-ai/dsh-memory-profile'
import { MEMORY_PROFILE_DEFAULT_MAX_ITEMS, renderProfile } from '@deepseek-ai/dsh-memory-profile'

function record(id: string, text: string): MemoryRecord {
  return { id, text, tags: [], namespace: 'style', createdAt: '2026-01-01T00:00:00.000Z' }
}

/** A scripted style provider whose listing behavior each test steers. */
interface ProfileProvider extends MemoryProvider {
  seenLists: (MemoryListRequest | undefined)[]
  records: MemoryRecord[]
  failure: Error | undefined
}

function profileProvider(): ProfileProvider {
  const provider: ProfileProvider = {
    id: 'profile-stub',
    seenLists: [],
    records: [],
    failure: undefined,
    remember: () => Promise.resolve('m'),
    recall: () => Promise.resolve({ hits: [] }),
    forget: () => Promise.resolve(false),
    list(request) {
      provider.seenLists.push(request)
      if (provider.failure !== undefined) return Promise.reject(provider.failure)
      return Promise.resolve({ records: provider.records })
    },
  }
  return provider
}

/** One macrotask flushes every settled promise chain a refresh may hold. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

async function mountProfile(
  provider: MemoryProvider,
  config?: MemoryProfile.Config,
): Promise<{ session: Session; snapshot: () => Promise<string> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Memory)
  ctx.memory.registerProvider(provider)
  await ctx.plugin(MemoryProfile, config)
  const session = ctx.sessions.create(SessionId('profile-session'))
  return { session, snapshot: async () => renderContextSnapshot(await ctx.systemPrompt.assemble()) }
}

describe('renderProfile', () => {
  it('renders a guidance header and one line per record', () => {
    const text = renderProfile([record('m1', 'prefers tabs'), record('m2', 'answers briefly')])
    expect(text).toContain('Saved collaboration style preferences')
    expect(text).toContain('- prefers tabs')
    expect(text).toContain('- answers briefly')
  })

  it('renders nothing for an empty list', () => {
    expect(renderProfile([])).toBe('')
  })
})

describe('memory profile injection', () => {
  it('injects stored style memories and forwards the namespace and default cap', async () => {
    const provider = profileProvider()
    provider.records = [record('m1', 'prefers tabs'), record('m2', 'answers briefly')]
    const { snapshot } = await mountProfile(provider)
    await vi.waitFor(async () => { expect(await snapshot()).toContain('- prefers tabs') })
    expect(await snapshot()).toContain('- answers briefly')
    expect(provider.seenLists[0]).toEqual({ namespace: 'style', limit: MEMORY_PROFILE_DEFAULT_MAX_ITEMS })
  })

  it('re-reads the profile after every turn end', async () => {
    const provider = profileProvider()
    const { session, snapshot } = await mountProfile(provider)
    await settle()
    expect(await snapshot()).toBe('')
    provider.records = [record('m1', 'prefers tabs')]
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(async () => { expect(await snapshot()).toContain('- prefers tabs') })
  })

  it('keeps the last successful text when the provider starts failing', async () => {
    const provider = profileProvider()
    provider.records = [record('m1', 'prefers tabs')]
    const { session, snapshot } = await mountProfile(provider)
    await vi.waitFor(async () => { expect(await snapshot()).toContain('- prefers tabs') })
    provider.failure = new Error('backend down')
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    expect(await snapshot()).toContain('- prefers tabs')
  })

  it('contributes nothing when no provider is registered', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Memory)
    await ctx.plugin(MemoryProfile)
    await settle()
    expect(renderContextSnapshot(await ctx.systemPrompt.assemble())).toBe('')
  })

  it('rejects a non-positive-integer maxItems at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Memory)
    await expect(ctx.plugin(MemoryProfile, { maxItems: 0 }))
      .rejects.toThrow(/maxItems must be a positive integer/)
    expect(() => { MemoryProfile.apply(ctx, { maxItems: 1.5 }) })
      .toThrow(/maxItems must be a positive integer/)
  })

  it('passes a custom maxItems to the listing', async () => {
    const provider = profileProvider()
    await mountProfile(provider, { maxItems: 3 })
    expect(provider.seenLists[0]).toEqual({ namespace: 'style', limit: 3 })
  })

  it('coalesces overlapping refreshes into one listing', async () => {
    const provider = profileProvider()
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    provider.list = async (request) => {
      provider.seenLists.push(request)
      await gate
      const page: MemoryPage = { records: [] }
      return page
    }
    const { session } = await mountProfile(provider)
    expect(provider.seenLists).toHaveLength(1)
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await settle()
    expect(provider.seenLists).toHaveLength(1)
    release()
    await settle()
    session.append('turn/start', { turn: 3 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    expect(provider.seenLists).toHaveLength(2)
  })
})
