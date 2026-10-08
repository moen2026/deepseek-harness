/** Browser read-aloud support for the message action row: Web Speech fallback plus remote synthesis. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TtsReadiness } from './tts-readiness.ts'

/** Playback engine one reading uses: Host synthesis, or the browser's built-in voice. */
export type ReadAloudEngine = 'remote' | 'browser'

/**
 * Accepted playback engine, shared by the speech settings page and every
 * read-aloud row. Persisted locally: the engine is a client playback choice,
 * not a Host synthesis setting, so it never travels the wire.
 */
export const readAloudEngine = createSnapshotStore<ReadAloudEngine>(
  'remote',
  { persist: { name: 'dsh.chat.readAloudEngine' } },
)

/** Client-bound remote synthesis; absent until the Chat plugin mounts it. */
export interface ReadAloudRemote {
  /** Live Host readiness; the action reads it when a reading starts. */
  readonly readiness: SnapshotStore<TtsReadiness>
  /** Synthesize one bounded text into a complete WAV container. */
  synthesize(text: string, signal: AbortSignal): Promise<Uint8Array>
}

let remote: ReadAloudRemote | undefined

/**
 * Bind the Client-mounted synthesis runtime.
 * @param bound - readiness mirror and synthesizer owned by the Chat plugin.
 * @returns unbind disposer which never drops a later binding.
 */
export function bindReadAloudRemote(bound: ReadAloudRemote): () => void {
  remote = bound
  return () => { if (remote === bound) remote = undefined }
}

/**
 * Whether a connected, prepared provider can synthesize right now. Unprepared
 * or disconnected states keep the button on the browser engine path.
 * @returns true when remote read-aloud should take the next reading.
 */
export function remoteReadAloudReady(): boolean {
  const state = remote?.readiness.getSnapshot()
  if (state === undefined || !state.connected || state.catalog === null) return false
  return state.catalog.providers.some(provider =>
    provider.preparation.phase === 'ready' || provider.preparation.phase === 'standby')
}

/**
 * Whether the accepted preference routes every new reading through the
 * browser engine instead of Host synthesis.
 * @returns true while `browser` is the accepted engine.
 */
export function browserEngineSelected(): boolean {
  return readAloudEngine.getSnapshot() === 'browser'
}

/**
 * Whether the browser exposes a speech-synthesis engine.
 * @returns false on engines without Web Speech API, where the action stays hidden.
 */
export function readAloudSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * Speak one message's plain text after cancelling any in-flight reading; Chinese
 * text is tagged `zh-CN` so single-voice engines pick a matching voice, and the
 * accepted speed sets the pace.
 * @param text - plain message text to read.
 * @param onEnd - called once the reading completes, fails, or is cancelled.
 */
export function speakText(text: string, onEnd: () => void): void {
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  if (/[\u4e00-\u9fff]/.test(text)) utterance.lang = 'zh-CN'
  utterance.rate = acceptedSpeed()
  utterance.onend = onEnd
  utterance.onerror = onEnd
  synth.speak(utterance)
}

/**
 * Reading pace the Host selection holds, clamped to the accepted 0.5–2 range;
 * a deployment without a catalog reads at 1.
 * @returns the browser engine's utterance rate.
 */
function acceptedSpeed(): number {
  const speed = remote?.readiness.getSnapshot().catalog?.selection.speed
  return speed === undefined ? 1 : Math.min(2, Math.max(0.5, speed))
}

/** One synthesis piece ends at these marks; the mark stays with its sentence. */
const SENTENCE_BREAK = /(?<=[。！？；!?;\n])/
/** A sentence longer than this falls back to clause marks and then to a hard cut. */
const CLAUSE_BREAK = /(?<=[，、,：])/
/** One synthesis call stays under this many characters so playback starts sooner. */
const MAX_SENTENCE_CHARS = 120

