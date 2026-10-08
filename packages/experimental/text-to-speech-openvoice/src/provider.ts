/** One HTTP client for the externally managed OpenVoice v2 voice-cloning service. */
import z from 'zod'
import type { Config } from './config.ts'

/** One bounded synthesis call routed to the service. */
export interface SynthesisCall {
  readonly text: string
  readonly voiceId: string
  readonly speed: number
}

/** One complete WAV synthesis result. */
export interface SynthesisResult {
  readonly audio: Uint8Array
  readonly sampleRate: number
}

/** One recorded reference offered to the service as the audio behind a cloned-voice id. */
export interface ReferenceUpload {
  readonly voiceId: string
  readonly audio: Uint8Array
}

/** Service readiness payload; the roster lists cloned-voice ids by reference-audio file stem. */
const healthSchema = z.object({ ok: z.boolean(), voices: z.array(z.string()) })

/** Sample rate of a complete PCM WAV container, read from its canonical header. */
function wavSampleRate(audio: Uint8Array): number {
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength)
  return view.getUint32(24, true)
}

/** Own the service origin, request budgets, and cloned-voice roster discovery. */
export class OpenVoiceClient {
  constructor(private readonly config: Config) {}

  /**
   * Read the cloned-voice roster published by the service.
   * @returns cloned-voice ids; the service derives each from a reference-audio file stem.
   */
  async voices(): Promise<readonly string[]> {
    const response = await fetch(`${this.config.serviceOrigin}/health`,
      { signal: AbortSignal.timeout(this.config.healthTimeoutMs) })
    if (!response.ok) throw new Error(`OpenVoice service health check failed: HTTP ${response.status}`)
    return healthSchema.parse(await response.json()).voices
  }

  /**
   * Synthesize one text in a cloned voice.
   * @param call - text, cloned voice, and rate.
   * @param signal - caller cancellation.
   * @returns complete WAV audio and its sample rate.
   */
  async synthesize(call: SynthesisCall, signal: AbortSignal): Promise<SynthesisResult> {
    if (call.text.length < 1 || call.text.length > this.config.maxTextChars) {
      throw new Error(`OpenVoice synthesis text must be 1..${this.config.maxTextChars} characters`)
    }
    const response = await fetch(`${this.config.serviceOrigin}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: call.text, voice: call.voiceId, speed: call.speed }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)]),
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenVoice synthesis failed: HTTP ${response.status} ${body.slice(0, 200)}`.trimEnd())
    }
    const audio = new Uint8Array(await response.arrayBuffer())
    if (audio.length > this.config.maxAudioBytes) throw new Error(`OpenVoice synthesis exceeded ${this.config.maxAudioBytes} bytes`)
    if (audio.length < 44) throw new Error('OpenVoice synthesis returned a truncated WAV container')
    return { audio, sampleRate: wavSampleRate(audio) }
  }

  /**
   * Store one recorded reference under its cloned-voice id.
   * @param call - cloned-voice id and the complete recording bytes.
   * @param signal - caller cancellation.
   */
  async uploadReference(call: ReferenceUpload, signal: AbortSignal): Promise<void> {
    if (call.audio.length === 0 || call.audio.length > this.config.maxReferenceBytes) {
      throw new Error(`OpenVoice reference recording must be 1..${this.config.maxReferenceBytes} bytes`)
    }
    const response = await fetch(
      `${this.config.serviceOrigin}/references?name=${encodeURIComponent(call.voiceId)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: call.audio as Uint8Array<ArrayBuffer>,
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)]),
      },
    )
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenVoice reference intake failed: HTTP ${response.status} ${body.slice(0, 200)}`.trimEnd())
    }
  }
}
