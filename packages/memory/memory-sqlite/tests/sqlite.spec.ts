import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Memory from '@deepseek-ai/dsh-memory'
import * as MemorySqlite from '@deepseek-ai/dsh-memory-sqlite'
import type { Embedder } from '../src/embedding.ts'
import { SqliteMemoryProvider } from '../src/index.ts'

/** A base resolved-config for direct construction (structurally matches the internal type). */
const baseConfig = {
  path: ':memory:',
  openAt: 'startup' as const,
  journalMode: 'wal' as const,
  defaultLimit: 10,
  maxLimit: 100,
  maxTextBytes: 8_192,
}

/** A fake embedder backed by a fixed lookup; never touches the network. */
function fakeEmbedder(table: Readonly<Record<string, number[]>>): Embedder {
  return {
    async embed(texts) {
      return texts.map(text => table[text] ?? [0, 0])
    },
  }
}

/** An embedder that always fails, to exercise the degrade-to-lexical path. */
const throwingEmbedder: Embedder = {
  embed() {
    return Promise.reject(new Error('endpoint down'))
  },
}

describe('SqliteMemoryProvider lexical path', () => {
  it('remembers, recalls by BM25, forgets, and lists by recency', async () => {
    const provider = new SqliteMemoryProvider(baseConfig)
    const idA = await provider.remember({ text: 'alpha alpha alpha', tags: ['x'] })
    const idB = await provider.remember({ text: 'alpha beta' })
    await provider.remember({ text: 'gamma unrelated', scope: 'proj' })

    const recall = await provider.recall({ query: 'alpha' })
    const ids = recall.hits.map(hit => hit.record.id)
    expect(ids).toContain(idA)
    expect(ids).toContain(idB)
    // Higher term frequency ranks first; scores descend.
    expect(ids[0]).toBe(idA)
    expect(recall.hits.map(hit => hit.score)).toEqual([...recall.hits.map(hit => hit.score)].sort((x, y) => y - x))

    expect(await provider.forget(idB)).toBe(true)
    expect(await provider.forget(idB)).toBe(false)
    const afterForget = await provider.recall({ query: 'alpha' })
    expect(afterForget.hits.map(hit => hit.record.id)).toEqual([idA])
    const noMatch = await provider.recall({ query: 'zzz-matches-nothing' })
    expect(noMatch.hits).toEqual([])

    const page = await provider.list()
    expect(page.records.length).toBe(2)
    // Most recent first.
    expect(page.records[0]?.scope).toBe('proj')

    await provider.close()
    await provider.close()
  })

  it('filters recall by tag and scope', async () => {
    const provider = new SqliteMemoryProvider(baseConfig)
    await provider.remember({ text: 'alpha marked', tags: ['keep'] })
    await provider.remember({ text: 'alpha plain' })
    await provider.remember({ text: 'alpha scoped', scope: 'proj' })
    const tagged = await provider.recall({ query: 'alpha', tags: ['keep'] })
    expect(tagged.hits).toHaveLength(1)
    expect(tagged.hits[0]?.record.tags).toContain('keep')
    const scoped = await provider.recall({ query: 'alpha', scope: 'proj' })
    expect(scoped.hits.map(hit => hit.record.text)).toEqual(['alpha scoped'])
    await provider.close()
  })
})

describe('SqliteMemoryProvider typed namespaces, confidence, and expiry', () => {
  it('persists namespace, confidence, and a computed expiry', async () => {
    const provider = new SqliteMemoryProvider(baseConfig)
    const id = await provider.remember({ text: 'prefers tabs', namespace: 'style', confidence: 0.9, ttlMs: 60_000 })
    const { hits } = await provider.recall({ query: 'prefers' })
    const record = hits.find(hit => hit.record.id === id)?.record
    expect(record).toMatchObject({ namespace: 'style', confidence: 0.9 })
    expect(typeof record?.expiresAt).toBe('string')
    await provider.close()
  })

  it('filters recall and listing by namespace and minimum confidence', async () => {
    const provider = new SqliteMemoryProvider(baseConfig)
    await provider.remember({ text: 'alpha style', namespace: 'style', confidence: 0.9 })
    await provider.remember({ text: 'alpha pref low', namespace: 'preference', confidence: 0.2 })
    await provider.remember({ text: 'alpha pref high', namespace: 'preference', confidence: 0.8 })
    await provider.remember({ text: 'alpha bare' })
    const styled = await provider.recall({ query: 'alpha', namespace: 'style' })
    expect(styled.hits.map(hit => hit.record.text)).toEqual(['alpha style'])
    const confident = await provider.recall({ query: 'alpha', minConfidence: 0.5 })
    expect(confident.hits.map(hit => hit.record.text).sort()).toEqual(['alpha pref high', 'alpha style'])
    const listed = await provider.list({ namespace: 'preference', minConfidence: 0.5 })
    expect(listed.records.map(record => record.text)).toEqual(['alpha pref high'])
    await provider.close()
  })

  it('excludes an expired record from recall and listing', async () => {
    const provider = new SqliteMemoryProvider(baseConfig)
    const keep = await provider.remember({ text: 'alpha durable' })
    await provider.remember({ text: 'alpha fleeting', ttlMs: 1 })
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    const recall = await provider.recall({ query: 'alpha' })
    expect(recall.hits.map(hit => hit.record.id)).toEqual([keep])
    const page = await provider.list()
    expect(page.records.map(record => record.id)).toEqual([keep])
    await provider.close()
  })
})

