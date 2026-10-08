/** The github_comment tool resolves its token from the credential seam and posts one comment per call. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as ToolGithub from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const signal = new AbortController().signal

/** A minimal `tools` seat: registers definitions and executes them without the pipeline. */
function toolsStub() {
  const registry = new Map<string, Record<string, unknown>>()
  return {
    register: (definition: Record<string, unknown>) => {
      registry.set(definition.name as string, definition)
      return () => registry.delete(definition.name as string)
    },
    get: (name: string) => registry.get(name),
    execute: async (input: { name: string; arguments: Record<string, unknown>; signal: AbortSignal }) => {
      const definition = registry.get(input.name)
      if (definition === undefined) throw new Error(`unknown tool "${input.name}"`)
      const value = await (definition.execute as (args: unknown, exec: unknown) => Promise<unknown>)(
        input.arguments,
        { signal: input.signal },
      )
      const render = (definition.output as { render: (args: unknown, value: unknown) => unknown[] }).render
      return { content: render(input.arguments, value), isError: false }
    },
  } as never
}

const TOKEN_ENV = 'DSH_GITHUB_REVIEW_TOKEN'

async function boot(token: string | undefined, config: Partial<ToolGithub.Config> = {}) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin({ name: 'tools-stub', apply: (seat: Context) => { seat.provide('tools', toolsStub()) } })
  await ctx.plugin({
    name: 'credentials-stub',
    apply: (seat: Context) => {
      seat.provide('credentials', {
        resolve: async () => token === undefined ? undefined : { value: token, source: 'test' },
      })
    },
  })
  await ctx.plugin(ToolGithub, {
    tokenEnv: TOKEN_ENV,
    apiBaseUrl: 'https://api.github.test',
    timeoutMs: 1_000,
    ...config,
  })
  return ctx
}

/** Recorded fetch mock answering one status with one JSON body. */
function fetchStub(status: number, body: Record<string, unknown>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), { status })
  }))
  return { calls }
}

const post = (ctx: Context, args: Record<string, unknown>) =>
  ctx.tools.execute({ signal, callId: ToolCallId('call-github-spec'), name: 'github_comment', arguments: args })

describe('tool-github plugin', () => {
  it('posts one comment with the resolved bearer token and returns the comment URL', async () => {
    const { calls } = fetchStub(201, { html_url: 'https://github.test/o/r/issues/7#issuecomment-9' })
    const ctx = await boot('token-1')
    const result = await post(ctx, { repository: 'o/r', number: 7, body: 'LGTM with one nit' })

    expect(result.isError).toBe(false)
    expect(result.content[0]).toMatchObject({
      text: 'Comment posted: https://github.test/o/r/issues/7#issuecomment-9',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.github.test/repos/o/r/issues/7/comments')
    expect(calls[0]?.init.method).toBe('POST')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token-1')
    expect(headers.accept).toBe('application/vnd.github+json')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ body: 'LGTM with one nit' }))
  })

  it('answers an actionable unavailable result without calling the API when the token is missing', async () => {
    const { calls } = fetchStub(201, {})
    const ctx = await boot(undefined)
    const result = await post(ctx, { repository: 'o/r', number: 7, body: 'text' })

    expect(calls).toHaveLength(0)
    expect(result.isError).toBe(false)
    const text = result.content[0]
    expect(text !== undefined && 'text' in text && text.text).toContain(`credential reference "${TOKEN_ENV}"`)
  })

  it('throws with the status and response excerpt on an API error', async () => {
    fetchStub(403, { message: 'Resource not accessible by integration' })
    const ctx = await boot('token-1')
    await expect(post(ctx, { repository: 'o/r', number: 7, body: 'text' }))
      .rejects.toThrow(/GitHub API returned 403/)
    await expect(post(ctx, { repository: 'o/r', number: 7, body: 'text' }))
      .rejects.toThrow(/Resource not accessible by integration/)
  })

  it('rejects malformed arguments before touching the credential or the API', async () => {
    const { calls } = fetchStub(201, { html_url: 'https://github.test/x' })
    const ctx = await boot('token-1')
    // Required-parameter validation runs in the tool pipeline before execute.
    await expect(post(ctx, { repository: 'o/r', number: 7 }))
      .rejects.toThrow(/missing required property "body"/)
    await expect(post(ctx, { repository: 'just-a-name', number: 7, body: 'text' }))
      .rejects.toThrow(/owner\/repo/)
    await expect(post(ctx, { repository: 'o/r', number: 0, body: 'text' }))
      .rejects.toThrow(/positive integer number/)
    expect(calls).toHaveLength(0)
  })

  it('fails loud on invalid bounds', async () => {
    const ctx = await boot('token-1')
    await expect(ctx.plugin(ToolGithub, { tokenEnv: TOKEN_ENV, timeoutMs: 0 } as ToolGithub.Config))
      .rejects.toThrow(/timeoutMs/)
  })
})
