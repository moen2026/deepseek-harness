import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import LlmRuntime, { createAssistantMessage, createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import Memory, { type MemoryDraft, type MemoryProvider, type MemoryRecord } from '@deepseek-ai/dsh-memory'
import type { AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import * as MemoryReflection from '@deepseek-ai/dsh-memory-reflection'
import { frameReflectionInput, resolveMemoryReflectionConfig } from '@deepseek-ai/dsh-memory-reflection'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'reflection-fixture': { kind: 'reflection-fixture' } & ContextFormed
  }
}

/** A scripted LLM adapter recording every dispatched request. */
class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  calls = 0

  constructor(
    private readonly script: readonly StreamChunk[],
    private readonly onDispatch?: () => void,
  ) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    this.onDispatch?.()
    this.requests.push(options)
    yield * this.script
  }
}

/** A model stream that hangs until its request signal aborts. */
class CooperativeAdapter extends LlmAdapter {
  calls = 0

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    const signal = options.signal
    if (signal === undefined) throw new Error('expected a reflection request signal')
    await new Promise<never>((_resolve, reject) => {
      const rejectAbort = (): void => {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercise exact AbortSignal.reason propagation
        reject(signal.reason)
      }
      if (signal.aborted) {
        rejectAbort()
        return
      }
      signal.addEventListener('abort', rejectAbort, { once: true })
    })
  }
}

/** One scripted model answer carrying a single text block. */
function jsonScript(payload: unknown): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: JSON.stringify(payload) },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

interface ReflectionProvider extends MemoryProvider {
  drafts: MemoryDraft[]
  records: MemoryRecord[]
  failList: boolean
}

function reflectionProvider(): ReflectionProvider {
  const provider: ReflectionProvider = {
    id: 'reflection-stub',
    drafts: [],
    records: [],
    failList: false,
    remember(draft) {
      provider.drafts.push(draft)
      return Promise.resolve(`mem-${provider.drafts.length}`)
    },
    recall: () => Promise.resolve({ hits: [] }),
    forget: () => Promise.resolve(false),
    list() {
      if (provider.failList) return Promise.reject(new Error('backend down'))
      return Promise.resolve({ records: provider.records })
    },
  }
  return provider
}

/** One macrotask flushes every settled promise chain a reflection may hold. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

/** Sessions the fixtures have already given a request header. */
const headered = new WeakSet<Session>()

/** Open a turn, adding the route header the reflection resolves against once per session. */
function openTurn(session: Session, turn: number): void {
  session.append('turn/start', { turn })
  if (!headered.has(session)) {
    headered.add(session)
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock' } },
      reason: 'initial',
    })
  }
}

interface SeededTurn {
  userSeq: SessionSeq
  assistantSeq: SessionSeq
}

/** Seed one complete human/assistant turn for the reflection to consider. */
function seedTurn(session: Session, turn: number, userText: string, assistantText: string): SeededTurn {
  openTurn(session, turn)
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: userText }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  const assistant = session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: assistantText }],
      source: { provider: 'mock', model: 'mock' },
    }),
    stream: [],
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return { userSeq: user.seq, assistantSeq: assistant.seq }
}

const DEFAULT_SCRIPT: readonly StreamChunk[] = jsonScript({
  memories: [{ text: 'Prefers tabs over spaces.', namespace: 'style', confidence: 0.9 }],
})

interface MountOptions {
  /** Reflection plugin configuration (defaults to `write: 'ask'`). */
  config?: MemoryReflection.Config
  /** Scripted model answer; defaults to one style candidate. */
  script?: readonly StreamChunk[]
  /** Hang the model stream until its request deadline instead of scripting one. */
  hanging?: boolean
  /** Memory provider to register; `null` mounts without one. */
  provider?: ReflectionProvider | null
  /** Provide a user-questions service answering the given decision. */
  questions?: { approve: boolean }
  /** Provide an agents registry resolving the fixture session to this agent. */
  agent?: { id: string }
  /** Seed turns before the plugin is mounted. */
  seedFirst?: (session: Session) => void
  /** Observe each model dispatch with the fixture session. */
  onDispatch?: (session: Session) => void
}

interface Mounted {
  ctx: Context
  adapter: RecordingAdapter | CooperativeAdapter
  session: Session
  questionRequests: AskUserQuestionRequest[]
}

