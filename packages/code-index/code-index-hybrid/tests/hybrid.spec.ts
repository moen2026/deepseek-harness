import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import CodeIndex, { CodeIndexError } from '@deepseek-ai/dsh-code-index'
import * as CodeIndexSqlite from '@deepseek-ai/dsh-code-index-sqlite'
import * as CodeIndexHybrid from '@deepseek-ai/dsh-code-index-hybrid'
import type { Embedder } from '@deepseek-ai/dsh-memory-sqlite'

const temporaryDirectories: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** Build a fixture workspace and mount the hybrid provider over it. */
async function mountHybrid(
  files: Record<string, string>,
  overrides: Partial<CodeIndexHybrid.Config> = {},
): Promise<Context> {
  const root = await buildWorkspace(files)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(CodeIndex)
  await ctx.plugin(CodeIndexHybrid, { path: ':memory:', root, openAt: 'startup', ...overrides })
  return ctx
}

/** Build a fixture workspace directory and register it for cleanup. */
async function buildWorkspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-hybrid-'))
  temporaryDirectories.push(root)
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = join(root, ...relativePath.split('/'))
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, contents, 'utf8')
  }
  return root
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
  chunkOverlap: 4,
  maxFileBytes: 1_000_000,
  maxFiles: 20_000,
  skipDirs: new Set<string>(),
  includeMatchers: [] as RegExp[],
  excludeMatchers: [] as RegExp[],
  embedding: undefined,
}

const fakeEndpoint = { url: 'http://127.0.0.1:9/v1/embeddings', model: 'fake', authEnv: 'DSH_HYBRID_TEST_KEY', dimension: 128 } as const

/** A deterministic in-process embedder standing in for the deployment endpoint. */
const fakeEmbedder: Embedder = {
  async embed(texts) {
    return texts.map(text => Array.from(CodeIndexSqlite.decodeVector(CodeIndexSqlite.embedVector(text))))
  },
}

const failingEmbedder: Embedder = {
  async embed() {
    throw new Error('embedding endpoint down')
  },
}

describe('HybridCodeIndexProvider end-to-end', () => {
  it('indexes a fixture tree and returns BM25-ranked snippet hits for a needle', async () => {
    const ctx = await mountHybrid({
      'src/math.ts': 'export function addVectors(a: number, b: number): number {\n  return a + b\n}\n\nexport function scale(value: number): number {\n  return value * 2\n}\n',
      'notes.md': 'prose about scaling systems\n',
    })

    const page = await ctx.codeIndex.search({ query: 'addVectors' })
    expect(page.hits.map(hit => hit.path)).toEqual(['src/math.ts'])
    expect(page.hits[0]?.startLine).toBe(1)
    expect(page.hits[0]?.language).toBe('typescript')
    expect(page.hits[0]?.snippet.toLowerCase()).toContain('addvectors')
  })

  it('narrows results by glob and language and honors the limit', async () => {
    const ctx = await mountHybrid({
      'src/a.ts': 'needle here\n',
      'src/util/b.ts': 'needle here\n',
      'notes.md': 'needle here\n',
    })

    const scoped = await ctx.codeIndex.search({ query: 'needle', glob: 'src/*.ts' })
    expect(scoped.hits.map(hit => hit.path).sort()).toEqual(['src/a.ts', 'src/util/b.ts'])
    const markdown = await ctx.codeIndex.search({ query: 'needle', language: 'markdown' })
    expect(markdown.hits.map(hit => hit.path)).toEqual(['notes.md'])
    const capped = await ctx.codeIndex.search({ query: 'needle', limit: 1 })
    expect(capped.hits).toHaveLength(1)
  })

  it('skips binary-looking files, binary extensions, and built-in skip directories', async () => {
    const ctx = await mountHybrid({
      'binary.txt': 'needle\0binary payload\n',
      'logo.png': 'needle in a png\n',
      'node_modules/vendored.ts': 'needle vendored\n',
      'src/kept.ts': 'needle kept\n',
    })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits.map(hit => hit.path)).toEqual(['src/kept.ts'])
  })

  it('applies include and exclude globs and the configured directory skips', async () => {
    const ctx = await mountHybrid({
      'src/q1.ts': 'needle kept\n',
      'src/util/x.ts': 'needle nested\n',
      'notes.md': 'needle excluded\n',
      'custom-skip/a.ts': 'needle skipped\n',
    }, { includeGlobs: ['src/*.ts'], excludeGlobs: ['*.md'], skipDirs: ['custom-skip'] })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits.map(hit => hit.path).sort()).toEqual(['src/q1.ts', 'src/util/x.ts'])
  })

  it('enforces the file-count and file-size ceilings', async () => {
    const counted = await mountHybrid({
      'a.ts': 'needle a\n',
      'b.ts': 'needle b\n',
    }, { maxFiles: 1 })
    expect((await counted.codeIndex.search({ query: 'needle' })).hits).toHaveLength(1)

    const sized = await mountHybrid({
      'small.ts': 'needle small\n',
      'big.ts': 'needle '.repeat(20),
    }, { maxFileBytes: 16 })
    expect((await sized.codeIndex.search({ query: 'needle' })).hits.map(hit => hit.path)).toEqual(['small.ts'])
  })

  it('opens lazily at the first search when configured', async () => {
    const ctx = await mountHybrid({ 'a.ts': 'needle lazy\n' }, { openAt: 'first-search' })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits.map(hit => hit.path)).toEqual(['a.ts'])
  })

  it('falls back to every documented default when applied without schema validation', async () => {
    const root = await buildWorkspace({ 'a.ts': 'needle default\n' })
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(CodeIndex)
    CodeIndexHybrid.apply(ctx, { path: ':memory:', root })
    const page = await ctx.codeIndex.search({ query: 'needle' })
    expect(page.hits.map(hit => hit.path)).toEqual(['a.ts'])
  })
})

