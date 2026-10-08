import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import CodeIndex from '@deepseek-ai/dsh-code-index'
import * as CodeIndexSqlite from '@deepseek-ai/dsh-code-index-sqlite'

const temporaryDirectories: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** Build a fixture workspace with a few indexed text files and mount the provider over it. */
async function mountIndexed(
  files: Record<string, string>,
  overrides: Partial<CodeIndexSqlite.Config> = {},
): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-'))
  temporaryDirectories.push(root)
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = join(root, ...relativePath.split('/'))
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, contents, 'utf8')
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(CodeIndex)
  await ctx.plugin(CodeIndexSqlite, { path: ':memory:', root, openAt: 'startup', ...overrides })
  return ctx
}

/** A resolved-config for direct provider construction (structurally matches the internal type). */
const baseConfig = {
  path: ':memory:',
  root: '',
  openAt: 'startup' as const,
  journalMode: 'wal' as const,
  defaultLimit: 20,
  maxLimit: 200,
  snippetChars: 240,
  chunkLines: 40,
  maxFileBytes: 1_000_000,
  maxFiles: 20_000,
  skipDirs: new Set<string>(),
  includeMatchers: [] as RegExp[],
  excludeMatchers: [] as RegExp[],
  semantic: true,
}

describe('SqliteCodeIndexProvider end-to-end', () => {
  it('indexes a fixture tree and returns BM25-ranked snippet hits for a needle', async () => {
    const ctx = await mountIndexed({
      'src/a.ts': 'export const alpha = 1\nfunction needleAlpha() { return "needle here" }\n',
      'src/util/b.ts': 'const beta = 2\n// needle here too\nexport { beta }\n',
      'notes.md': 'prose mentioning a needle once\n',
    })

    const page = await ctx.codeIndex.search({ query: 'needle' })
    const paths = page.hits.map(hit => hit.path).sort()
    expect(paths).toEqual(['notes.md', 'src/a.ts', 'src/util/b.ts'])
    for (const hit of page.hits) {
      expect(hit.snippet.toLowerCase()).toContain('needle')
      expect(hit.startLine).toBeGreaterThanOrEqual(1)
      expect(hit.endLine).toBeGreaterThanOrEqual(hit.startLine)
    }
    // Scores are higher-is-better (derived from -bm25).
    for (const hit of page.hits) expect(hit.score).toBeTypeOf('number')
    expect(page.hits.map(hit => hit.score)).toEqual([...page.hits.map(hit => hit.score)].sort((x, y) => y - x))
  })

  it('narrows results by glob and by language', async () => {
    const ctx = await mountIndexed({
      'src/a.ts': 'needle here\n',
      'src/util/b.ts': 'needle here\n',
      'notes.md': 'needle here\n',
    })

    const scoped = await ctx.codeIndex.search({ query: 'needle', glob: 'src/*.ts' })
    expect(scoped.hits.map(hit => hit.path).sort()).toEqual(['src/a.ts', 'src/util/b.ts'])

    const markdown = await ctx.codeIndex.search({ query: 'needle', language: 'markdown' })
    expect(markdown.hits.map(hit => hit.path)).toEqual(['notes.md'])
  })

  it('honors a result limit and returns an empty page when nothing matches', async () => {
    const ctx = await mountIndexed({
      'a.ts': 'needle one\n',
      'b.ts': 'needle two\n',
      'c.ts': 'unrelated text\n',
    })

    const capped = await ctx.codeIndex.search({ query: 'needle', limit: 1 })
    expect(capped.hits).toHaveLength(1)

    const none = await ctx.codeIndex.search({ query: 'no-such-token-xyzzy' })
    expect(none.hits).toEqual([])
  })

  it('records a language id from the file extension on each hit', async () => {
    const ctx = await mountIndexed({ 'src/svc.go': 'package main // needle\n' })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits).toHaveLength(1)
    expect(page.hits[0]?.language).toBe('go')
  })
})

describe('SqliteCodeIndexProvider reindex reconciliation', () => {
  it('skips unchanged files, reindexes changed ones, and drops deleted ones on a second open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-reindex-'))
    temporaryDirectories.push(root)
    const dbPath = join(root, 'index.sqlite')
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'stable.ts'), 'needle stable\n')
    await writeFile(join(workspace, 'src', 'shrink.ts'), 'needle baseline content\n')
    await writeFile(join(workspace, 'src', 'same-size.ts'), 'needle here\n')
    await writeFile(join(workspace, 'src', 'gone.ts'), 'needle vanishing\n')

    const first = new CodeIndexSqlite.SqliteCodeIndexProvider({ ...baseConfig, path: dbPath, root: workspace })
    await first.prime()
    await first.close()

    // A size change (shrink.ts), a same-size content change (same-size.ts), and a deletion
    // (gone.ts) are each reconciled; stable.ts keeps its fingerprint and is skipped.
    await writeFile(join(workspace, 'src', 'shrink.ts'), 'needle\n')
    await writeFile(join(workspace, 'src', 'same-size.ts'), 'needle sync\n')
    await rm(join(workspace, 'src', 'gone.ts'))

    const second = new CodeIndexSqlite.SqliteCodeIndexProvider({ ...baseConfig, path: dbPath, root: workspace })
    await second.prime()
    expect((await second.search({ query: 'vanishing' })).hits).toEqual([])
    expect((await second.search({ query: 'sync' })).hits.map(hit => hit.path)).toEqual(['src/same-size.ts'])
    expect((await second.search({ query: 'needle' })).hits).toHaveLength(3)
    await second.close()
  })
})

