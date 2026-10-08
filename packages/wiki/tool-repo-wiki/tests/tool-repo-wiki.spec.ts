import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import RepoWiki from '@deepseek-ai/dsh-repo-wiki'
import type { RepoWikiProvider, WikiOutlineEntry, WikiPage, WikiListing } from '@deepseek-ai/dsh-repo-wiki'
import * as ToolRepoWiki from '../src/index.ts'
import { DEFAULT_REPO_WIKI_TOOL_TIMEOUT_MS, REPO_WIKI_PROMPT_TEXT } from '../src/index.ts'
import {
  formatListing,
  formatOutline,
  formatOutlineOrListing,
  formatPage,
  parseReadWikiArgs,
  presentReadWikiCall,
  renderValue,
  UNAVAILABLE_TEXT,
} from '../src/index.ts'

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return { path: 'overview.md', title: 'Overview', stale: false, content: '# Overview\n\nBody.', ...overrides }
}

function fixtureProvider(overrides: Partial<RepoWikiProvider> = {}): RepoWikiProvider {
  return {
    id: 'fixture',
    async getPage(path: string): Promise<WikiPage> {
      if (path === 'overview.md') return page()
      throw new RepoWikiNotFoundError(path)
    },
    async listPages(): Promise<WikiListing> {
      return { pages: [
        { path: 'overview.md', title: 'Overview', stale: false },
        { path: 'packages.md', title: 'Packages', stale: true },
      ] }
    },
    async outline(): Promise<WikiOutlineEntry[]> {
      return [{ path: 'overview.md', title: 'Overview', stale: false, headings: ['# Overview', '## Setup'] }]
    },
    ...overrides,
  }
}

/** A NOT_FOUND-shaped error without importing the error class into every assertion. */
class RepoWikiNotFoundError extends Error {
  code = 'REPO_WIKI_NOT_FOUND'
  constructor(path: string) { super(`no wiki page at ${JSON.stringify(path)}`) }
}

describe('parseReadWikiArgs', () => {
  it('selects the listing mode when path is absent or blank and drops an inert outline flag', () => {
    expect(parseReadWikiArgs({})).toEqual({})
    expect(parseReadWikiArgs({ path: '   ' })).toEqual({})
    expect(parseReadWikiArgs({ path: '   ', outline: false })).toEqual({})
  })

  it('trims the path and keeps outline only when requested', () => {
    expect(parseReadWikiArgs({ path: ' overview.md ' })).toEqual({ path: 'overview.md' })
    expect(parseReadWikiArgs({ path: ' overview.md ', outline: true })).toEqual({ path: 'overview.md', outline: true })
  })

  it('rejects a non-boolean outline, an outline without a path, and a non-.md path', () => {
    expect(() => parseReadWikiArgs({ outline: 'yes' as never })).toThrow(/outline must be a boolean/)
    expect(() => parseReadWikiArgs({ outline: true })).toThrow(/outline requires a wiki page path/)
    expect(() => parseReadWikiArgs({ path: 'overview.txt' })).toThrow(/ending in \.md/)
    expect(() => parseReadWikiArgs({ path: '   ', outline: true })).toThrow(/outline requires a wiki page path/)
  })
})

describe('rendering helpers', () => {
  it('prefixes a staleness notice and bounds the page body including the notice', () => {
    expect(formatPage(page(), 16_000)).toBe('# Overview\n\nBody.')
    expect(formatPage(page({ stale: true }), 16_000)).toBe('[stale: the sources behind this page changed after it was generated]\n\n# Overview\n\nBody.')
    const bounded = formatPage(page({ content: 'x'.repeat(500) }), 80)
    expect(bounded.length).toBeLessThanOrEqual(80)
    expect(bounded).toContain('truncated')
  })

  it('renders the listing as one line per page and a distinct empty line', () => {
    expect(formatListing({ pages: [
      { path: 'overview.md', title: 'Overview', stale: false },
      { path: 'packages.md', title: 'Packages', stale: true },
    ] }, 16_000)).toBe('overview.md — Overview\npackages.md — Packages [stale]')
    expect(formatListing({ pages: [] }, 16_000)).toBe('The wiki has no pages yet.')
  })

  it('renders the outline with indented headings and a distinct empty line', () => {
    expect(formatOutline([
      { path: 'overview.md', title: 'Overview', stale: true, headings: ['# Overview', '## Setup'] },
    ], 16_000)).toBe('overview.md — Overview [stale]\n  # Overview\n  ## Setup')
    expect(formatOutline([], 16_000)).toBe('The wiki has no pages yet.')
  })

  it('presents a generic search card titled by the mode', () => {
    expect(presentReadWikiCall({})).toEqual({ card: 'generic', kind: 'search', title: 'Read wiki: list pages' })
    expect(presentReadWikiCall({ path: ' overview.md ' })).toEqual({ card: 'generic', kind: 'search', title: 'Read wiki: overview.md' })
  })

  it('renders the unavailable answer verbatim', () => {
    expect(renderValue({ status: 'unavailable' }, 16_000)).toBe(UNAVAILABLE_TEXT)
  })

  it('renders a page envelope, filling in fallbacks for missing metadata', () => {
    expect(renderValue({ status: 'ok', path: 'a.md', title: 'A', stale: true, content: '# A' }, 16_000))
      .toBe('[stale: the sources behind this page changed after it was generated]\n\n# A')
    expect(renderValue({ status: 'ok', path: 'a.md', content: '# A' }, 16_000)).toBe('# A')
  })

  it('renders a listing fallback for a missing pages array and empty listings', () => {
    expect(renderValue({ status: 'ok' }, 16_000)).toBe('The wiki has no pages yet.')
    expect(formatOutlineOrListing([], 16_000)).toBe('The wiki has no pages yet.')
  })

  it('renders entries without headings as a listing and fills missing heading arrays in outlines', () => {
    const mixed = [
      { path: 'a.md', title: 'A', stale: false },
      { path: 'b.md', title: 'B', stale: true, headings: ['# B'] },
    ]
    expect(formatOutlineOrListing(mixed, 16_000)).toBe('a.md — A\nb.md — B [stale]\n  # B')
  })

  it('bounds a result even when the truncation notice itself exceeds the limit', () => {
    expect(formatPage(page({ content: 'x'.repeat(100) }), 5)).toBe('\n… re')
  })
})