describe('HybridCodeIndexProvider fusion', () => {
  it('recalls a semantic-only match the BM25 phrase cannot reach', async () => {
    const root = await buildWorkspace({
      'src/vec.ts': 'export function addVectors(a: number, b: number): number {\n  return a + b\n}\n',
      'src/other.ts': 'export function unrelated(w: number): number {\n  return w\n}\n',
    })
    const provider = new CodeIndexHybrid.HybridCodeIndexProvider(
      { ...baseConfig, root, embedding: { ...fakeEndpoint } },
      fakeEmbedder,
    )
    // The phrase "add vectors" matches no token in addVectors, so this hit is semantic-only.
    const page = await provider.search({ query: 'add vectors' })
    expect(page.hits.map(hit => hit.path)).toEqual(['src/vec.ts'])
    await provider.close()
  })

  it('keeps vectors usable across restarts when files are unchanged', async () => {
    const root = await buildWorkspace({
      'src/vec.ts': 'export function addVectors(a: number, b: number): number {\n  return a + b\n}\n',
    })
    const dbPath = join(root, 'index.sqlite')
    const first = new CodeIndexHybrid.HybridCodeIndexProvider(
      { ...baseConfig, path: dbPath, root, embedding: { ...fakeEndpoint } },
      fakeEmbedder,
    )
    await first.prime()
    await first.close()
    const second = new CodeIndexHybrid.HybridCodeIndexProvider(
      { ...baseConfig, path: dbPath, root, embedding: { ...fakeEndpoint } },
      fakeEmbedder,
    )
    await second.prime()
    const page = await second.search({ query: 'add vectors' })
    expect(page.hits.map(hit => hit.path)).toEqual(['src/vec.ts'])
    await second.close()
  })

  it('degrades to lexical and warns at most once when the endpoint fails', async () => {
    const root = await buildWorkspace({
      'src/math.ts': 'export function scale(value: number): number {\n  return value * 2\n}\n',
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const provider = new CodeIndexHybrid.HybridCodeIndexProvider(
      { ...baseConfig, root, embedding: { ...fakeEndpoint } },
      failingEmbedder,
    )
    // The reconcile-time embedding failure keeps the lexical corpus searchable.
    const first = await provider.search({ query: 'scale' })
    expect(first.hits.map(hit => hit.path)).toEqual(['src/math.ts'])
    // The query-time embedding failure adds no second warning.
    const second = await provider.search({ query: 'scale' })
    expect(second.hits).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('embedding endpoint unavailable')
    await provider.close()
  })
})

describe('HybridCodeIndexProvider reconciliation', () => {
  it('skips unchanged files, reindexes changed ones, and drops deleted ones on a second open', async () => {
    const root = await buildWorkspace({})
    const dbPath = join(root, 'index.sqlite')
    const workspace = join(root, 'ws')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'stable.ts'), 'needle stable\n', 'utf8')
    await writeFile(join(workspace, 'src', 'same-size.ts'), 'needle baseline\n', 'utf8')
    await writeFile(join(workspace, 'src', 'gone.ts'), 'needle vanishing\n', 'utf8')

    const first = new CodeIndexHybrid.HybridCodeIndexProvider({ ...baseConfig, path: dbPath, root: workspace }, fakeEmbedder)
    await first.prime()
    await first.close()

    await writeFile(join(workspace, 'src', 'same-size.ts'), 'needle synced\n', 'utf8')
    await rm(join(workspace, 'src', 'gone.ts'))

    const second = new CodeIndexHybrid.HybridCodeIndexProvider({ ...baseConfig, path: dbPath, root: workspace }, fakeEmbedder)
    await second.prime()
    expect((await second.search({ query: 'vanishing' })).hits).toEqual([])
    expect((await second.search({ query: 'synced' })).hits.map(hit => hit.path)).toEqual(['src/same-size.ts'])
    expect((await second.search({ query: 'needle' })).hits).toHaveLength(2)
    await second.close()
  })
})

