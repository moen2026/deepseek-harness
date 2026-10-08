import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RepoWiki from '../src/index.ts'
import { RepoWikiError } from '../src/types.ts'
import type { RepoWikiProvider, WikiOutlineEntry, WikiPage, WikiListing } from '../src/types.ts'

/** A minimal provider over fixed fixtures. */
function fixtureProvider(overrides: Partial<RepoWikiProvider> = {}): RepoWikiProvider {
  return {
    id: 'fixture',
    async getPage(path: string): Promise<WikiPage> {
      if (path === 'overview.md') {
        return { path: 'overview.md', title: 'Overview', stale: false, content: '# Overview\n\nBody.' }
      }
      throw new RepoWikiError(`no wiki page at ${JSON.stringify(path)}`, 'REPO_WIKI_NOT_FOUND')
    },
    async listPages(): Promise<WikiListing> {
      return { pages: [{ path: 'overview.md', title: 'Overview', stale: false }] }
    },
    async outline(): Promise<WikiOutlineEntry[]> {
      return [{ path: 'overview.md', title: 'Overview', stale: false, headings: ['# Overview'] }]
    },
    ...overrides,
  }
}

/** Mount a fresh seam on a real cordis context and return it with its provider slot. */
function mountedSeam(): { seam: RepoWiki; last: { provider?: RepoWikiProvider } } {
  const ctx = new Context()
  const seam = new RepoWiki(ctx)
  const last: { provider?: RepoWikiProvider } = {}
  const originalRegister = seam.registerProvider.bind(seam)
  seam.registerProvider = (provider: RepoWikiProvider) => {
    const dispose = originalRegister(provider)
    last.provider = provider
    return dispose
  }
  return { seam, last }
}

describe('RepoWiki', () => {
  it('rejects an invalid provider id before any mutation', () => {
    const { seam, last } = mountedSeam()
    expect(() => seam.registerProvider(fixtureProvider({ id: '   ' }))).toThrow(RepoWikiError)
    expect(() => seam.registerProvider(fixtureProvider({ id: '   ' }))).toThrow(/must be a non-empty string/)
    expect(last.provider).toBeUndefined()
  })

  it('rejects a second registration while the first holds the seam', () => {
    const { seam, last } = mountedSeam()
    seam.registerProvider(fixtureProvider())
    expect(last.provider?.id).toBe('fixture')
    expect(() => seam.registerProvider(fixtureProvider({ id: 'other' }))).toThrow(/already held by provider "fixture"/)
  })

  it('routes reads to the provider and releases it on dispose', async () => {
    const { seam } = mountedSeam()
    await expect(seam.getPage('overview.md')).rejects.toThrow(/no repo-wiki provider is registered/)
    await expect(seam.listPages()).rejects.toMatchObject({ code: 'REPO_WIKI_UNAVAILABLE' })
    await expect(seam.outline()).rejects.toMatchObject({ code: 'REPO_WIKI_UNAVAILABLE' })

    const dispose = seam.registerProvider(fixtureProvider())
    await expect(seam.getPage(' overview.md ')).resolves.toMatchObject({ title: 'Overview', path: 'overview.md' })
    await expect(seam.listPages()).resolves.toMatchObject({ pages: [{ path: 'overview.md' }] })
    await expect(seam.outline()).resolves.toHaveLength(1)

    dispose()
    await expect(seam.getPage('overview.md')).rejects.toMatchObject({ code: 'REPO_WIKI_UNAVAILABLE' })
  })

  it('normalizes page paths and rejects escape attempts before touching the provider', async () => {
    const { seam } = mountedSeam()
    const provider = fixtureProvider()
    const seen: string[] = []
    seam.registerProvider({
      ...provider,
      async getPage(path: string) {
        seen.push(path)
        return provider.getPage(path)
      },
    })
    await expect(seam.getPage('')).rejects.toMatchObject({ code: 'REPO_WIKI_INVALID_PATH' })
    await expect(seam.getPage('page.txt')).rejects.toMatchObject({ code: 'REPO_WIKI_INVALID_PATH' })
    await expect(seam.getPage('../escape.md')).rejects.toMatchObject({ code: 'REPO_WIKI_INVALID_PATH' })
    await expect(seam.getPage('/absolute.md')).rejects.toMatchObject({ code: 'REPO_WIKI_INVALID_PATH' })
    expect(seen).toHaveLength(0)

    await expect(seam.getPage('a\\b.md')).rejects.toMatchObject({ code: 'REPO_WIKI_NOT_FOUND' })
    expect(seen).toEqual(['a/b.md'])
  })

  it('preserves provider NOT_FOUND codes for missing pages', async () => {
    const { seam } = mountedSeam()
    seam.registerProvider(fixtureProvider())
    await expect(seam.getPage('missing.md')).rejects.toMatchObject({ code: 'REPO_WIKI_NOT_FOUND' })
  })
})
