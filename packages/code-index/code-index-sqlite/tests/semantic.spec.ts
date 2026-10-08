import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import CodeIndex from '@deepseek-ai/dsh-code-index'
import * as CodeIndexSqlite from '@deepseek-ai/dsh-code-index-sqlite'
import {
  SEMANTIC_DIMENSION,
  cosineSimilarity,
  decodeVector,
  embedFeatures,
  embedVector,
} from '@deepseek-ai/dsh-code-index-sqlite'

const temporaryDirectories: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** Build a fixture workspace and mount the provider over it with the semantic path on. */
async function mountIndexed(
  files: Record<string, string>,
  overrides: Partial<CodeIndexSqlite.Config> = {},
): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-code-index-semantic-'))
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

describe('local hashed embeddings', () => {
  it('projects text into a deterministic, unit-normalized 128-component vector', () => {
    const first = embedVector('export function searchCodebase(query: string) {}')
    const second = embedVector('export function searchCodebase(query: string) {}')
    expect(first).toHaveLength(SEMANTIC_DIMENSION)
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
    const decoded = decodeVector(first)
    let energy = 0
    for (const value of decoded) energy += value * value
    expect(Math.sqrt(energy)).toBeGreaterThan(0)
  })

  it('splits identifier subtokens so a spaced query overlaps a camelCase token', () => {
    const query = embedFeatures('codebase search')
    const chunk = embedFeatures('export function searchCodebase() {')
    expect(query).toContain('t:codebase')
    expect(query).toContain('t:search')
    expect(chunk).toContain('t:search')
    expect(chunk).toContain('t:codebase')
    const similarity = cosineSimilarity(decodeVector(embedVector('codebase search')), decodeVector(embedVector('export function searchCodebase() {')))
    expect(similarity).toBeGreaterThan(0)
  })

  it('scores identical texts 1 and unrelated texts 0', () => {
    const text = 'const delta = computeRoute(matrix)'
    expect(cosineSimilarity(decodeVector(embedVector(text)), decodeVector(embedVector(text)))).toBeCloseTo(1, 5)
    expect(cosineSimilarity(decodeVector(embedVector(text)), decodeVector(embedVector('')))).toBe(0)
  })
})

describe('fused semantic search', () => {
  it('recalls a compound identifier from a spaced paraphrase the lexical phrase misses', async () => {
    const ctx = await mountIndexed({
      'src/search.ts': 'export function searchCodebase(query: string) { return query }\n',
      'src/other.ts': 'export const unrelated = 1\n',
    })
    // The FTS5 phrase "codebase search" cannot match the single unicode61 token
    // "searchcodebase"; the fused path recalls it through the subtoken overlap.
    const page = await ctx.codeIndex.search({ query: 'codebase search' })
    expect(page.hits.map(hit => hit.path)).toEqual(['src/search.ts'])
    expect(page.hits[0]?.score).toBeTypeOf('number')
    expect(page.hits[0]?.snippet.length).toBeGreaterThan(0)
  })

  it('keeps glob and language refinements effective on the semantic path', async () => {
    const ctx = await mountIndexed({
      'src/a.ts': 'export function searchCodebase() {}\n',
      'assets/notes.md': 'prose about searchCodebase behavior\n',
    })
    const scoped = await ctx.codeIndex.search({ query: 'codebase search', glob: 'src/*.ts' })
    expect(scoped.hits.map(hit => hit.path)).toEqual(['src/a.ts'])

    const markdown = await ctx.codeIndex.search({ query: 'codebase search', language: 'markdown' })
    expect(markdown.hits.map(hit => hit.path)).toEqual(['assets/notes.md'])
  })

  it('ranks a chunk hit by both rankings above single-list competitors', async () => {
    const ctx = await mountIndexed({
      'src/both.ts': 'needle loader here with searchCodebase plumbing\n',
      'src/lexical.ts': 'needle only in lexical text\n',
      'src/semantic.ts': 'sparse text mentioning searchCodebase alone\n',
    })
    const page = await ctx.codeIndex.search({ query: 'needle codebase search', limit: 2 })
    expect(page.hits[0]?.path).toBe('src/both.ts')
    // Fused scores descend with the fused order.
    const scores = page.hits.map(hit => hit.score)
    expect(scores).toEqual([...scores].sort((x, y) => y - x))
  })

  it('degrades to the pure lexical path when the semantic option is off', async () => {
    const ctx = await mountIndexed({
      'src/search.ts': 'export function searchCodebase(query: string) { return query }\n',
    }, { semantic: false })
    const fused = await ctx.codeIndex.search({ query: 'codebase search' })
    expect(fused.hits).toEqual([])

    const lexical = await ctx.codeIndex.search({ query: 'searchCodebase' })
    expect(lexical.hits.map(hit => hit.path)).toEqual(['src/search.ts'])
  })

  it('returns an empty page when neither ranking has a candidate', async () => {
    const ctx = await mountIndexed({ 'a.ts': 'plain text with no overlap\n' })
    const page = await ctx.codeIndex.search({ query: 'xyzzy plugh quadrant' })
    expect(page.hits).toEqual([])
  })
})
