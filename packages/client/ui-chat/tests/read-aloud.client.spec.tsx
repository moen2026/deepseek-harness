// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { TtsCatalog } from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatViewSlotProps } from '../src/client/contract/slots.ts'
import { MessageIconActions } from '../src/client/chat/MessageIconActions.tsx'
import { bindReadAloudRemote, readAloudEngine, splitSentences, type ReadAloudRemote } from '../src/client/chat/read-aloud.ts'
import { zh } from '../src/client/locale.ts'

afterEach(cleanup)
beforeEach(() => { readAloudEngine.set('remote') })

const t = ((key: keyof typeof zh) => zh[key]) as ChatViewSlotProps['t']

class FakeUtterance {
  lang = ''
  rate = 1
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

function renderAssistant(text = '你好，世界'): ReturnType<typeof render> {
  return render(<MessageIconActions text={text} clock="end" speakable t={t} />)
}

describe('assistant read-aloud action', () => {
  it('stays hidden without a browser speech engine', () => {
    expect(window.speechSynthesis).toBeUndefined()
    const { container } = renderAssistant()
    expect(container.querySelector('button[aria-label="朗读"]')).toBeNull()
  })

  it('speaks the reply text on click and toggles to stop', () => {
    const { speak, cancel } = installEngine()
    const { container } = renderAssistant()
    const button = container.querySelector('button[aria-label="朗读"]')
    expect(button).not.toBeNull()
    fireEvent.click(button!)
    expect(speak).toHaveBeenCalledTimes(1)
    const utterance = speak.mock.calls[0]![0] as InstanceType<typeof FakeUtterance>
    expect(utterance.text).toBe('你好，世界')
    expect(utterance.lang).toBe('zh-CN')
    expect(container.querySelector('button[aria-label="停止朗读"]')).not.toBeNull()
    fireEvent.click(container.querySelector('button[aria-label="停止朗读"]')!)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(container.querySelector('button[aria-label="朗读"]')).not.toBeNull()
  })

  it('returns to idle when the utterance completes', () => {
    const { speak } = installEngine()
    const { container } = renderAssistant()
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    const utterance = speak.mock.calls[0]![0] as InstanceType<typeof FakeUtterance>
    act(() => { utterance.onend?.() })
    expect(container.querySelector('button[aria-label="朗读"]')).not.toBeNull()
  })

  it('offers no read-aloud action for non-assistant messages', () => {
    installEngine()
    const { container } = render(<MessageIconActions text="hello" clock="start" t={t} />)
    expect(container.querySelector('button[aria-label="朗读"]')).toBeNull()
  })

  it('cancels an in-flight reading when the row unmounts', () => {
    const { cancel } = installEngine()
    const { container, unmount } = renderAssistant()
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    expect(cancel).toHaveBeenCalledTimes(1)
    unmount()
    expect(cancel).toHaveBeenCalledTimes(2)
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

interface RemoteHarness {
  remote: ReadAloudRemote
  unbind: () => void
  synthesize: ReturnType<typeof vi.fn>
}

function bindRemote(catalog: TtsCatalog | null, connected = true): RemoteHarness {
  const synthesize = vi.fn(async () => new Uint8Array([1, 2, 3]))
  const readiness = createSnapshotStore({ catalog, connected, error: null })
  const remote: ReadAloudRemote = { readiness, synthesize }
  return { remote, unbind: bindReadAloudRemote(remote), synthesize }
}

function catalogWith(phase: string, speed = 1): TtsCatalog {
  return {
    providers: [{ preparation: { phase } }],
    selection: { providerId: 'local', voiceId: 'zf_001', speed },
  } as unknown as TtsCatalog
}

describe('remote read-aloud path', () => {
  it('falls back to the browser engine without a bound remote', () => {
    const { speak } = installEngine()
    const { container } = renderAssistant()
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('falls back while no provider is prepared', () => {
    const { speak } = installEngine()
    const { unbind } = bindRemote(catalogWith('downloading'))
    const { container } = renderAssistant()
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    expect(speak).toHaveBeenCalledTimes(1)
    unbind()
  })

  it('plays through the remote path and toggles to stop', async () => {
    installEngine()
    installRemoteAudio()
    const { synthesize, unbind } = bindRemote(catalogWith('ready'))
    const { container } = renderAssistant()
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    await act(async () => {})
    expect(synthesize).toHaveBeenCalledWith('你好，世界', expect.any(AbortSignal))
    const context = remoteContext()
    expect(context.sources[0]!.start).toHaveBeenCalledTimes(1)
    expect(container.querySelector('button[aria-label="停止朗读"]')).not.toBeNull()
    fireEvent.click(container.querySelector('button[aria-label="停止朗读"]')!)
    expect(context.sources[0]!.stop).toHaveBeenCalledTimes(1)
    expect(container.querySelector('button[aria-label="朗读"]')).not.toBeNull()
    expect(context.close).toHaveBeenCalled()
    unbind()
  })

  it('falls back to the browser engine when synthesis fails', async () => {
    const { speak } = installEngine()
    installRemoteAudio()
    const { synthesize, unbind } = bindRemote(catalogWith('ready'))
    synthesize.mockRejectedValue(new Error('synthesis failed'))
    const { container } = renderAssistant()
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    await act(async () => {})
    expect(speak).toHaveBeenCalledTimes(1)
    // The engine owns the reading now; completing it returns the row to idle.
    const utterance = speak.mock.calls[0]![0] as InstanceType<typeof FakeUtterance>
    act(() => { utterance.onend?.() })
    expect(container.querySelector('button[aria-label="朗读"]')).not.toBeNull()
    unbind()
  })

  it('cancels the remote reading when the row unmounts', async () => {
    installEngine()
    installRemoteAudio()
    const { unbind } = bindRemote(catalogWith('ready'))
    const { container, unmount } = renderAssistant()
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    await act(async () => {})
    const context = remoteContext()
    unmount()
    expect(context.sources[0]!.stop).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalled()
    unbind()
  })
})

describe('browser engine choice', () => {
  it('reads through the browser engine while the browser engine is selected', () => {
    const { speak } = installEngine()
    installRemoteAudio()
    const { synthesize, unbind } = bindRemote(catalogWith('ready'))
    readAloudEngine.set('browser')
    const { container } = renderAssistant()
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    expect(speak).toHaveBeenCalledTimes(1)
    expect(synthesize).not.toHaveBeenCalled()
    unbind()
  })

  it('applies the accepted reading speed to the browser engine', () => {
    const { speak } = installEngine()
    const { unbind } = bindRemote(catalogWith('ready', 1.5))
    readAloudEngine.set('browser')
    const { container } = renderAssistant()
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    expect((speak.mock.calls[0]![0] as InstanceType<typeof FakeUtterance>).rate).toBe(1.5)
    unbind()
  })
})

describe('splitSentences', () => {
  it('returns no sentences for blank text', () => {
    expect(splitSentences('  \n ')).toEqual([])
  })

  it('keeps one sentence without end marks intact', () => {
    expect(splitSentences('你好，世界')).toEqual(['你好，世界'])
  })

  it('cuts at sentence marks and keeps the mark attached', () => {
    expect(splitSentences('第一句。第二句！第三句？')).toEqual(['第一句。', '第二句！', '第三句？'])
  })

  it('cuts an overlong sentence at clause marks', () => {
    const first = '甲'.repeat(80)
    const second = '乙'.repeat(80)
    expect(splitSentences(`${first}，${second}`)).toEqual([`${first}，`, second])
  })

  it('hard-cuts an overlong clause so every piece fits one synthesis call', () => {
    const sentence = '丙'.repeat(300)
    const pieces = splitSentences(sentence)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.every(piece => piece.length <= 120)).toBe(true)
    expect(pieces.join('')).toBe(sentence)
  })
})

describe('remote read-aloud sentence pipeline', () => {
  it('starts playback after the first sentence while the next synthesizes', async () => {
    installEngine()
    installRemoteAudio()
    const { synthesize, unbind } = bindRemote(catalogWith('ready'))
    const { container } = renderAssistant('第一句。第二句。')
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    await act(async () => {})
    // The first sentence plays as soon as it is ready; the next one is already in flight.
    expect(synthesize).toHaveBeenCalledTimes(2)
    expect(synthesize).toHaveBeenNthCalledWith(1, '第一句。', expect.any(AbortSignal))
    expect(synthesize).toHaveBeenNthCalledWith(2, '第二句。', expect.any(AbortSignal))
    const context = remoteContext()
    expect(context.sources).toHaveLength(1)
    expect(context.sources[0]!.start).toHaveBeenCalledTimes(1)
    await act(async () => { context.sources[0]!.onended?.() })
    expect(context.sources).toHaveLength(2)
    await act(async () => { context.sources[1]!.onended?.() })
    expect(container.querySelector('button[aria-label="朗读"]')).not.toBeNull()
    expect(context.close).toHaveBeenCalled()
    unbind()
  })

  it('stops the reading quietly when a later sentence fails', async () => {
    const { speak } = installEngine()
    installRemoteAudio()
    const { synthesize, unbind } = bindRemote(catalogWith('ready'))
    synthesize
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockRejectedValueOnce(new Error('synthesis failed'))
    const { container } = renderAssistant('第一句。第二句。')
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    await act(async () => {})
    const context = remoteContext()
    expect(context.sources).toHaveLength(1)
    await act(async () => { context.sources[0]!.onended?.() })
    // The later failure ends the reading quietly: no fallback re-read, straight back to idle.
    expect(speak).not.toHaveBeenCalled()
    expect(context.sources).toHaveLength(1)
    expect(container.querySelector('button[aria-label="朗读"]')).not.toBeNull()
    expect(context.close).toHaveBeenCalled()
    unbind()
  })

  it('leaves later sentences unplayed when the reading is cancelled', async () => {
    installEngine()
    installRemoteAudio()
    const { unbind } = bindRemote(catalogWith('ready'))
    const { container } = renderAssistant('第一句。第二句。')
    fireEvent.click(container.querySelector('button[aria-label="朗读"]')!)
    await act(async () => {})
    const context = remoteContext()
    fireEvent.click(container.querySelector('button[aria-label="停止朗读"]')!)
    expect(context.sources[0]!.stop).toHaveBeenCalledTimes(1)
    await act(async () => {})
    expect(context.sources).toHaveLength(1)
    expect(context.close).toHaveBeenCalled()
    expect(container.querySelector('button[aria-label="朗读"]')).not.toBeNull()
    unbind()
  })
})