describe('SqliteCodeIndexProvider scan filters', () => {
  it('skips binary-looking and blank files while indexing extension-less text', async () => {
    const ctx = await mountIndexed({
      'binary.txt': 'needle\0binary payload\n',
      'blank.txt': '   \n\n',
      'Makefile': 'needle in Makefile\n',
    })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits.map(hit => hit.path)).toEqual(['Makefile'])
    expect(page.hits[0]?.language).toBeUndefined()
  })

  it('applies include and exclude globs to relative paths before scanning', async () => {
    const ctx = await mountIndexed({
      'src/q1.ts': 'needle kept\n',
      'src/util/x.ts': 'needle nested\n',
      'notes.md': 'needle excluded\n',
      'win/file1.txt': 'needle winpath\n',
      'win/file10.txt': 'needle renamed\n',
    }, { includeGlobs: ['src/*.ts', 'win/file?.txt'], excludeGlobs: ['*.md'] })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits.map(hit => hit.path).sort()).toEqual(['src/q1.ts', 'src/util/x.ts', 'win/file1.txt'])
  })

  it('skips the built-in and configured directory names during the walk', async () => {
    const ctx = await mountIndexed({
      'src/c.ts': 'needle kept\n',
      'node_modules/b.ts': 'needle vendored\n',
      'custom-skip/a.ts': 'needle skipped\n',
    }, { skipDirs: ['custom-skip'] })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits.map(hit => hit.path)).toEqual(['src/c.ts'])
  })

  it('enforces the file-count ceiling', async () => {
    const ctx = await mountIndexed({
      'a.ts': 'needle a\n',
      'b.ts': 'needle b\n',
      'c.ts': 'needle c\n',
    }, { maxFiles: 1 })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits).toHaveLength(1)
  })

  it('skips oversized files and binary extensions', async () => {
    const ctx = await mountIndexed({
      'small.ts': 'needle small\n',
      'big.ts': 'needle '.repeat(20),
      'logo.png': 'needle in a png\n',
    }, { maxFileBytes: 16 })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits.map(hit => hit.path)).toEqual(['small.ts'])
  })
})

describe('SqliteCodeIndexProvider open modes and lifecycle', () => {
  it('opens lazily at the first search when configured', async () => {
    const ctx = await mountIndexed({ 'a.ts': 'needle lazy\n' }, { openAt: 'first-search' })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits.map(hit => hit.path)).toEqual(['a.ts'])
  })

  it('survives a failing startup prime instead of crashing the plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-prime-'))
    temporaryDirectories.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(CodeIndex)
    // A directory path cannot open as a database, so the fire-and-forget startup prime rejects.
    await ctx.plugin(CodeIndexSqlite, { path: root, root, openAt: 'startup' })
    await new Promise<void>((resolve) => { setTimeout(resolve, 200) })
  })

  it('falls back to every documented default when applied without schema validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-defaults-'))
    temporaryDirectories.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(CodeIndex)
    CodeIndexSqlite.apply(ctx, { path: ':memory:', root })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits).toEqual([])
  })

  it('closes idempotently and rejects every search after close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-dispose-'))
    temporaryDirectories.push(root)
    const provider = new CodeIndexSqlite.SqliteCodeIndexProvider({ ...baseConfig, root })
    await provider.prime()
    await provider.close()
    await provider.close()
    await expect(provider.search({ query: 'needle' })).rejects.toThrow(/disposed/)
  })

  it('honors an already-aborted signal before touching the database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-abort-'))
    temporaryDirectories.push(root)
    const provider = new CodeIndexSqlite.SqliteCodeIndexProvider({ ...baseConfig, root })
    const controller = new AbortController()
    controller.abort()
    await expect(provider.search({ query: 'needle' }, controller.signal)).rejects.toThrow(/abort/i)
    await provider.close()
  })

  it('retries after an aborted prime instead of caching the rejection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-reprime-'))
    temporaryDirectories.push(root)
    const provider = new CodeIndexSqlite.SqliteCodeIndexProvider({ ...baseConfig, root })
    const controller = new AbortController()
    controller.abort()
    await expect(provider.prime(controller.signal)).rejects.toThrow(/abort/i)
    await provider.prime()
    const page = await provider.search({ query: 'needle' })
    expect(page.hits).toEqual([])
    await provider.close()
  })

  it('retries a failed open on the next call instead of caching the rejection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-badpath-'))
    temporaryDirectories.push(root)
    // A directory path cannot open as a database, so every attempt fails.
    const provider = new CodeIndexSqlite.SqliteCodeIndexProvider({ ...baseConfig, path: root, root })
    await expect(provider.search({ query: 'needle' })).rejects.toThrow()
    await expect(provider.search({ query: 'needle' })).rejects.toThrow()
    await provider.close()
  })
})
