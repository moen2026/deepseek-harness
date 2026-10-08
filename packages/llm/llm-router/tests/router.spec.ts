import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmAdapter, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelReasoningInfo,
  LlmResolvedModelInfo,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as router from '../src/index.ts'

type LlmRouterState = router.LlmRouterState

/** One scripted provider stream per model call, with per-route metadata. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(
    private readonly entries: StreamChunk[][],
    private readonly metadata: { contextWindow?: number; reasoning?: LlmModelReasoningInfo } = {},
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.metadata.contextWindow === undefined ? {} : { context: { contextWindow: this.metadata.contextWindow } },
      ...this.metadata.reasoning === undefined ? {} : { reasoning: this.metadata.reasoning },
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.entries.shift()
    if (entry === undefined) throw new Error('router test script exhausted')
    yield* entry
  }
}

const USAGE: TokenUsage = { inputTokens: 10, outputTokens: 5 }

function user(text: string): ReturnType<typeof createUserMessage> {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function textResponse(text: string, usage: TokenUsage = USAGE): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(callId: string, name: string, usage: TokenUsage = USAGE): StreamChunk[] {
  const id = ToolCallId(callId)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: '{}' } },
    { type: 'usage', usage },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

interface HarnessOptions {
  /** Router configuration; omitted mounts the plugin's default configuration. */
  config?: router.Config
  /** Extra setup between the shared services and the router mount. */
  beforeRouter?: (ctx: Context) => void
  /** Mount the token meter so context pressure reaches the auto branch. */
  tokenMeter?: boolean
}

async function harness(adapter: ScriptedAdapter, options: HarnessOptions = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (options.tokenMeter === true) await ctx.plugin(TokenMeter)
  options.beforeRouter?.(ctx)
  await ctx.plugin(Object.assign((inner: Context) => {
    if (options.config === undefined) router.apply(inner)
    else router.apply(inner, options.config)
  }, { inject: router.inject }))
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

async function foldHarness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(Object.assign((inner: Context) => { router.apply(inner) }, { inject: router.inject }))
  return { ctx, session: ctx.sessions.create() }
}

function routerState(ctx: Context, session: Session): LlmRouterState | undefined {
  return ctx.sessionProjections.stateOf(session, 'llmRouter')
}

function startStep(session: Session, turn: number, step: number): void {
  session.append('step/start', { turn, step })
}

function appendToolCall(session: Session, turn: number, step: number, callId: string): void {
  session.append('tool/call', { turn, step, callId: ToolCallId(callId), name: 'probe', arguments: '{}' })
}

/** Narrow one raw JSON-shaped value to the typed configuration for validation tests. */
function asConfig(value: unknown): router.Config {
  return value as router.Config
}

function autoConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    when: { provider: 'mock' },
    capability: { provider: 'mock', model: 'cap' },
    ...overrides,
  }
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('resolveRouterConfig', () => {
  it('materializes an empty configuration', () => {
    expect(router.resolveRouterConfig({}, 'test')).toEqual({ routes: [], auto: undefined })
  })

  it('materializes ordered rules, keeping an absent match absent', () => {
    const resolved = router.resolveRouterConfig({
      routes: [
        { when: { provider: 'mock', model: 'small' }, route: { provider: 'mock', model: 'big' } },
        { route: { provider: 'mock', model: 'any' } },
      ],
    }, 'test')
    expect(resolved).toEqual({
      routes: [
        { when: { provider: 'mock', model: 'small' }, route: { provider: 'mock', model: 'big' } },
        { route: { provider: 'mock', model: 'any' } },
      ],
      auto: undefined,
    })
  })

  it('materializes the auto branch defaults', () => {
    const resolved = router.resolveRouterConfig({
      auto: {
        when: { provider: 'mock' },
        capability: { provider: 'mock', model: 'cap', reasoningEffort: ReasoningEffortId('high') },
        economy: { provider: 'mock', model: 'eco' },
      },
    }, 'test')
    expect(resolved.routes).toEqual([])
    expect(resolved.auto).toEqual({
      when: { provider: 'mock' },
      capability: { provider: 'mock', model: 'cap', reasoningEffort: 'high' },
      economy: { provider: 'mock', model: 'eco' },
      contextPressureThreshold: 0.75,
      toolDensityThreshold: 0.5,
      toolDensityWindow: 12,
    })
  })

  it('accepts boundary thresholds and the density window bounds', () => {
    const resolved = router.resolveRouterConfig({
      auto: {
        when: {},
        capability: { provider: 'mock', model: 'cap' },
        contextPressureThreshold: 1,
        toolDensityThreshold: 0,
        toolDensityWindow: 64,
      },
    }, 'test')
    expect(resolved.auto).toEqual({
      when: {},
      capability: { provider: 'mock', model: 'cap' },
      economy: undefined,
      contextPressureThreshold: 1,
      toolDensityThreshold: 0,
      toolDensityWindow: 64,
    })
  })

  it.each<[string, unknown, RegExp]>([
    ['a string root', 'nope', /test must be an object, got "nope"/],
    ['an array root', [], /test must be an object, got \[\]/],
    ['a null root', null, /test must be an object, got null/],
    ['an unknown root key', { bogus: true }, /test: unknown key "bogus"/],
    ['a non-array routes', { routes: {} }, /test\.routes must be an array of routing rules, got \{\}/],
    ['a non-object rule', { routes: ['nope'] }, /test\.routes\[0\] must be an object, got "nope"/],
    ['an unknown rule key', { routes: [{ stray: 1 }] }, /test\.routes\[0\]: unknown key "stray"/],
    ['a rule without a route', { routes: [{ when: {} }] }, /test\.routes\[0\]\.route must be an object, got undefined/],
    [
      'an unknown target key',
      { routes: [{ route: { provider: 'mock', model: 'm', extra: true } }] },
      /test\.routes\[0\]\.route: unknown key "extra"/,
    ],
    [
      'a non-string target provider',
      { routes: [{ route: { provider: 7, model: 'm' } }] },
      /routes\[0\]\.route\.provider must be a non-empty string, got 7/,
    ],
    [
      'an empty target model',
      { routes: [{ route: { provider: 'mock', model: '' } }] },
      /routes\[0\]\.route\.model must be a non-empty string, got ""/,
    ],
    [
      'a non-object rule match',
      { routes: [{ when: 'mock', route: { provider: 'mock', model: 'm' } }] },
      /test\.routes\[0\]\.when must be an object, got "mock"/,
    ],
    [
      'an unknown match key',
      { routes: [{ when: { path: '/' }, route: { provider: 'mock', model: 'm' } }] },
      /test\.routes\[0\]\.when: unknown key "path"/,
    ],
    [
      'a non-string match provider',
      { routes: [{ when: { provider: 5 }, route: { provider: 'mock', model: 'm' } }] },
      /test\.routes\[0\]\.when\.provider must be a non-empty string, got 5/,
    ],
    ['an unknown auto key', { auto: autoConfig({ stale: 1 }) }, /test\.auto: unknown key "stale"/],
    [
      'an auto branch without when',
      { auto: { capability: { provider: 'mock', model: 'm' } } },
      /test\.auto\.when must be an object, got undefined/,
    ],
    ['an auto branch without capability', { auto: { when: {} } }, /test\.auto\.capability must be an object, got undefined/],
    [
      'a non-numeric pressure threshold',
      { auto: autoConfig({ contextPressureThreshold: '75%' }) },
      /contextPressureThreshold must be a number in \[0, 1\]/,
    ],
    [
      'a NaN pressure threshold',
      { auto: autoConfig({ contextPressureThreshold: Number.NaN }) },
      /contextPressureThreshold must be a number in \[0, 1\]/,
    ],
    [
      'a negative pressure threshold',
      { auto: autoConfig({ contextPressureThreshold: -0.1 }) },
      /contextPressureThreshold must be a number in \[0, 1\]/,
    ],
    [
      'a pressure threshold above one',
      { auto: autoConfig({ contextPressureThreshold: 1.5 }) },
      /contextPressureThreshold must be a number in \[0, 1\]/,
    ],
    [
      'a non-numeric density window',
      { auto: autoConfig({ toolDensityWindow: '12' }) },
      /toolDensityWindow must be an integer in \[1, 64\]/,
    ],
    [
      'a fractional density window',
      { auto: autoConfig({ toolDensityWindow: 2.5 }) },
      /toolDensityWindow must be an integer in \[1, 64\]/,
    ],
    ['a zero density window', { auto: autoConfig({ toolDensityWindow: 0 }) }, /toolDensityWindow must be an integer in \[1, 64\]/],
    [
      'a density window above the retained cap',
      { auto: autoConfig({ toolDensityWindow: 65 }) },
      /toolDensityWindow must be an integer in \[1, 64\]/,
    ],
  ])('rejects %s', (_label, value, message) => {
    expect(() => router.resolveRouterConfig(asConfig(value), 'test')).toThrow(message)
  })

  it('names the offending path and value in its message', () => {
    expect(() => router.resolveRouterConfig(asConfig({ auto: autoConfig({ toolDensityThreshold: -0.1 }) }), 'llm-router'))
      .toThrow('llm-router.auto.toolDensityThreshold must be a number in [0, 1], got -0.1')
  })
})

