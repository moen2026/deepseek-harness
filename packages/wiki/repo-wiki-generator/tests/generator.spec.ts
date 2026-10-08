import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RepoWiki from '@deepseek-ai/dsh-repo-wiki'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  buildGenerationRequest,
  extractText,
  headingTitle,
  isStale,
  outlineHeadings,
  pageNameFor,
  parsePage,
  serializePage,
  sourceFingerprint,
} from '../src/pages.ts'
import { FsWikiProvider, collectSources, matchesSourceGlob } from '../src/index.ts'
import type { Config, WikiLlm } from '../src/index.ts'
import * as Generator from '../src/index.ts'

describe('page vocabulary', () => {
  it('flattens source paths into page names and rejects unusable ones', () => {
    expect(pageNameFor('manual/subsystems/audio.md')).toBe('manual-subsystems-audio.md')
    expect(pageNameFor('packages\\memory\\memory\\README.md')).toBe('packages-memory-memory-README.md')
    expect(pageNameFor('/edges--.md')).toBe('edges.md')
    expect(() => pageNameFor('///.md')).toThrow(/no usable page name/)
  })

  it('derives titles from the first level-1 heading with a fallback', () => {
    expect(headingTitle('# Title here\n\nbody')).toBe('Title here')
    expect(headingTitle('## only h2')).toBe('(untitled wiki page)')
    expect(headingTitle('#    \n')).toBe('(untitled wiki page)')
  })

  it('collects heading lines in order', () => {
    expect(outlineHeadings('# a\nbody\n## b\ntext\n### c')).toEqual(['# a', '## b', '### c'])
  })

  it('compares fingerprints for staleness', () => {
    const print = sourceFingerprint({ size: 12, mtimeMs: 1234.6 })
    expect(print).toBe('12:1235')
    expect(isStale(print, print)).toBe(false)
    expect(isStale(print, '12:9999')).toBe(true)
    expect(isStale(undefined, print)).toBe(true)
  })

  it('round-trips front matter through serialize and parse', () => {
    const page = serializePage('manual/a.md', '12:34', '# A\n\nbody\n')
    expect(parsePage(page)).toEqual({ source: 'manual/a.md', fingerprint: '12:34', body: '# A\n\nbody' })
  })

  it('treats missing, unclosed, and malformed front matter as metadata-free', () => {
    expect(parsePage('just body')).toEqual({ source: undefined, fingerprint: undefined, body: 'just body' })
    expect(parsePage('---\nno close\n')).toEqual({ source: undefined, fingerprint: undefined, body: '---\nno close\n' })
    const malformed = parsePage('---\ndsh-wiki-fingerprint: not json\n---\n\nbody')
    expect(malformed.source).toBeUndefined()
    expect(malformed.fingerprint).toBeUndefined()
    expect(malformed.body).toBe('body')
  })

  it('frames generation requests with truncation', () => {
    const short = buildGenerationRequest('a.md', 'body', 100)
    expect(short.system).toContain('repository wiki')
    expect(short.text).toContain('`a.md`')
    expect(short.text).not.toContain('truncated')
    const long = buildGenerationRequest('a.md', 'x'.repeat(150), 100)
    expect(long.text).toContain('[... truncated, 50 more characters]')
  })

  it('extracts text blocks and refuses empty responses', () => {
    expect(extractText([{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'r' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(() => extractText([{ type: 'text' }])).toThrow(/no text content/)
    expect(() => extractText([{ type: 'reasoning', text: 'r' }])).toThrow(/no text content/)
  })
})

describe('source scanning', () => {
  it('matches segment globs and cross-segment globs', () => {
    expect(matchesSourceGlob('manual/subsystems/audio.md', 'manual/subsystems/*.md')).toBe(true)
    expect(matchesSourceGlob('manual/subsystems/nested/audio.md', 'manual/subsystems/*.md')).toBe(false)
    expect(matchesSourceGlob('a/b/c.md', 'a/**/*.md')).toBe(true)
    expect(matchesSourceGlob('a/c.md', 'a/**/*.md')).toBe(true)
    expect(matchesSourceGlob('a/c.md', 'a/?.md')).toBe(true)
    expect(matchesSourceGlob('a/cc.md', 'a/?.md')).toBe(false)
    expect(matchesSourceGlob('a/b.md', 'a/b.md')).toBe(true)
    expect(matchesSourceGlob('a/mid/b.md', 'a/**/b.md')).toBe(true)
    expect(matchesSourceGlob('a/b/c.md', 'a/**/b.md')).toBe(false)
    expect(matchesSourceGlob('manual/x.md', 'manual/**')).toBe(true)
    expect(matchesSourceGlob('manual/x/y.md', 'manual/**')).toBe(true)
  })

  it('collects matching markdown sources in sorted order, skipping hidden and derived trees', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-wiki-scan-'))
    writeFileSync(join(root, 'README.md'), 'root readme\n', 'utf8')
    mkdirSync(join(root, 'packages', 'alpha', 'lib'), { recursive: true })
    mkdirSync(join(root, 'packages', 'alpha', 'src'), { recursive: true })
    writeFileSync(join(root, 'packages', 'alpha', 'README.md'), 'alpha\n', 'utf8')
    writeFileSync(join(root, 'packages', 'alpha', 'lib', 'skip.md'), 'generated\n', 'utf8')
    writeFileSync(join(root, 'packages', 'alpha', 'src', 'impl.ts'), 'code\n', 'utf8')
    writeFileSync(join(root, 'packages', 'alpha', '.hidden.md'), 'hidden\n', 'utf8')
    writeFileSync(join(root, 'packages', 'alpha', 'notes.md'), 'no pattern match\n', 'utf8')
    const found = collectSources(root, ['README.md', 'packages/*/README.md'])
    expect(found).toEqual(['README.md', 'packages/alpha/README.md'])
  })
})

/** A fake LLM that yields one text chunk with the canned page body. */
function fakeLlm(body: string, failures = 0): { llm: WikiLlm; requests: GenerateOptions[] } {
  const requests: GenerateOptions[] = []
  return {
    requests,
    llm: {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(options)
        if (requests.length <= failures) throw new Error('route down')
        yield { type: 'text-delta', index: 0, text: body }
      },
    },
  }
}

function providerConfig(root: string, overrides: Partial<Config> = {}): Config {
  return {
    root,
    outDir: '.dsh/wiki',
    sources: ['manual/*.md'],
    llmProvider: 'deepseek',
    llmModel: 'test-model',
    maxSourceChars: 24_000,
    maxTokens: 4096,
    timeoutMs: 60_000,
    regenerateAt: 'never',
    ...overrides,
  }
}

describe('FsWikiProvider', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wiki-fs-'))
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('regenerates pages for sources, skips unchanged ones, and removes orphans', async () => {
    mkdirSync(join(root, 'manual'), { recursive: true })
    writeFileSync(join(root, 'manual', 'guide.md'), '# Guide\n\nHow to use it.\n', 'utf8')
    writeFileSync(join(root, 'manual', 'orphan.md'), 'to be removed\n', 'utf8')
    // A pre-existing page whose recorded fingerprint still matches its source: skipped, not regenerated.
    mkdirSync(join(root, '.dsh', 'wiki'), { recursive: true })
    const kept = join(root, '.dsh', 'wiki', 'manual-guide.md')
    writeFileSync(kept, serializePage('manual/guide.md', sourceFingerprint(statSync(join(root, 'manual', 'guide.md'))), '# Guide (cached)'), 'utf8')
    const { llm, requests } = fakeLlm('# Orphan page\n\nGenerated body.\n')

    const provider = new FsWikiProvider(providerConfig(root) as never, llm)
    const first = await provider.regenerate()
    expect([...first.generated].sort()).toEqual(['manual-orphan.md'])
    expect(first.skipped).toEqual(['manual-guide.md'])
    expect(first.removed).toEqual([])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.model).toBe('test-model')

    const second = await provider.regenerate()
    expect([...second.skipped].sort()).toEqual(['manual-guide.md', 'manual-orphan.md'])
    expect(second.generated).toEqual([])

    // Orphan removal only touches non-live pages recorded in the store.
    rmSync(join(root, 'manual', 'orphan.md'))
    const third = await provider.regenerate()
    expect(third.removed).toEqual(['manual-orphan.md'])

    await expect(provider.getPage('manual-guide.md')).resolves.toMatchObject({ title: 'Guide (cached)', stale: false, path: 'manual-guide.md' })
    await expect(provider.getPage('missing.md')).rejects.toMatchObject({ code: 'REPO_WIKI_NOT_FOUND' })
    const listing = await provider.listPages()
    expect(listing.pages.map(page => page.path)).toEqual(['manual-guide.md'])
    const outline = await provider.outline()
    expect(outline[0]?.headings).toEqual(['# Guide (cached)'])
  })

  it('marks pages stale when their source changes and unknown sources as always stale', async () => {
    mkdirSync(join(root, 'manual'), { recursive: true })
    writeFileSync(join(root, 'manual', 'live.md'), '# Live\n', 'utf8')
    const { llm } = fakeLlm('# Live page\n')
    const provider = new FsWikiProvider(providerConfig(root) as never, llm)
    await provider.regenerate()
    await expect(provider.getPage('manual-live.md')).resolves.toMatchObject({ stale: false })

    // Change the source's mtime without changing its size fingerprint text.
    utimesSync(join(root, 'manual', 'live.md'), new Date(), new Date(1_000_000))
    await expect(provider.getPage('manual-live.md')).resolves.toMatchObject({ stale: true })
    await expect(provider.listPages()).resolves.toMatchObject({ pages: [{ stale: true }] })

    // A hand-written page without front matter reads as stale and untitled.
    writeFileSync(join(root, '.dsh', 'wiki', 'hand-made.md'), 'no metadata here\n', 'utf8')
    await expect(provider.getPage('hand-made.md')).resolves.toMatchObject({ stale: true, title: '(untitled wiki page)' })
  })

  it('regenerates a page whose recorded fingerprint no longer matches its source', async () => {
    mkdirSync(join(root, 'manual'), { recursive: true })
    writeFileSync(join(root, 'manual', 'guide.md'), '# Guide\n', 'utf8')
    mkdirSync(join(root, '.dsh', 'wiki'), { recursive: true })
    writeFileSync(join(root, '.dsh', 'wiki', 'manual-guide.md'), serializePage('manual/guide.md', '1:1', '# Old'), 'utf8')
    const { llm, requests } = fakeLlm('# New page\n')
    const provider = new FsWikiProvider(providerConfig(root) as never, llm)
    const outcome = await provider.regenerate()
    expect(outcome.generated).toEqual(['manual-guide.md'])
    expect(requests).toHaveLength(1)
    await expect(provider.getPage('manual-guide.md')).resolves.toMatchObject({ title: 'New page', stale: false })
  })

  it('reads a page whose recorded source disappeared as stale', async () => {
    mkdirSync(join(root, '.dsh', 'wiki'), { recursive: true })
    writeFileSync(join(root, '.dsh', 'wiki', 'gone.md'), serializePage('manual/gone.md', '1:1', '# Gone'), 'utf8')
    const { llm } = fakeLlm('# x\n')
    const provider = new FsWikiProvider(providerConfig(root) as never, llm)
    await expect(provider.getPage('gone.md')).resolves.toMatchObject({ title: 'Gone', stale: true })
  })

  it('propagates LLM failures from the regeneration pass', async () => {
    mkdirSync(join(root, 'manual'), { recursive: true })
    writeFileSync(join(root, 'manual', 'broken.md'), '# Broken\n', 'utf8')
    const { llm } = fakeLlm('# never\n', 1)
    const provider = new FsWikiProvider(providerConfig(root) as never, llm)
    await expect(provider.regenerate()).rejects.toThrow(/route down/)
  })

  it('listPages reads as empty before any page exists', async () => {
    const { llm } = fakeLlm('# x\n')
    const provider = new FsWikiProvider(providerConfig(root) as never, llm)
    await expect(provider.listPages()).resolves.toEqual({ pages: [] })
    await expect(provider.outline()).resolves.toEqual([])
  })
})

