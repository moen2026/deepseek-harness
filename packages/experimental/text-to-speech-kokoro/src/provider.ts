/** One serial Kokoro worker with request-owned cancellation and idle reclamation. */
import type { Context } from '@deepseek-ai/cordis'
import { ManagedSpeechWorker, readBufferReply } from '@deepseek-ai/dsh-experimental-local-speech-runtime'
import type { Config } from './config.ts'
import { inspectRuntime, prepareRuntime, type RuntimePaths } from './runtime.ts'
import { wavSampleRate } from './inference.ts'

/** One bounded synthesis call routed to the private worker. */
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

/** Own one worker across synthesis calls, and join every accepted job on disposal. */
export class KokoroWorker extends ManagedSpeechWorker<Config, RuntimePaths, SynthesisCall, SynthesisResult> {
  constructor(ctx: Context, config: Config) {
    super(ctx, config, {
      stepKinds: config.modelDirectory === undefined ? ['check', 'model', 'verify', 'load'] : ['check', 'verify', 'load'],
      downloadSources: config.modelDirectory === undefined
        ? [...new Set(config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin])]
        : [],
      disposeMessage: 'Kokoro provider disposed',
      runtime: {
        inspect: (_ctx, config, signal) => inspectRuntime(config, signal),
        prepare: (ctx, config, signal, report) => prepareRuntime(ctx, config, signal, report),
      },
      call: async (worker, input, config, signal) => {
        const response = await fetch(`${worker.url}/synthesize`, {
          method: 'POST', headers: { authorization: `Bearer ${worker.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ text: input.text, voiceId: input.voiceId, speed: input.speed }), signal,
        })
        const audio = await readBufferReply(response, config.maxAudioBytes)
        return { audio, sampleRate: wavSampleRate(audio) }
      },
    })
  }

  /**
   * Queue one bounded synthesis; cancellation never leaves inference running after settlement.
   * Verified resources accept calls while the worker wakes; other preparation states reject without downloading.
   * @param input - text, voice, and rate.
   * @param signal - caller cancellation.
   * @returns synthesized WAV audio; cancelled waiting jobs never acquire the worker.
   */
  async synthesize(input: SynthesisCall, signal: AbortSignal): Promise<SynthesisResult> {
    return await this.call(input, signal)
  }
}