describe('contextPressureRatio', () => {
  it('reads undefined until the meter holds a complete sample', () => {
    expect(router.contextPressureRatio(undefined)).toBeUndefined()
    expect(router.contextPressureRatio({ surfaceTokens: 5 })).toBeUndefined()
    expect(router.contextPressureRatio({ contextWindow: 1_000, surfaceTokens: 5 })).toBeUndefined()
  })

  it('prices the surface movement since the stamped sample over the newest capacity', () => {
    expect(router.contextPressureRatio({
      contextWindow: 1_000,
      pressureTokens: 800,
      surfaceTokens: 810,
      sampledSurfaceTokens: 790,
    })).toBeCloseTo(0.82)
    expect(router.contextPressureRatio({
      contextWindow: 1_000,
      pressureTokens: 800,
      surfaceTokens: 800,
    })).toBeCloseTo(0.8)
  })

  it('clamps surface shrinkage below zero', () => {
    expect(router.contextPressureRatio({
      contextWindow: 100,
      pressureTokens: 10,
      surfaceTokens: 5,
      sampledSurfaceTokens: 100,
    })).toBe(0)
  })
})

describe('toolDensity', () => {
  it('reads undefined before any completed step', () => {
    expect(router.toolDensity(undefined, 12)).toBeUndefined()
    expect(router.toolDensity({ steps: [] }, 12)).toBeUndefined()
    expect(router.toolDensity({ steps: [false] }, 12)).toBeUndefined()
  })

  it('averages only the completed steps inside the window', () => {
    expect(router.toolDensity({ steps: [true, false] }, 12)).toBe(1)
    expect(router.toolDensity({ steps: [false, true, false, true] }, 2)).toBe(0.5)
    expect(router.toolDensity({ steps: [true, true, false] }, 1)).toBe(1)
  })
})

describe('llmRouter projection fold', () => {
  it('folds one slot per step and flips the newest on a tool call', async () => {
    const { ctx, session } = await foldHarness()
    context = ctx

    // No step slot exists yet, so an orphan tool call cannot flip anything.
    appendToolCall(session, 1, 1, 'orphan')
    expect(routerState(ctx, session)).toEqual({ steps: [] })

    startStep(session, 1, 1)
    appendToolCall(session, 1, 1, 'call-1')
    // The slot is already set: a second call in the same step is a no-op.
    appendToolCall(session, 1, 1, 'call-2')
    expect(routerState(ctx, session)).toEqual({ steps: [true] })

    session.append('session/end-seed', {})
    startStep(session, 1, 2)
    appendToolCall(session, 1, 2, 'call-3')
    expect(routerState(ctx, session)).toEqual({ steps: [true, true] })
  })

  it('caps retained slots at 64 and drops the oldest occupancy', async () => {
    const { ctx, session } = await foldHarness()
    context = ctx
    startStep(session, 1, 1)
    appendToolCall(session, 1, 1, 'call-oldest')
    for (let step = 2; step <= 65; step += 1) {
      startStep(session, 1, step)
    }

    const state = routerState(ctx, session)
    expect(state?.steps).toHaveLength(64)
    expect(state?.steps).toEqual(Array.from({ length: 64 }, () => false))
  })
})