describe('plugin apply', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wiki-apply-'))
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  /** Mount the plugin over a real seam on a rooted context with a scripted LLM. */
  function harness(llm: WikiLlm): {
    seam: InstanceType<typeof RepoWiki>
    applyConfig: (config: Config) => void
    disposeProvider: () => Promise<void>
  } {
    const ctx = new Context()
    const seam = new RepoWiki(ctx)
    ctx.provide('llm', llm as never)
    return {
      seam,
      applyConfig: (config) => { Generator.apply(ctx, config) },
      disposeProvider: () => ctx.fiber.dispose(),
    }
  }

  it('rejects invalid config before touching the context', () => {
    const { applyConfig } = harness(fakeLlm('# x').llm)
    expect(() => { applyConfig(providerConfig(root, { maxSourceChars: 0 })) }).toThrow('maxSourceChars')
    expect(() => { applyConfig(providerConfig(root, { maxSourceChars: 1.5 })) }).toThrow('maxSourceChars')
    expect(() => { applyConfig(providerConfig(root, { maxTokens: 0 })) }).toThrow('maxTokens')
    expect(() => { applyConfig(providerConfig(root, { outDir: '   ' })) }).toThrow('outDir')
  })

  it('registers the provider through the seam and releases it on disposal', async () => {
    const { seam, applyConfig, disposeProvider } = harness(fakeLlm('# x').llm)
    applyConfig(providerConfig(root, { regenerateAt: 'never' }))
    await expect(seam.listPages()).resolves.toEqual({ pages: [] })
    await disposeProvider()
    await expect(seam.listPages()).rejects.toMatchObject({ code: 'REPO_WIKI_UNAVAILABLE' })
  })

  it('runs one regeneration pass at startup and swallows its failures', async () => {
    mkdirSync(join(root, 'manual'), { recursive: true })
    writeFileSync(join(root, 'manual', 'intro.md'), '# Intro\n', 'utf8')
    const { seam, applyConfig } = harness(fakeLlm('# Intro page\n').llm)
    applyConfig(providerConfig(root, { regenerateAt: 'startup' }))
    await new Promise(resolve => setTimeout(resolve, 50))
    await expect(seam.getPage('manual-intro.md')).resolves.toMatchObject({ title: 'Intro page' })

    const brokenRoot = mkdtempSync(join(tmpdir(), 'dsh-wiki-apply-broken-'))
    mkdirSync(join(brokenRoot, 'manual'), { recursive: true })
    writeFileSync(join(brokenRoot, 'manual', 'boom.md'), '# Boom\n', 'utf8')
    const broken = harness(fakeLlm('# x\n', 1).llm)
    broken.applyConfig(providerConfig(brokenRoot, { regenerateAt: 'startup' }))
    await new Promise(resolve => setTimeout(resolve, 50))
    await expect(broken.seam.listPages()).resolves.toEqual({ pages: [] })
    rmSync(brokenRoot, { recursive: true, force: true })
  })
})
