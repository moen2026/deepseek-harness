/** Optional local Kokoro provider; activation performs no downloads or model loading. */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-text-to-speech'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { TtsProviderId, TtsVoiceInfo } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import { Config } from './config.ts'
import { KokoroWorker } from './provider.ts'
import { voiceCatalog } from './runtime.ts'

export { Config } from './config.ts'
export const name = 'experimental-text-to-speech-kokoro'
export const inject = ['textToSpeech', 'subprocess']

/** Display names for the verified Chinese voices; unnamed voices fall back to their id. */
const voiceNames: Record<string, string> = {
  zf_001: '晴岚', zf_073: '若溪', zm_009: '云舟', zm_010: '景澈',
}

/**
 * Register the local synthesizer and inspect disk caches without downloading or loading models.
 * @param ctx - Host registry and subprocess owner.
 * @param config - validated runtime configuration.
 */
export function apply(ctx: Context, config: Config): void {
  for (const path of [config.dataRoot, config.modelDirectory, config.espeakDataDir]) {
    if (path !== undefined && !isAbsolute(path)) throw new Error(`Kokoro paths must be absolute: ${path}`)
  }
  for (const url of config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]) new URL(url)
  const worker = new KokoroWorker(ctx, config)
  const estimatedBytes = 800_000_000
  const voices = Object.keys(voiceCatalog()).map((id): TtsVoiceInfo => ({ id, name: voiceNames[id] ?? id }))
  ctx.effect(() => {
    const unregister = ctx.textToSpeech.register({
      info: { id: config.providerId as TtsProviderId, name: 'Kokoro-82M (local)', location: 'host-local', voices,
        downloadSources: worker.downloadSources,
        setupEstimate: { recommendedDiskBytes: estimatedBytes, expectedMemoryBytes: 600_000_000,
          minimumMinutes: 2, maximumMinutes: 15 } },
      preparation: worker,
      synthesize: async (input, signal) => await worker.synthesize({
        text: input.text, voiceId: input.voiceId ?? config.voice, speed: input.speed ?? config.speed,
      }, signal),
    })
    worker.inspect()
    return async () => {
      const removing = unregister()
      await worker.dispose()
      await removing
    }
  })
}