describe('request routing', () => {
  it('applies the first matching rule', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter, { config: { routes: [
      { when: { provider: 'mock' }, route: { provider: 'mock', model: 'first' } },
      { when: {}, route: { provider: 'mock', model: 'second' } },
    ] } })
    const agent = await context.agentLoop.create(SessionId('router-first-rule'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['first'])
  })

  it('skips rules whose provider or model does not match', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter, { config: { routes: [
      { when: { provider: 'other' }, route: { provider: 'mock', model: 'never-provider' } },
      { when: { model: 'other-model' }, route: { provider: 'mock', model: 'never-model' } },
      { when: {}, route: { provider: 'mock', model: 'matched' } },
    ] } })
    const agent = await context.agentLoop.create(SessionId('router-skip-mismatch'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['matched'])
  })

  it('matches every request through a rule without a match filter', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter, { config: { routes: [
      { route: { provider: 'mock', model: 'catch-all' } },
    ] } })
    const agent = await context.agentLoop.create(SessionId('router-catch-all'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['catch-all'])
  })

  it('keeps a matching rule ahead of the auto branch', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter, { config: {
      routes: [{ when: {}, route: { provider: 'mock', model: 'routed-rule' } }],
      auto: {
        when: { provider: 'mock' },
        capability: { provider: 'mock', model: 'cap' },
        economy: { provider: 'mock', model: 'eco' },
      },
    } })
    const agent = await context.agentLoop.create(SessionId('router-rule-over-auto'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['routed-rule'])
  })

  it('leaves the request untouched when its route already equals the target', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter, { config: { routes: [
      { when: { provider: 'mock' }, route: { provider: 'mock', model: 'mock' } },
    ] } })
    const agent = await context.agentLoop.create(SessionId('router-same-route'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['mock'])
  })

  it('ignores an auto branch whose filter excludes the request', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter, { config: { auto: {
      when: { provider: 'other' },
      capability: { provider: 'mock', model: 'cap' },
    } } })
    const agent = await context.agentLoop.create(SessionId('router-auto-outside'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['mock'])
  })

  it('keeps the request route when a signal-free branch has no economy target', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter, { config: { auto: {
      when: { provider: 'mock' },
      capability: { provider: 'mock', model: 'cap' },
    } } })
    const agent = await context.agentLoop.create(SessionId('router-no-economy'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['mock'])
  })

  it('elevates a request under context pressure above the threshold', async () => {
    const adapter = new ScriptedAdapter([
      textResponse('answer', { inputTokens: 8_000, outputTokens: 10 }),
      textResponse('done'),
    ], { contextWindow: 10_000 })
    context = await harness(adapter, { tokenMeter: true, config: { auto: {
      when: { provider: 'mock' },
      capability: { provider: 'mock', model: 'cap' },
    } } })
    const agent = await context.agentLoop.create(SessionId('router-pressure-high'), { provider: 'mock', model: 'mock' })
    agent.followup(user('first'))
    await agent.whenIdle()
    agent.followup(user('second'))
    await agent.whenIdle()

    expect(adapter.requests.map(request => request.model)).toEqual(['mock', 'cap'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message').map(event => event.data.message.source))
      .toMatchObject([{ model: 'mock' }, { model: 'cap' }])
  })

  it('routes to the economy target below both thresholds', async () => {
    const adapter = new ScriptedAdapter([
      textResponse('answer', { inputTokens: 8_000, outputTokens: 10 }),
      textResponse('done'),
    ], { contextWindow: 1_000_000 })
    context = await harness(adapter, { tokenMeter: true, config: { auto: {
      when: { provider: 'mock' },
      capability: { provider: 'mock', model: 'cap' },
      economy: { provider: 'mock', model: 'eco' },
    } } })
    const agent = await context.agentLoop.create(SessionId('router-pressure-low'), { provider: 'mock', model: 'mock' })
    agent.followup(user('first'))
    await agent.whenIdle()
    agent.followup(user('second'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['eco', 'eco'])
  })

  it('routes to the economy target when tool density stays at zero', async () => {
    const adapter = new ScriptedAdapter([textResponse('answer'), textResponse('done')])
    context = await harness(adapter, { config: { auto: {
      when: { provider: 'mock' },
      capability: { provider: 'mock', model: 'cap' },
      economy: { provider: 'mock', model: 'eco' },
    } } })
    const agent = await context.agentLoop.create(SessionId('router-density-zero'), { provider: 'mock', model: 'mock' })
    agent.followup(user('first'))
    await agent.whenIdle()
    agent.followup(user('second'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['eco', 'eco'])
  })

  it('elevates a request when the recent steps all used tools', async () => {
    let probes = 0
    const adapter = new ScriptedAdapter([toolCallResponse('call-1', 'probe'), textResponse('done')])
    context = await harness(adapter, { config: { auto: {
      when: { provider: 'mock' },
      capability: { provider: 'mock', model: 'cap' },
    } } })
    context.tools.register(defineContentToolFixture({
      name: 'probe',
      description: 'records that the model reached the tool',
      parameters: {},
      async execute() {
        probes += 1
        return [{ type: 'text', text: 'ok' }]
      },
    }))
    const agent = await context.agentLoop.create(SessionId('router-density-high'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()

    expect(probes).toBe(1)
    expect(adapter.requests.map(request => request.model)).toEqual(['mock', 'cap'])
  })

  it('clears an inherited reasoning effort when the target names none', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter, {
      config: { routes: [{ when: {}, route: { provider: 'mock', model: 'mock' } }] },
      beforeRouter: (ctx) => {
        ctx.on('agent/request', async (_payload, next) => ({ ...await next(), reasoningEffort: ReasoningEffortId('low') }))
      },
    })
    const agent = await context.agentLoop.create(SessionId('router-clear-effort'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.reasoningEffort).toBeUndefined()
  })

  it('applies an explicit target reasoning effort', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')], {
      reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }] },
    })
    context = await harness(adapter, { config: { routes: [
      { when: {}, route: { provider: 'mock', model: 'mock', reasoningEffort: ReasoningEffortId('low') } },
    ] } })
    const agent = await context.agentLoop.create(SessionId('router-explicit-effort'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.reasoningEffort).toBe('low')
  })

  it('routes the configuration produced by an inner waterfall listener', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter, {
      config: { routes: [{ when: { model: 'base-model' }, route: { provider: 'mock', model: 'routed' } }] },
      beforeRouter: (ctx) => {
        ctx.on('agent/request', async (_payload, next) => ({ ...await next(), model: 'base-model' }))
      },
    })
    const agent = await context.agentLoop.create(SessionId('router-prepend'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['routed'])
  })
})

describe('plugin mounting', () => {
  it('installs the projection and a pass-through listener under the default configuration', async () => {
    const adapter = new ScriptedAdapter([textResponse('done')])
    context = await harness(adapter)
    const agent = await context.agentLoop.create(SessionId('router-default-config'), { provider: 'mock', model: 'mock' })
    agent.followup(user('go'))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['mock'])
    expect(routerState(context, agent.session)).toEqual({ steps: [false] })
  })

  it('rejects an invalid configuration before registering the projection', () => {
    const ctx = new Context()
    expect(() => { router.apply(ctx, asConfig({ bogus: true })) }).toThrow(/llm-router: unknown key "bogus"/)
  })
})
