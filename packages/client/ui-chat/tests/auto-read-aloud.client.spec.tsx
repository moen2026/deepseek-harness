// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TtsCatalog } from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatConversationViewNode, ChatNode } from '../src/client/contract/chat-nodes.ts'
import type { ChatSnapshot } from '../src/client/contract/snapshot.ts'
import { EMPTY_CHAT_SNAPSHOT } from '../src/client/contract/snapshot.ts'
import {
  AutoReadAloudAction, type AutoReadAloudActionProps,
} from '../src/client/chat/AutoReadAloudAction.tsx'
import { createAutoReadAloudStore, latestClosingSpeech } from '../src/client/chat/auto-read-aloud.ts'
import { bindReadAloudRemote, readAloudEngine, type ReadAloudRemote } from '../src/client/chat/read-aloud.ts'
import { zh } from '../src/client/locale.ts'

afterEach(cleanup)
beforeEach(() => { readAloudEngine.set('remote') })

const t = ((key: keyof typeof zh) => zh[key]) as AutoReadAloudActionProps['t']

class FakeUtterance {
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly text: string) {}
}

function installEngine(): { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  const speak = vi.fn()
  const cancel = vi.fn()
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak, cancel } })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
  return { speak, cancel }
}

function rawTail(key: string, seq: number, closing: unknown): ChatConversationViewNode {
  return {
    key,
    kind: 'turn-tail',
    id: key,
    target: 'chat',
    anchorSeq: seq,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { turn: 1, seq, time: 0, branchUnavailable: false, closing },
  }
}

function tailNode(
  key: string, seq: number, closing: { readonly seq: number; readonly text: string } | null,
): ChatConversationViewNode {
  return rawTail(key, seq, closing === null ? null : {
    status: 'settled',
    turn: 1,
    step: 1,
    time: 0,
    blocks: [{ kind: 'text', text: closing.text }],
    finalNode: { seq: closing.seq },
  })
}

interface Cells {
  sessionId: SessionId
  running: boolean | undefined
  enabled: boolean
  order: readonly string[]
  nodes: Map<string, ChatConversationViewNode>
}

function harness(seed: Partial<Cells> = {}) {
  const cells: Cells = {
    sessionId: 'session-1' as SessionId,
    running: false,
    enabled: false,
    order: [],
    nodes: new Map(),
    ...seed,
  }
  const snapshot = (): ChatSnapshot => ({
    ...EMPTY_CHAT_SNAPSHOT,
    order: cells.order,
    nodes: { ...EMPTY_CHAT_SNAPSHOT.nodes, get: key => cells.nodes.get(key) },
  })
  const setAutoReadAloud = vi.fn((next: boolean) => { cells.enabled = next })
  const props = {
    sessionId: cells.sessionId,
    useChat: (selector: (value: ChatSnapshot) => unknown) => selector(snapshot()),
    useSession: (selector: (value: { readonly running: boolean | undefined }) => unknown) =>
      selector({ running: cells.running }),
    useAutoReadAloud: (selector: (value: boolean) => unknown) => selector(cells.enabled),
    setAutoReadAloud,
    t,
  } as unknown as AutoReadAloudActionProps
  const view = render(<AutoReadAloudAction {...props} />)
  const update = (patch: Partial<Cells>): void => {
    Object.assign(cells, patch)
    view.rerender(<AutoReadAloudAction {...{ ...props, sessionId: cells.sessionId }} />)
  }
  return { view, cells, update, setAutoReadAloud }
}

function project(nodes: readonly ChatConversationViewNode[]): ReturnType<typeof latestClosingSpeech> {
  const byKey = new Map(nodes.map(node => [node.key, node]))
  return latestClosingSpeech(nodes.map(node => node.key), key => byKey.get(key) as ChatNode | undefined)
}

describe('latestClosingSpeech', () => {
  it('returns null without any Turn tail', () => {
    expect(project([])).toBeNull()
    expect(project([{ ...tailNode('u1', 1, null), kind: 'user' }])).toBeNull()
  })

  it('reads the newest Turn tail closing', () => {
    expect(project([
      tailNode('a', 1, { seq: 11, text: 'older' }),
      tailNode('b', 2, { seq: 21, text: ' newer ' }),
    ])).toEqual({ seq: 21, text: 'newer' })
  })

  it('stops at a contentless newest tail instead of replaying an earlier reply', () => {
    expect(project([
      tailNode('a', 1, { seq: 11, text: 'older' }),
      tailNode('b', 2, null),
    ])).toBeNull()
  })

  it('treats a closing without text blocks as no reply', () => {
    const node = rawTail('a', 1, {
      status: 'settled',
      turn: 1,
      step: 1,
      time: 0,
      blocks: [{ kind: 'reasoning', text: 'thought' }],
      finalNode: { seq: 9 },
    })
    expect(project([node])).toBeNull()
  })
})