async function mountReflection(options: MountOptions = {}): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Memory)
  const provider = options.provider === undefined ? reflectionProvider() : options.provider
  if (provider !== null) ctx.memory.registerProvider(provider)
  const questionRequests: AskUserQuestionRequest[] = []
  const decision = options.questions
  if (decision !== undefined) {
    ctx.provide('userQuestions', {
      ask: (request: AskUserQuestionRequest) => {
        questionRequests.push(request)
        return Promise.resolve({
          answers: request.questions.map(question => ({
            id: question.id,
            selected: decision.approve ? ['Save'] : ['Discard'],
          })),
        })
      },
    } as never)
  }
  const session = ctx.sessions.create(SessionId('reflection-root'))
  if (options.agent !== undefined) {
    const agent = options.agent
    ctx.provide('agents', { get: (id: SessionId) => (id === session.id ? agent : undefined) } as never)
  }
  const adapter = options.hanging === true
    ? new CooperativeAdapter()
    : new RecordingAdapter(
      options.script ?? DEFAULT_SCRIPT,
      options.onDispatch === undefined ? undefined : () => { options.onDispatch?.(session) },
    )
  ctx.llm.registerAdapter(['mock'], adapter)
  options.seedFirst?.(session)
  await ctx.plugin(MemoryReflection, options.config)
  return { ctx, adapter, session, questionRequests }
}

/** Narrow a fixture to its scripted adapter for request-content assertions. */
function scripted(mounted: Mounted): RecordingAdapter {
  const adapter = mounted.adapter
  if (!(adapter instanceof RecordingAdapter)) throw new Error('expected a scripted adapter')
  return adapter
}