/** Mount the tool over the real seam with an optional scripted provider. */
async function mountTool(provider?: RepoWikiProvider): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(RepoWiki)
  if (provider) ctx.repoWiki.registerProvider(provider)
  await ctx.plugin(ToolRepoWiki, {})
  return ctx
}

let seq = 0
const signal = new AbortController().signal
function execute(ctx: Context, args: unknown) {
  return ctx.tools.execute({ signal, callId: `c-${++seq}` as never, name: 'read_wiki', arguments: args })
}
const asText = (blocks: Array<{ type: string; text?: string }>) => blocks.map(b => b.text ?? '').join('\n')

describe('tool read_wiki', () => {
  it('registers the tool and its prompt section with the default timeout', async () => {
    const ctx = await mountTool()
    expect(ctx.tools.get('read_wiki')).toBeDefined()
    expect(ctx.tools.get('read_wiki')?.timeoutMs).toBe(DEFAULT_REPO_WIKI_TOOL_TIMEOUT_MS)
    expect(ctx.tools.get('read_wiki')?.isConcurrencySafe?.({})).toBe(true)
    const prompt = await ctx.systemPrompt.assemble()
    expect(prompt.sections.map(section => section.text).join('\n')).toContain(REPO_WIKI_PROMPT_TEXT)
  })

  it('lists every page with staleness when called without arguments', async () => {
    const ctx = await mountTool(fixtureProvider())
    const result = await execute(ctx, {})
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toBe('overview.md — Overview\npackages.md — Packages [stale]')
  })

  it('returns one page’s content and, with outline, its headings', async () => {
    const ctx = await mountTool(fixtureProvider())
    const full = await execute(ctx, { path: 'overview.md' })
    expect(asText(full.content)).toBe('# Overview\n\nBody.')
    const outlined = await execute(ctx, { path: 'overview.md', outline: true })
    expect(asText(outlined.content)).toBe('overview.md — Overview\n  # Overview\n  ## Setup')
  })

  it('propagates a missing page as a tool error, not an unavailable answer', async () => {
    const ctx = await mountTool(fixtureProvider())
    const result = await execute(ctx, { path: 'missing.md' })
    expect(result.isError).toBe(true)
    expect(asText(result.content)).not.toMatch(/not available/i)
    const missingOutline = await execute(ctx, { path: 'missing.md', outline: true })
    expect(missingOutline.isError).toBe(true)
    expect(asText(missingOutline.content)).not.toMatch(/not available/i)
  })

  it('returns an actionable unavailable answer with no provider, without failing the session', async () => {
    const ctx = await mountTool()
    const result = await execute(ctx, {})
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toMatch(/not available/i)
    expect(asText(result.content)).toContain('search_codebase/grep/read')
  })
})

it('validates the timeout budget and result cap before registering the tool', () => {
  expect(() => { ToolRepoWiki.apply(new Context(), { timeoutMs: 0, maxResultChars: 100 }) }).toThrow('timeoutMs')
  expect(() => { ToolRepoWiki.apply(new Context(), { timeoutMs: Number.POSITIVE_INFINITY, maxResultChars: 100 }) }).toThrow('timeoutMs')
  expect(() => { ToolRepoWiki.apply(new Context(), { maxResultChars: 0, timeoutMs: 100 }) }).toThrow('maxResultChars')
})