describe('createAutoReadAloudStore', () => {
  beforeEach(() => { localStorage.clear() })

  it('defaults to off and rehydrates the persisted choice', () => {
    const store = createAutoReadAloudStore()
    expect(store.getSnapshot()).toBe(false)
    store.set(true)
    expect(localStorage.getItem('dsh.chat.autoReadAloud')).toBe('true')
    expect(createAutoReadAloudStore().getSnapshot()).toBe(true)
    store.set(false)
    expect(createAutoReadAloudStore().getSnapshot()).toBe(false)
  })
})

describe('AutoReadAloudAction', () => {
  it('stays hidden without a browser speech engine', () => {
    Reflect.deleteProperty(window, 'speechSynthesis')
    const { view } = harness()
    expect(view.container.querySelector('button')).toBeNull()
  })

  it('toggles the preference on click', () => {
    installEngine()
    const { view, update, setAutoReadAloud } = harness()
    const button = (): Element => view.container.querySelector('button')!
    expect(button().getAttribute('aria-pressed')).toBe('false')
    expect(button().getAttribute('aria-label')).toBe('自动朗读')
    fireEvent.click(button())
    expect(setAutoReadAloud).toHaveBeenLastCalledWith(true)
    update({})
    expect(button().getAttribute('aria-pressed')).toBe('true')
    expect(button().getAttribute('aria-label')).toBe('停止自动朗读')
    fireEvent.click(button())
    expect(setAutoReadAloud).toHaveBeenLastCalledWith(false)
    update({})
    expect(button().getAttribute('aria-pressed')).toBe('false')
  })

  it('never reads history on mount', () => {
    const { speak } = installEngine()
    harness({
      enabled: true,
      order: ['t1'],
      nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '旧回复' })]]),
    })
    expect(speak).not.toHaveBeenCalled()
  })

  it('reads the reply a live Turn settles into', () => {
    const { speak } = installEngine()
    const { update } = harness({ enabled: true })
    update({ running: true })
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    expect(speak).not.toHaveBeenCalled()
    update({ running: false })
    expect(speak).toHaveBeenCalledTimes(1)
    expect((speak.mock.calls[0]![0] as InstanceType<typeof FakeUtterance>).text).toBe('回答')
  })

  it('treats a repeat Turn cycle without a closing as nothing to read', () => {
    const { speak } = installEngine()
    const { update } = harness({ enabled: true })
    update({ running: true })
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    update({ running: false })
    expect(speak).toHaveBeenCalledTimes(1)
    update({ running: true })
    update({ running: false })
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('skips a Turn that ends without a closing and reads a lagged closing once it lands', () => {
    const { speak } = installEngine()
    const { update } = harness({ enabled: true })
    update({ running: true })
    update({ running: false })
    expect(speak).not.toHaveBeenCalled()
    // The closing arrives a snapshot after the Turn already ended.
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    expect(speak).toHaveBeenCalledTimes(1)
    // Re-projecting the same closing does not read it again.
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while disabled and only arms later Turns', () => {
    const { speak } = installEngine()
    const { view, update, setAutoReadAloud } = harness()
    update({ running: true })
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    update({ running: false })
    expect(speak).not.toHaveBeenCalled()
    fireEvent.click(view.container.querySelector('button')!)
    expect(setAutoReadAloud).toHaveBeenLastCalledWith(true)
    update({})
    expect(speak).not.toHaveBeenCalled()
  })

  it('reads through the browser engine while it is selected', () => {
    const { speak } = installEngine()
    installRemoteAudio()
    const { synthesize, unbind } = bindRemote(catalogWith('ready'))
    readAloudEngine.set('browser')
    const { update } = harness({ enabled: true })
    update({ running: true })
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    update({ running: false })
    expect(speak).toHaveBeenCalledTimes(1)
    expect(synthesize).not.toHaveBeenCalled()
    unbind()
  })

  it('reads through the remote path when a provider is prepared', async () => {
    installEngine()
    installRemoteAudio()
    const { synthesize, unbind } = bindRemote(catalogWith('ready'))
    const { update } = harness({ enabled: true })
    update({ running: true })
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    update({ running: false })
    await act(async () => {})
    expect(synthesize).toHaveBeenCalledWith('回答', expect.any(AbortSignal))
    expect(remoteContext().sources[0]!.start).toHaveBeenCalledTimes(1)
    unbind()
  })

  it('falls back to the browser engine when synthesis fails', async () => {
    const { speak } = installEngine()
    installRemoteAudio()
    const { synthesize, unbind } = bindRemote(catalogWith('ready'))
    synthesize.mockRejectedValue(new Error('synthesis failed'))
    const { update } = harness({ enabled: true })
    update({ running: true })
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    update({ running: false })
    await act(async () => {})
    expect(speak).toHaveBeenCalledTimes(1)
    expect((speak.mock.calls[0]![0] as InstanceType<typeof FakeUtterance>).text).toBe('回答')
    unbind()
  })

  it('stops the reading when toggled off', async () => {
    installEngine()
    installRemoteAudio()
    const { unbind } = bindRemote(catalogWith('ready'))
    const { view, update } = harness({ enabled: true })
    update({ running: true })
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    update({ running: false })
    await act(async () => {})
    const context = remoteContext()
    expect(context.sources[0]!.start).toHaveBeenCalledTimes(1)
    fireEvent.click(view.container.querySelector('button')!)
    update({})
    expect(context.sources[0]!.stop).toHaveBeenCalledTimes(1)
    unbind()
  })

  it('ends the reading when the header unmounts', async () => {
    installEngine()
    installRemoteAudio()
    const { unbind } = bindRemote(catalogWith('ready'))
    const { view, update } = harness({ enabled: true })
    update({ running: true })
    update({ order: ['t1'], nodes: new Map([['t1', tailNode('t1', 4, { seq: 40, text: '回答' })]]) })
    update({ running: false })
    await act(async () => {})
    const context = remoteContext()
    view.unmount()
    expect(context.sources[0]!.stop).toHaveBeenCalledTimes(1)
    unbind()
  })

  it('re-anchors on a Session switch', () => {
    const { speak, cancel } = installEngine()
    const { update } = harness({ enabled: true })
    update({ running: true })
    update({ order: ['a1'], nodes: new Map([['a1', tailNode('a1', 4, { seq: 40, text: '回答A' })]]) })
    update({ running: false })
    expect(speak).toHaveBeenCalledTimes(1)
    // The switch ends the reading A started and treats B's older history as seen.
    update({
      sessionId: 'session-2' as SessionId,
      order: ['b1'],
      nodes: new Map([['b1', tailNode('b1', 5, { seq: 5, text: '历史B' })]]),
    })
    expect(speak).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(2)
    // B's live Turn reads on settling.
    update({ running: true })
    update({
      order: ['b1', 'b2'],
      nodes: new Map([
        ['b1', tailNode('b1', 5, { seq: 5, text: '历史B' })],
        ['b2', tailNode('b2', 6, { seq: 6, text: '回答B' })],
      ]),
    })
    update({ running: false })
    expect(speak).toHaveBeenCalledTimes(2)
    expect((speak.mock.calls[1]![0] as InstanceType<typeof FakeUtterance>).text).toBe('回答B')
  })
})