describe('resolveMemoryReflectionConfig', () => {
  it('fills defaults and freezes the result', () => {
    const resolved = resolveMemoryReflectionConfig()
    expect(resolved).toEqual({ write: 'ask', timeoutMs: 30_000, maxOutputTokens: 512, maxInputBytes: 32_768 })
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  it('accepts an explicit route and auto write mode', () => {
    expect(resolveMemoryReflectionConfig({ write: 'auto', provider: 'p', model: 'm' }))
      .toEqual({ write: 'auto', timeoutMs: 30_000, maxOutputTokens: 512, maxInputBytes: 32_768, provider: 'p', model: 'm' })
  })

  it('rejects invalid deployment values and unknown keys', () => {
    expect(() => resolveMemoryReflectionConfig({ extra: true } as never)).toThrow(/unknown config key "extra"/)
    expect(() => resolveMemoryReflectionConfig({ timeoutMs: 0 })).toThrow(/timeoutMs must be a positive integer/)
    expect(() => resolveMemoryReflectionConfig({ timeoutMs: 1.5 })).toThrow(/timeoutMs must be a positive integer/)
    expect(() => resolveMemoryReflectionConfig({ timeoutMs: MAX_TIMER_DELAY_MS + 1 })).toThrow(/must not exceed/)
    expect(() => resolveMemoryReflectionConfig({ maxOutputTokens: 0 })).toThrow(/maxOutputTokens must be a positive integer/)
    expect(() => resolveMemoryReflectionConfig({ maxInputBytes: 0 })).toThrow(/maxInputBytes must be a positive integer/)
    expect(() => resolveMemoryReflectionConfig({ provider: 'p' })).toThrow(/must be supplied together/)
    expect(() => resolveMemoryReflectionConfig({ model: 'm' })).toThrow(/must be supplied together/)
    expect(() => resolveMemoryReflectionConfig({ provider: '', model: 'm' })).toThrow(/non-empty strings/)
    expect(() => resolveMemoryReflectionConfig({ provider: 'p', model: '' })).toThrow(/non-empty strings/)
  })
})

describe('memory reflection', () => {
  it('writes extracted candidates directly in auto mode and logs both events', async () => {
    const provider = reflectionProvider()
    let requestWasLoggedAtDispatch = false
    const mounted = await mountReflection({
      provider,
      config: { write: 'auto', maxOutputTokens: 64 },
      script: jsonScript({ memories: [{ text: 'Prefers tabs over spaces.', namespace: 'style', confidence: 0.9 }] }),
      onDispatch: (session) => {
        requestWasLoggedAtDispatch = session.snapshotEvents()
          .some(event => event.type === 'memory/reflection-llm-request')
      },
    })
    const turn = seedTurn(mounted.session, 1, 'Please always use tabs.', 'Sure — tabs it is.')
    await vi.waitFor(() => { expect(provider.drafts).toHaveLength(1) })
    expect(provider.drafts[0]).toEqual({
      text: 'Prefers tabs over spaces.',
      namespace: 'style',
      confidence: 0.9,
      tags: ['reflection'],
    })
    const options = scripted(mounted).requests[0]
    if (options === undefined) throw new Error('expected one dispatched request')
    expect(Object.isFrozen(options)).toBe(true)
    expect(options).toMatchObject({
      provider: 'mock',
      model: 'mock',
      maxTokens: 64,
      sessionId: mounted.session.id,
      purpose: 'memory-reflection',
    })
    expect(options.system).toContain('JSON')
    const prompt = options.messages[0]?.content[0]
    expect(prompt?.type === 'text' && prompt.text).toContain('Please always use tabs.')
    expect(prompt?.type === 'text' && prompt.text).toContain('tabs it is')
    expect(requestWasLoggedAtDispatch).toBe(true)
    const events = mounted.session.snapshotEvents()
    expect(events.find(event => event.type === 'memory/reflection-llm-request')?.data).toMatchObject({
      turn: 1,
      inputSeqs: [turn.userSeq, turn.assistantSeq],
      route: { provider: 'mock', model: 'mock' },
      system: options.system,
      maxTokens: 64,
    })
    expect(events.find(event => event.type === 'memory/reflection')?.data).toMatchObject({
      turn: 1,
      outcome: 'written',
      ids: ['mem-1'],
      candidates: [{ text: 'Prefers tabs over spaces.', namespace: 'style', confidence: 0.9 }],
    })
  })

  it('drops candidates that fail the safety scan before approval or write', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({
      provider,
      config: { write: 'auto' },
      script: jsonScript({ memories: [
        { text: 'Clean durable fact.', namespace: 'fact', confidence: 0.8 },
        { text: 'Sneaky\u200Binstruction\u202Eoverride', namespace: 'fact', confidence: 0.9 },
      ] }),
    })
    seedTurn(mounted.session, 1, 'hi', 'hello')
    await vi.waitFor(() => { expect(provider.drafts).toHaveLength(1) })
    expect(provider.drafts[0]).toMatchObject({ text: 'Clean durable fact.' })
    expect(mounted.session.snapshotEvents().find(event => event.type === 'memory/reflection')?.data)
      .toMatchObject({ turn: 1, outcome: 'written' })
  })

  it('asks for approval in ask mode and writes only on approval', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({
      provider,
      questions: { approve: true },
      script: jsonScript({ memories: [{ text: 'Answers in Chinese.', namespace: 'preference' }] }),
    })
    seedTurn(mounted.session, 1, 'Always answer in Chinese.', '好的。')
    await vi.waitFor(() => { expect(provider.drafts).toHaveLength(1) })
    expect(mounted.questionRequests).toHaveLength(1)
    const request = mounted.questionRequests[0]
    if (request === undefined) throw new Error('expected one approval request')
    expect(request.agent).toBeUndefined()
    expect(request.questions).toEqual([{
      id: 'memory-reflection',
      question: 'Save this extracted memory?',
      detail: '- Answers in Chinese.',
      options: [{ label: 'Save' }, { label: 'Discard' }],
    }])
    expect(provider.drafts[0]).toMatchObject({
      text: 'Answers in Chinese.',
      namespace: 'preference',
      tags: ['reflection'],
    })
    expect(mounted.session.snapshotEvents().find(event => event.type === 'memory/reflection')?.data)
      .toMatchObject({ outcome: 'written' })
  })

  it('records the rejected outcome and writes nothing on discard', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({
      provider,
      questions: { approve: false },
      script: jsonScript({ memories: [{ text: 'x' }] }),
    })
    seedTurn(mounted.session, 1, 'hi', 'ok')
    await vi.waitFor(() => {
      expect(mounted.session.snapshotEvents().find(event => event.type === 'memory/reflection')?.data)
        .toMatchObject({ outcome: 'rejected' })
    })
    expect(provider.drafts).toHaveLength(0)
  })

  it('pluralizes the approval question for multiple candidates', async () => {
    const mounted = await mountReflection({
      questions: { approve: false },
      script: jsonScript({ memories: [{ text: 'a' }, { text: 'b' }] }),
    })
    seedTurn(mounted.session, 1, 'hi', 'ok')
    await vi.waitFor(() => { expect(mounted.questionRequests).toHaveLength(1) })
    expect(mounted.questionRequests[0]?.questions[0]?.question).toBe('Save these 2 extracted memories?')
    expect(mounted.questionRequests[0]?.questions[0]?.detail).toBe('- a\n- b')
  })

  it('records unavailable and writes nothing when no user-questions service is mounted', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({
      provider,
      script: jsonScript({ memories: [{ text: 'x' }] }),
    })
    seedTurn(mounted.session, 1, 'hi', 'ok')
    await vi.waitFor(() => {
      expect(mounted.session.snapshotEvents().find(event => event.type === 'memory/reflection')?.data)
        .toMatchObject({ outcome: 'unavailable' })
    })
    expect(provider.drafts).toHaveLength(0)
    expect(scripted(mounted).requests).toHaveLength(1)
  })

  it('forwards the live agent when the registry resolves one', async () => {
    const provider = reflectionProvider()
    const agent = { id: 'agent-1' }
    const mounted = await mountReflection({
      provider,
      agent,
      questions: { approve: true },
      script: jsonScript({ memories: [{ text: 'x' }] }),
    })
    seedTurn(mounted.session, 1, 'hi', 'ok')
    await vi.waitFor(() => { expect(mounted.questionRequests).toHaveLength(1) })
    expect(mounted.questionRequests[0]?.agent).toBe(agent)
    expect(provider.drafts).toHaveLength(1)
  })

  it('skips extraction when no memory provider is mounted', async () => {
    const mounted = await mountReflection({ provider: null, config: { write: 'auto' } })
    const list = vi.spyOn(mounted.ctx.memory, 'list')
    seedTurn(mounted.session, 1, 'hi', 'ok')
    await vi.waitFor(() => { expect(list).toHaveBeenCalled() })
    await settle()
    expect(scripted(mounted).requests).toHaveLength(0)
    expect(mounted.session.snapshotEvents().some(event => event.type === 'memory/reflection')).toBe(false)
  })

  it('skips extraction without a model call when the provider cannot list', async () => {
    const provider = reflectionProvider()
    provider.failList = true
    const mounted = await mountReflection({ provider, config: { write: 'auto' } })
    const list = vi.spyOn(mounted.ctx.memory, 'list')
    seedTurn(mounted.session, 1, 'hi', 'ok')
    await vi.waitFor(() => { expect(list).toHaveBeenCalled() })
    await settle()
    expect(scripted(mounted).requests).toHaveLength(0)
    expect(provider.drafts).toHaveLength(0)
  })

  it('does nothing for a turn without conversational text', async () => {
    const mounted = await mountReflection()
    mounted.session.append('turn/start', { turn: 1 })
    mounted.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    expect(scripted(mounted).requests).toHaveLength(0)
  })

  it('ignores turns opened before the plugin was mounted', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({
      provider,
      config: { write: 'auto' },
      seedFirst: (session) => { seedTurn(session, 1, 'old turn', 'old answer') },
    })
    await settle()
    expect(scripted(mounted).requests).toHaveLength(0)
    seedTurn(mounted.session, 2, 'new turn', 'new answer')
    await vi.waitFor(() => { expect(scripted(mounted).requests).toHaveLength(1) })
    expect(provider.drafts).toHaveLength(1)
  })

  it('skips child sessions that share their parent turns', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({ provider, config: { write: 'auto' } })
    const child = mounted.ctx.sessions.create(SessionId('reflection-child'), {
      meta: { parentSession: mounted.session.id },
    })
    seedTurn(child, 1, 'child turn', 'child answer')
    await settle()
    expect(scripted(mounted).requests).toHaveLength(0)
    seedTurn(mounted.session, 1, 'root turn', 'root answer')
    await vi.waitFor(() => { expect(scripted(mounted).requests).toHaveLength(1) })
    expect(provider.drafts).toHaveLength(1)
  })

  it('drops a second turn end while the first reflection is still in flight', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({ provider, hanging: true, config: { write: 'auto', timeoutMs: 120 } })
    seedTurn(mounted.session, 1, 'first turn', 'first answer')
    await vi.waitFor(() => { expect(mounted.adapter.calls).toBe(1) })
    seedTurn(mounted.session, 2, 'second turn', 'second answer')
    await settle()
    expect(mounted.adapter.calls).toBe(1)
    await new Promise((resolve) => { setTimeout(resolve, 180) })
    expect(mounted.adapter.calls).toBe(1)
    expect(provider.drafts).toHaveLength(0)
  })

  it('warns and records no reflection when the model call exceeds its deadline', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({ provider, hanging: true, config: { write: 'auto', timeoutMs: 60 } })
    const warn = vi.spyOn(mounted.ctx.logger, 'warn')
    seedTurn(mounted.session, 1, 'first turn', 'first answer')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })
    expect(String(warn.mock.calls[0]?.[0])).toContain('memory-reflection: extraction failed')
    expect(mounted.session.snapshotEvents().some(event => event.type === 'memory/reflection')).toBe(false)
    expect(provider.drafts).toHaveLength(0)
  })

  it('warns and records nothing when the model call fails', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({
      provider,
      config: { write: 'auto' },
      script: [{ type: 'finish', reason: { kind: 'error', failure: { message: 'provider failed', code: 'SERVER' } } }],
    })
    const warn = vi.spyOn(mounted.ctx.logger, 'warn')
    seedTurn(mounted.session, 1, 'hi', 'ok')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })
    expect(mounted.session.snapshotEvents().some(event => event.type === 'memory/reflection')).toBe(false)
    expect(provider.drafts).toHaveLength(0)
  })

  it('records nothing when the model answer yields no candidates', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({ provider, config: { write: 'auto' }, script: jsonScript('no memories') })
    const list = vi.spyOn(mounted.ctx.memory, 'list')
    seedTurn(mounted.session, 1, 'hi', 'ok')
    await vi.waitFor(() => { expect(list).toHaveBeenCalled() })
    await settle()
    expect(provider.drafts).toHaveLength(0)
    expect(mounted.session.snapshotEvents().some(event => event.type === 'memory/reflection')).toBe(false)
  })

  it('bounds the framed input and records only the represented seqs', async () => {
    const provider = reflectionProvider()
    const longUser = 'u'.repeat(400)
    const shortAssistant = 'ok'
    const cap = Buffer.byteLength(frameReflectionInput([{ role: 'assistant', text: shortAssistant }]), 'utf8')
    const mounted = await mountReflection({
      provider,
      config: { write: 'auto', maxInputBytes: cap },
      script: jsonScript({ memories: [] }),
    })
    const turn = seedTurn(mounted.session, 1, longUser, shortAssistant)
    await vi.waitFor(() => { expect(scripted(mounted).requests).toHaveLength(1) })
    const request = mounted.session.snapshotEvents().find(event => event.type === 'memory/reflection-llm-request')
    expect(request?.data).toMatchObject({ inputSeqs: [turn.assistantSeq] })
    const prompt = scripted(mounted).requests[0]?.messages[0]?.content[0]
    const text = prompt?.type === 'text' ? prompt.text : ''
    expect(text).toContain('"text":"ok"')
    expect(text).not.toContain('u'.repeat(50))
  })

  it('ignores user messages whose source is not the direct human', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({ provider, config: { write: 'auto' } })
    openTurn(mounted.session, 1)
    mounted.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'fixture injection' }],
      source: { kind: 'reflection-fixture' },
    }), { surfaceOp: 'append' })
    const human = mounted.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'real human text' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    mounted.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(scripted(mounted).requests).toHaveLength(1) })
    const request = mounted.session.snapshotEvents().find(event => event.type === 'memory/reflection-llm-request')
    expect(request?.data).toMatchObject({ inputSeqs: [human.seq] })
    const prompt = scripted(mounted).requests[0]?.messages[0]?.content[0]
    const text = prompt?.type === 'text' ? prompt.text : ''
    expect(text).toContain('real human text')
    expect(text).not.toContain('fixture injection')
  })

  it('frames only the text blocks of a mixed assistant message', async () => {
    const provider = reflectionProvider()
    const mounted = await mountReflection({ provider, config: { write: 'auto' }, script: jsonScript({ memories: [] }) })
    openTurn(mounted.session, 1)
    mounted.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    mounted.session.append('step/start', { turn: 1, step: 1 })
    mounted.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'text', text: 'the visible answer' },
          { type: 'tool-call', id: ToolCallId('call-1'), name: 'unexpected-tool', arguments: '{}' },
        ],
        source: { provider: 'mock', model: 'mock' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    mounted.session.append('step/end', { turn: 1, step: 1 })
    mounted.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => { expect(scripted(mounted).requests).toHaveLength(1) })
    const prompt = scripted(mounted).requests[0]?.messages[0]?.content[0]
    const text = prompt?.type === 'text' ? prompt.text : ''
    expect(text).toContain('the visible answer')
    expect(text).not.toContain('unexpected-tool')
  })
})
