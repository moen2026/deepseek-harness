import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CodeIndex, { CodeIndexError, type CodeIndexProvider, type CodeSearchHit } from '@deepseek-ai/dsh-code-index'
import * as ToolCodeIndex from '@deepseek-ai/dsh-tool-code-index'
import { CODE_INDEX_PROMPT_TEXT, DEFAULT_CODE_INDEX_TOOL_TIMEOUT_MS } from '@deepseek-ai/dsh-tool-code-index'
import { formatHits, parseSearchArgs, presentSearchCall } from '@deepseek-ai/dsh-tool-code-index'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

function hit(overrides: Partial<CodeSearchHit> & { path: string }): CodeSearchHit {
  return { startLine: 1, endLine: 1, score: 1, snippet: 'text', ...overrides }
}

describe('parseSearchArgs', () => {
  it('trims and collapses the query and forwards optional refinements', () => {
    expect(parseSearchArgs({ query: '  alpha\n beta ' })).toEqual({ query: 'alpha beta' })
    expect(parseSearchArgs({ query: 'x', glob: ' src/*.ts ', language: ' typescript ', limit: 5 }))
      .toEqual({ query: 'x', glob: 'src/*.ts', language: 'typescript', limit: 5 })
  })

  it('drops blank optional strings', () => {
    expect(parseSearchArgs({ query: 'x', glob: '  ', language: '' })).toEqual({ query: 'x' })
  })

  it('rejects a blank query and a non-positive-integer limit', () => {
    expect(() => parseSearchArgs({ query: '   ' })).toThrow(/non-empty/)
    expect(() => parseSearchArgs({ query: 'x', limit: 0 })).toThrow(/positive integer/)
    expect(() => parseSearchArgs({ query: 'x', limit: 1.5 })).toThrow(/positive integer/)
  })
})

describe('formatHits', () => {
  it('renders one line per hit with path, line range, language, and snippet', () => {
    const text = formatHits([
      hit({ path: 'src/a.ts', startLine: 3, endLine: 7, language: 'typescript', snippet: 'needle here' }),
      hit({ path: 'b.md', startLine: 2, endLine: 2, snippet: 'solo line' }),
    ], 16_000)
    expect(text).toContain('src/a.ts:3-7 [typescript]  needle here')
    expect(text).toContain('b.md:2  solo line')
  })

  it('renders a distinct no-result line for an empty page', () => {
    expect(formatHits([], 16_000)).toBe('No matching code found.')
  })

  it('bounds the complete result including the truncation notice', () => {
    const long = hit({ path: 'x.ts', snippet: 'y'.repeat(500) })
    const text = formatHits([long, long, long], 80)
    expect(text.length).toBeLessThanOrEqual(80)
    expect(text).toContain('truncated')
  })

  it('falls back to a bare bounded notice when the notice alone exceeds the cap', () => {
    const long = hit({ path: 'x.ts', snippet: 'y'.repeat(500) })
    const text = formatHits([long], 8)
    expect(text).toHaveLength(8)
    expect(text).not.toContain('truncated')
  })
})

describe('presentSearchCall', () => {
  it('uses a generic search card titled with the query', () => {
    expect(presentSearchCall({ query: 'needle' })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'Search codebase: needle',
    })
  })
})

/** Mount the tool over the real seam with an optional scripted provider. */
async function mountTool(provider?: CodeIndexProvider): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CodeIndex)
  if (provider) ctx.codeIndex.registerProvider(provider)
  await ctx.plugin(ToolCodeIndex)
  return ctx
}

let seq = 0
const signal = new AbortController().signal
function execute(ctx: Context, args: unknown) {
  return ctx.tools.execute({ signal, callId: `c-${++seq}` as never, name: 'search_codebase', arguments: args })
}
const asText = (blocks: Array<{ type: string; text?: string }>) => blocks.map(b => b.text ?? '').join('\n')