class FakeBufferSource {
  onended: (() => void) | null = null
  buffer: unknown = null
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

class FakeAudioContext {
  static current: FakeAudioContext | undefined
  destination = {}
  closed = false
  readonly sources: FakeBufferSource[] = []
  decodeAudioData = vi.fn(async () => ({ duration: 1 }))
  createBufferSource = vi.fn(() => {
    const source = new FakeBufferSource()
    this.sources.push(source)
    return source
  })
  close = vi.fn(async () => { this.closed = true })
  constructor() { FakeAudioContext.current = this }
}

function installRemoteAudio(): void {
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext, writable: true })
}

function remoteContext(): FakeAudioContext {
  return FakeAudioContext.current!
}

function bindRemote(catalog: TtsCatalog | null, connected = true): {
  remote: ReadAloudRemote
  unbind: () => void
  synthesize: ReturnType<typeof vi.fn>
} {
  const synthesize = vi.fn(async () => new Uint8Array([1, 2, 3]))
  const readiness = createSnapshotStore({ catalog, connected, error: null })
  const remote: ReadAloudRemote = { readiness, synthesize }
  return { remote, unbind: bindReadAloudRemote(remote), synthesize }
}

function catalogWith(phase: string): TtsCatalog {
  return {
    providers: [{ preparation: { phase } }],
    selection: { providerId: 'local', voiceId: 'zf_001', speed: 1 },
  } as unknown as TtsCatalog
}