/**
 * Cut one message into synthesis-sized sentences: sentence marks end a piece
 * and stay attached to it, and an overlong piece falls back to clause marks
 * and then to a hard length cut, so every piece fits one synthesis call.
 * @param text - plain message text to read.
 * @returns non-empty sentences in reading order.
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  for (const piece of text.split(SENTENCE_BREAK)) {
    const sentence = piece.trim()
    if (sentence === '') continue
    if (sentence.length <= MAX_SENTENCE_CHARS) { sentences.push(sentence); continue }
    for (const fragment of sentence.split(CLAUSE_BREAK)) {
      const clause = fragment.trim()
      for (let start = 0; start < clause.length; start += MAX_SENTENCE_CHARS) {
        const cut = clause.slice(start, start + MAX_SENTENCE_CHARS).trim()
        if (cut !== '') sentences.push(cut)
      }
    }
  }
  return sentences
}

/**
 * Speak one message through the remote synthesizer, sentence by sentence: the
 * first sentence plays as soon as it is synthesized, every later sentence
 * synthesizes while the previous one plays, and the Host receives sentence
 * requests in reading order because each starts only after the previous reply.
 * @param text - plain message text to read.
 * @param onEnd - called once playback completes or is cancelled, never on startup failure.
 * @returns cancel callback which stops playback and settles the reading.
 * @throws when no remote runtime is bound or the first sentence fails; callers fall back.
 */
export async function speakRemoteText(text: string, onEnd: () => void): Promise<() => void> {
  const bound = remote
  if (bound === undefined) throw new Error('Remote read-aloud is not connected')
  const sentences = splitSentences(text)
  const controller = new AbortController()
  const audioContext = new AudioContext()
  let settled = false
  let current: AudioBufferSourceNode | undefined
  let playbackEnded = Promise.resolve()
  const finish = (): void => {
    if (settled) return
    settled = true
    void audioContext.close()
    onEnd()
  }
  const cancel = (): void => {
    controller.abort(new Error('Read-aloud cancelled'))
    if (settled) return
    try { current?.stop() } catch { /* already stopped */ }
    finish()
  }
  if (sentences.length === 0) { finish(); return cancel }
  // Each sentence synthesizes once; a prefetch and its playback turn share the request.
  const requests = new Map<number, Promise<Uint8Array>>()
  const synthesizeAt = (index: number): Promise<Uint8Array> => {
    let request = requests.get(index)
    if (request === undefined) {
      const sentence = sentences[index]
      if (sentence === undefined) return Promise.reject(new Error('Read-aloud sentence index is out of range'))
      request = bound.synthesize(sentence, controller.signal)
      requests.set(index, request)
    }
    return request
  }
  const startAt = async (index: number): Promise<void> => {
    const wav = await synthesizeAt(index)
    if (index + 1 < sentences.length) void synthesizeAt(index + 1).catch(() => { /* the playback loop reports it */ })
    // decodeAudioData detaches its input, so each WAV arrives on a private copy.
    const buffer = await audioContext.decodeAudioData(new Uint8Array(wav).buffer)
    if (settled || controller.signal.aborted) return
    const source = audioContext.createBufferSource()
    current = source
    playbackEnded = new Promise<void>((resolve) => {
      source.onended = () => { if (current === source) current = undefined; resolve() }
    })
    source.buffer = buffer
    source.connect(audioContext.destination)
    source.start()
  }
  try {
    await startAt(0)
  } catch (error) {
    void audioContext.close()
    throw error
  }
  // Later sentences continue in the background; a failure there ends the
  // reading quietly instead of re-reading the whole message through fallback.
  const advance = async (): Promise<void> => {
    for (let played = 0; ; played += 1) {
      await playbackEnded
      if (settled || controller.signal.aborted) return
      if (played + 1 >= sentences.length) { finish(); return }
      try {
        await startAt(played + 1)
      } catch {
        finish()
        return
      }
    }
  }
  void advance()
  return cancel
}

/** Cancel the current reading; safe when nothing is speaking. */
export function stopSpeaking(): void {
  window.speechSynthesis.cancel()
}

/**
 * Speak one text through the browser engine, for callers that play previews or
 * readings without Host synthesis.
 * @param text - plain text to read.
 * @param onEnd - called once the reading completes, fails, or is cancelled.
 * @returns stop callback which cancels the reading and settles it.
 */
export function speakBrowserText(text: string, onEnd: () => void): () => void {
  if (!readAloudSupported()) {
    onEnd()
    return () => undefined
  }
  speakText(text, onEnd)
  return stopSpeaking
}