describe('HybridCodeIndexProvider request validation and lifecycle', () => {
  it('rejects a blank query and an out-of-range limit with the typed error code', async () => {
    const root = await buildWorkspace({})
    const provider = new CodeIndexHybrid.HybridCodeIndexProvider({ ...baseConfig, root })
    const blank = await provider.search({ query: '   ' }).catch((error: unknown) => error)
    expect(blank).toBeInstanceOf(CodeIndexError)
    expect((blank as CodeIndexError).code).toBe('CODE_INDEX_INVALID_REQUEST')
    const limit = await provider.search({ query: 'needle', limit: 0 }).catch((error: unknown) => error)
    expect((limit as CodeIndexError).code).toBe('CODE_INDEX_INVALID_REQUEST')
    await provider.close()
  })

  it('closes idempotently and rejects every search after close', async () => {
    const root = await buildWorkspace({})
    const provider = new CodeIndexHybrid.HybridCodeIndexProvider({ ...baseConfig, root })
    await provider.prime()
    await provider.close()
    await provider.close()
    await expect(provider.search({ query: 'needle' })).rejects.toThrow(/disposed/)
  })

  it('honors an already-aborted signal and retries a failed prime later', async () => {
    const root = await buildWorkspace({})
    const provider = new CodeIndexHybrid.HybridCodeIndexProvider({ ...baseConfig, root })
    const controller = new AbortController()
    controller.abort()
    await expect(provider.prime(controller.signal)).rejects.toThrow(/abort/i)
    await provider.prime()
    expect((await provider.search({ query: 'needle' })).hits).toEqual([])
    await provider.close()
  })

  it('retries a failed open on the next call instead of caching the rejection', async () => {
    const root = await buildWorkspace({})
    // A directory path cannot open as a database, so every attempt fails.
    const provider = new CodeIndexHybrid.HybridCodeIndexProvider({ ...baseConfig, path: root, root })
    await expect(provider.search({ query: 'needle' })).rejects.toThrow()
    await expect(provider.search({ query: 'needle' })).rejects.toThrow()
    await provider.close()
  })

  it('fails loud when the embedding block is incomplete', async () => {
    const ctx = new Context()
    expect(() => {
      CodeIndexHybrid.apply(ctx, {
        path: ':memory:',
        root: '.',
        embedding: { url: ' ', model: 'm', authEnv: 'a', dimension: 128 },
      })
    }).toThrow(/config\.embedding is set but url, model, authEnv must be provided/)
  })
})

describe('HybridCodeIndexProvider derived database guards', () => {
  it('fails loud on a database belonging to another application', async () => {
    const root = await buildWorkspace({})
    const dbPath = join(root, 'foreign.sqlite')
    const foreign = new DatabaseSync(dbPath)
    foreign.exec('PRAGMA application_id = 12345')
    foreign.exec('CREATE TABLE t (x INTEGER)')
    foreign.close()
    const provider = new CodeIndexHybrid.HybridCodeIndexProvider({ ...baseConfig, path: dbPath, root })
    await expect(provider.prime()).rejects.toThrow(/belongs to another application/)
    await provider.close()
  })

  it('fails loud on unrecognized user tables at the current schema version', async () => {
    const root = await buildWorkspace({})
    const dbPath = join(root, 'legacy.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`PRAGMA application_id = ${CodeIndexHybrid.CODE_INDEX_HYBRID_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${CodeIndexHybrid.CODE_INDEX_HYBRID_SCHEMA_VERSION}`)
    db.exec('CREATE TABLE legacy (x INTEGER)')
    db.close()
    const provider = new CodeIndexHybrid.HybridCodeIndexProvider({ ...baseConfig, path: dbPath, root })
    await expect(provider.prime()).rejects.toThrow(/unrecognized user tables/)
    await provider.close()
  })

  it('resets an outdated schema version in place', async () => {
    const root = await buildWorkspace({ 'a.ts': 'needle reset\n' })
    const dbPath = join(root, 'outdated.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(`PRAGMA application_id = ${CodeIndexHybrid.CODE_INDEX_HYBRID_APPLICATION_ID}`)
    db.exec('PRAGMA user_version = 0')
    db.exec('CREATE TABLE code_files (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, language TEXT, generation INTEGER NOT NULL) STRICT')
    db.exec("INSERT INTO code_files VALUES ('gone.ts', 1, 1, 'ts', 0)")
    db.close()
    const provider = new CodeIndexHybrid.HybridCodeIndexProvider({ ...baseConfig, path: dbPath, root })
    await provider.prime()
    const check = new DatabaseSync(dbPath)
    const version = check.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(CodeIndexHybrid.CODE_INDEX_HYBRID_SCHEMA_VERSION)
    const tables = (check.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'").all() as Array<{ name: string }>).map(row => row.name)
    expect(tables).toContain('code_docs')
    expect(check.prepare('SELECT count(*) AS n FROM code_files').get()).toEqual({ n: 1 })
    check.close()
    expect((await provider.search({ query: 'needle' })).hits.map(hit => hit.path)).toEqual(['a.ts'])
    await provider.close()
  })
})