describe('tool search_codebase', () => {
  it('registers the tool and its prompt section with the default timeout', async () => {
    const ctx = await mountTool()
    expect(ctx.tools.get('search_codebase')).toBeDefined()
    expect(ctx.tools.get('search_codebase')?.timeoutMs).toBe(DEFAULT_CODE_INDEX_TOOL_TIMEOUT_MS)
    const prompt = await ctx.systemPrompt.assemble()
    expect(prompt.sections.map(section => section.text).join('\n')).toContain(CODE_INDEX_PROMPT_TEXT)
  })

  it('renders ranked provider hits', async () => {
    const provider: CodeIndexProvider = {
      id: 'stub',
      search: request => Promise.resolve({
        hits: [hit({ path: 'src/a.ts', startLine: 2, endLine: 4, language: request.language ?? 'typescript', snippet: 'needle' })],
      }),
    }
    const ctx = await mountTool(provider)
    const result = await execute(ctx, { query: 'needle' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toContain('src/a.ts:2-4 [typescript]  needle')
  })

  it('returns an actionable unavailable answer with no provider, without failing the session', async () => {
    const ctx = await mountTool()
    const result = await execute(ctx, { query: 'needle' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toMatch(/not available/i)
  })

  it('answers unavailable when the provider reports CODE_INDEX_UNAVAILABLE', async () => {
    const provider: CodeIndexProvider = {
      id: 'stub',
      search: () => Promise.reject(new CodeIndexError('index offline', 'CODE_INDEX_UNAVAILABLE')),
    }
    const ctx = await mountTool(provider)
    const result = await execute(ctx, { query: 'needle' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toMatch(/not available/i)
  })

  it('surfaces every other provider failure as a tool error', async () => {
    const provider: CodeIndexProvider = {
      id: 'stub',
      search: () => Promise.reject(new CodeIndexError('index schema drifted', 'CODE_INDEX_INVALID_REQUEST')),
    }
    const ctx = await mountTool(provider)
    const result = await execute(ctx, { query: 'needle' })
    expect(result.isError).toBe(true)
    expect(asText(result.content)).toMatch(/index schema drifted/)
  })

  it('omits the language field for a hit the provider reports without one', async () => {
    const provider: CodeIndexProvider = {
      id: 'stub',
      search: () => Promise.resolve({ hits: [hit({ path: 'Makefile', snippet: 'needle' })] }),
    }
    const ctx = await mountTool(provider)
    const result = await execute(ctx, { query: 'needle' })
    expect(result.isError).toBe(false)
    expect(asText(result.content)).toContain('Makefile:1  needle')
  })

  it('marks search_codebase parallel-safe', async () => {
    const ctx = await mountTool()
    expect(ctx.tools.get('search_codebase')?.isConcurrencySafe?.({ query: 'x' })).toBe(true)
  })
})

describe('tool-code-index configuration', () => {
  it('fails loud at load for values it cannot honor', async () => {
    const zero = new Context()
    await zero.plugin(SystemPrompt)
    await zero.plugin(ToolRuntime)
    await zero.plugin(CodeIndex)
    await expect(zero.plugin(ToolCodeIndex, { maxResultChars: 0 })).rejects.toThrow(/positive integer/)
    await expect(zero.plugin(ToolCodeIndex, { maxResultChars: 1.5 })).rejects.toThrow(/positive integer/)
    await expect(zero.plugin(ToolCodeIndex, { timeoutMs: 0 })).rejects.toThrow(/no greater than/)

    const direct = await mountTool()
    // Direct apply bypasses the schema so each guard is reachable exactly as written.
    expect(() => {
      ToolCodeIndex.apply(direct, { maxResultChars: 100, timeoutMs: MAX_TIMER_DELAY_MS + 1 })
    }).toThrow(/no greater than/)
    expect(() => {
      ToolCodeIndex.apply(direct, { maxResultChars: 0, timeoutMs: 1_000 })
    }).toThrow(/positive integer/)
  })
})