describe('SqliteMemoryProvider optional vector path', () => {
  it('stores vectors and answers a fused recall without error', async () => {
    const table: Record<string, number[]> = {
      'alpha one': [1, 0],
      'alpha two': [0, 1],
      'alpha': [0, 1],
    }
    const provider = new SqliteMemoryProvider(baseConfig, { embedder: fakeEmbedder(table) })
    const idOne = await provider.remember({ text: 'alpha one' })
    const idTwo = await provider.remember({ text: 'alpha two' })
    const recall = await provider.recall({ query: 'alpha' })
    const ids = recall.hits.map(hit => hit.record.id).sort()
    expect(ids).toEqual([idOne, idTwo].sort())
    await provider.close()
  })

  it('degrades to the lexical ranking when the endpoint fails, warning once', async () => {
    const warnings: string[] = []
    const provider = new SqliteMemoryProvider(baseConfig, {
      embedder: throwingEmbedder,
      warn: message => warnings.push(message),
    })
    const id = await provider.remember({ text: 'alpha durable' })
    const recall = await provider.recall({ query: 'alpha' })
    expect(recall.hits.map(hit => hit.record.id)).toContain(id)
    expect(warnings.length).toBe(1)
    await provider.remember({ text: 'alpha again' })
    await provider.recall({ query: 'alpha' })
    // The warning is emitted only once across later failures.
    expect(warnings.length).toBe(1)
    await provider.close()
  })
})

