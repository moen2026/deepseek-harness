import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { KnowledgeProvider } from '@deepseek-ai/dsh-knowledge'
import { KnowledgeError } from '@deepseek-ai/dsh-knowledge'
import { SqliteKnowledgeProvider } from '../src/index.ts'
import { normalizeDraft, normalizeSearch } from '../src/query.ts'

/** A provider over one process-local temporary database, removed after the suite. */
function makeProvider(): KnowledgeProvider & SqliteKnowledgeProvider {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-knowledge-sqlite-'))
  const provider = new SqliteKnowledgeProvider({
    path: join(dir, 'knowledge.db'),
    openAt: 'lazy',
    journalMode: 'delete',
    defaultLimit: 10,
    maxLimit: 100,
    maxTextBytes: 65_536,
    maxTitleBytes: 512,
  })
  afterAll(async () => {
    await provider.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return provider
}

describe('knowledge-sqlite provider', () => {
  it('ingests a document and returns it from search with a snippet and score', async () => {
    const provider = makeProvider()
    const id = await provider.ingest({ title: 'Deploy runbook', text: 'Restart the gateway before the scheduler.', tags: ['ops'] })
    expect(id).toMatch(/[0-9a-f-]{36}/)
    const { hits } = await provider.search({ query: 'gateway' })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.record.id).toBe(id)
    expect(hits[0]!.record.title).toBe('Deploy runbook')
    expect(hits[0]!.record.tags).toEqual(['ops'])
    expect(hits[0]!.snippet).toContain('gateway')
    expect(hits[0]!.score).toBeGreaterThan(0)
  })

  it('matches titles as well as bodies', async () => {
    const provider = makeProvider()
    await provider.ingest({ title: 'Quarterly planning', text: 'Nothing about cephalopods here.' })
    const { hits } = await provider.search({ query: 'planning' })
    expect(hits).toHaveLength(1)
  })

  it('searches nothing for a non-matching query and sorts multiple hits best-first', async () => {
    const provider = makeProvider()
    await provider.ingest({ title: 'A', text: 'alpha beta' })
    await provider.ingest({ title: 'B', text: 'alpha beta alpha' })
    await provider.ingest({ title: 'C', text: 'gamma only' })
    await expect(provider.search({ query: 'cephalopods' })).resolves.toEqual({ hits: [] })
    const { hits } = await provider.search({ query: 'alpha' })
    expect(hits).toHaveLength(2)
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score)
  })

  it('filters search and list results by tag', async () => {
    const provider = makeProvider()
    const tagged = await provider.ingest({ title: 'Tagged', text: 'visible through the tag', tags: ['ops'] })
    await provider.ingest({ title: 'Untagged', text: 'visible without the tag' })
    const { hits } = await provider.search({ query: 'visible', tags: ['ops'] })
    expect(hits.map(hit => hit.record.id)).toEqual([tagged])
    const page = await provider.list({ tags: ['ops'] })
    expect(page.records.map(record => record.id)).toEqual([tagged])
  })

  it('removes a document by id and reports misses', async () => {
    const provider = makeProvider()
    const id = await provider.ingest({ title: 'Doomed', text: 'delete me' })
    await expect(provider.remove(id)).resolves.toBe(true)
    await expect(provider.remove(id)).resolves.toBe(false)
    await expect(provider.search({ query: 'delete me' })).resolves.toEqual({ hits: [] })
  })

  it('lists documents most recent first with source provenance', async () => {
    const provider = makeProvider()
    await provider.ingest({ title: 'First', text: 'one' })
    await provider.ingest({ title: 'Second', text: 'two', source: 'https://example.test/spec' })
    const page = await provider.list()
    expect(page.records.map(record => record.title)).toEqual(['Second', 'First'])
    expect(page.records[0]!.source).toBe('https://example.test/spec')
    expect(page.records[1]!.source).toBeUndefined()
  })

  it('rejects blank, oversized, and NUL-bearing payloads with KNOWLEDGE_INVALID_REQUEST', async () => {
    const provider = makeProvider()
    const invalid: unknown = expect.objectContaining({ code: 'KNOWLEDGE_INVALID_REQUEST' })
    await expect(provider.ingest({ title: '  ', text: 'body' })).rejects.toThrow(invalid)
    await expect(provider.ingest({ title: 'Title', text: '' })).rejects.toThrow(invalid)
    await expect(provider.ingest({ title: 'Title', text: 'body\u0000hidden' })).rejects.toThrow(invalid)
    await expect(provider.ingest({ title: 'T'.repeat(513), text: 'body' })).rejects.toThrow(invalid)
    await expect(provider.search({ query: '' })).rejects.toThrow(invalid)
    await expect(provider.search({ query: 'ok', limit: 0 })).rejects.toThrow(invalid)
  })

  it('honors the search limit', async () => {
    const provider = makeProvider()
    for (const title of ['one', 'two', 'three']) {
      await provider.ingest({ title, text: `${title} common-token` })
    }
    const { hits } = await provider.search({ query: 'common-token', limit: 2 })
    expect(hits).toHaveLength(2)
  })

  it('throws KNOWLEDGE_DISPOSED after close', async () => {
    const provider = makeProvider()
    await provider.close()
    await expect(provider.ingest({ title: 'T', text: 't' }))
      .rejects.toThrow(expect.objectContaining({ code: 'KNOWLEDGE_DISPOSED' }))
  })

  it('treats query syntax as inert data', async () => {
    const provider = makeProvider()
    await provider.ingest({ title: 'Quoted', text: 'use AND or OR as plain words inside' })
    // Bare FTS5 operators match as literal tokens instead of syntax.
    const { hits } = await provider.search({ query: 'AND OR' })
    expect(hits).toHaveLength(1)
    // An unbalanced quote cannot break the match expression; it simply misses.
    await expect(provider.search({ query: '"never appears' })).resolves.toEqual({ hits: [] })
  })

  it('query normalization rejects blank and NUL-bearing text', () => {
    expect(() => normalizeSearch({ query: '   ' }, { defaultLimit: 10, maxLimit: 100 })).toThrow(KnowledgeError)
    expect(() => normalizeDraft({ title: 'T', text: 'b\u0000b' }, { maxTitleBytes: 512, maxTextBytes: 65_536 })).toThrow(KnowledgeError)
  })
})