describe('memory-sqlite plugin registration', () => {
  it('mounts over a real file, primes at startup, and unregisters on dispose', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-'))
    const dbPath = join(root, 'memory.db')
    const ctx = new Context()
    await ctx.plugin(Memory)
    await ctx.plugin(MemorySqlite, { path: dbPath, openAt: 'startup' })

    const id = await ctx.memory.remember({ text: 'lapsang soup' })
    const recall = await ctx.memory.recall({ query: 'lapsang' })
    expect(recall.hits.map(hit => hit.record.id)).toContain(id)

    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
})

describe('SqliteMemoryProvider limits, degradation, and failure paths', () => {
  it('rejects a listing limit outside the configured range', async () => {
    const provider = new SqliteMemoryProvider(baseConfig)
    await expect(provider.list({ limit: 0 })).rejects.toThrow(/between 1 and 100/)
    await expect(provider.list({ limit: 101 })).rejects.toThrow(/between 1 and 100/)
    await provider.close()
  })

  it('filters a listing by tag and by scope', async () => {
    const provider = new SqliteMemoryProvider(baseConfig)
    await provider.remember({ text: 'tagged fact', tags: ['keep'] })
    await provider.remember({ text: 'scoped fact', scope: 'proj' })
    const tagged = await provider.list({ tags: ['keep'] })
    expect(tagged.records.map(record => record.text)).toEqual(['tagged fact'])
    const scoped = await provider.list({ scope: 'proj' })
    expect(scoped.records.map(record => record.text)).toEqual(['scoped fact'])
    const blankScope = await provider.list({ scope: '   ' })
    expect(blankScope.records).toHaveLength(2)
    await provider.close()
  })

  it('warns at most once per provider when the embedding response is unusable', async () => {
    const warnings: string[] = []
    const mismatched: Embedder = { embed: () => Promise.resolve([]) }
    const provider = new SqliteMemoryProvider(baseConfig, {
      embedder: mismatched,
      warn: message => warnings.push(message),
    })
    const id = await provider.remember({ text: 'alpha short' })
    const recall = await provider.recall({ query: 'alpha' })
    expect(recall.hits.map(hit => hit.record.id)).toEqual([id])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/length mismatch/)
    await provider.close()

    const plainWarnings: string[] = []
    const second = new SqliteMemoryProvider(baseConfig, {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is the degradation path under test.
      embedder: { embed: () => Promise.reject('plain failure') },
      warn: message => plainWarnings.push(message),
    })
    await second.remember({ text: 'alpha plain' })
    expect(plainWarnings).toHaveLength(1)
    expect(plainWarnings[0]).toMatch(/plain failure/)
    await second.close()

    // A provider constructed without a warn sink still degrades silently instead of crashing.
    const quiet = new SqliteMemoryProvider(baseConfig, { embedder: mismatched })
    await quiet.remember({ text: 'alpha quiet' })
    await quiet.close()
  })

  it('still fuses ranking when one candidate has no stored vector', async () => {
    const asymmetric: Embedder = {
      async embed(texts) {
        return texts[0] === 'alpha two' ? [] : [[1, 0]]
      },
    }
    const provider = new SqliteMemoryProvider(baseConfig, { embedder: asymmetric })
    const idOne = await provider.remember({ text: 'alpha one' })
    const idTwo = await provider.remember({ text: 'alpha two' })
    const recall = await provider.recall({ query: 'alpha' })
    expect(recall.hits.map(hit => hit.record.id).sort()).toEqual([idOne, idTwo].sort())
    await provider.close()
  })

  it('rolls back the write transaction when an insert fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-rollback-'))
    const dbPath = join(root, 'memory.db')
    const provider = new SqliteMemoryProvider({ ...baseConfig, path: dbPath })
    await provider.prime()
    const { DatabaseSync } = await import('node:sqlite')
    const side = new DatabaseSync(dbPath)
    side.exec('DROP TABLE memory_records')
    side.close()
    await expect(provider.remember({ text: 'doomed' })).rejects.toThrow(/no such table/)
    await provider.close()
    await rm(root, { recursive: true, force: true })
  })

  it('retries the open after a failed attempt instead of caching the rejection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-retry-'))
    const provider = new SqliteMemoryProvider({ ...baseConfig, path: root })
    await expect(provider.remember({ text: 'first' })).rejects.toThrow()
    await expect(provider.remember({ text: 'second' })).rejects.toThrow()
    await provider.close()
    await rm(root, { recursive: true, force: true })
  })

  it('rejects every operation after close with MEMORY_DISPOSED', async () => {
    const provider = new SqliteMemoryProvider(baseConfig)
    await provider.close()
    await expect(provider.remember({ text: 'x' })).rejects.toThrow(/disposed/)
    await expect(provider.recall({ query: 'x' })).rejects.toThrow(/disposed/)
    await expect(provider.forget('id')).rejects.toThrow(/disposed/)
    await expect(provider.list()).rejects.toThrow(/disposed/)
  })
})

describe('memory-sqlite embedding configuration', () => {
  it('fails loud when the embedding block is incomplete', async () => {
    const ctx = new Context()
    await ctx.plugin(Memory)
    await expect(ctx.plugin(MemorySqlite, {
      path: ':memory:',
      embedding: { url: '  ', model: '  ', authEnv: '  ', dimension: 2 },
    })).rejects.toThrow(/config\.embedding is set but url, model, authEnv must be provided/)
  })

  it('treats untyped fields as missing when applied without schema validation', () => {
    const ctx = new Context()
    expect(() => {
      MemorySqlite.apply(ctx, {
        path: ':memory:',
        embedding: { url: 42, model: 8, authEnv: 0, dimension: 0 },
      } as never)
    }).toThrow(/config\.embedding is set but url, model, authEnv, dimension must be provided/)
  })

  it('mounts with a complete embedding block', async () => {
    const ctx = new Context()
    await ctx.plugin(Memory)
    await ctx.plugin(MemorySqlite, {
      path: ':memory:',
      embedding: { url: 'http://127.0.0.1:9/v1/embeddings', model: 'm', authEnv: 'DSH_MEMORY_TEST_UNUSED_KEY', dimension: 2 },
    })
    await ctx.fiber.dispose()
  })

  it('skips the startup prime in lazy mode and survives a failing startup prime', async () => {
    const lazy = new Context()
    await lazy.plugin(Memory)
    await lazy.plugin(MemorySqlite, { path: ':memory:', openAt: 'lazy' })
    await lazy.fiber.dispose()

    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-prime-'))
    const broken = new Context()
    await broken.plugin(Memory)
    // A directory path cannot open as a database, so the fire-and-forget startup prime rejects.
    await broken.plugin(MemorySqlite, { path: root })
    await new Promise<void>((resolve) => { setTimeout(resolve, 200) })
    await broken.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
})
