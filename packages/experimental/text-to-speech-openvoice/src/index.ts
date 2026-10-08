/** Local voice-cloning provider for an externally managed synthesis service, named by its display name. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-text-to-speech'
import type { TtsProviderId, TtsVoiceInfo } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import { Config } from './config.ts'
import { OpenVoiceClient } from './provider.ts'

export { Config } from './config.ts'
export const name = 'experimental-text-to-speech-openvoice'
export const inject = ['textToSpeech']

/** Recording container types the OpenVoice service accepts as reference audio. */
const ACCEPTED_RECORDING_TYPES = ['audio/wav', 'audio/flac'] as const

/**
 * Register the service-backed synthesizer and discover the cloned-voice roster.
 * @param ctx - Host registry.
 * @param config - validated service location and synthesis defaults.
 */
export function apply(ctx: Context, config: Config): void {
  new URL(config.serviceOrigin)
  const client = new OpenVoiceClient(config)
  let voices: readonly TtsVoiceInfo[] = []
  const refresh = (): Promise<void> => client.voices().then((roster) => {
    voices = roster.map(id => ({ id, name: id }))
    // Announce the fresh roster so readiness followers pick up a reference
    // recording dropped since the previous probe without a page reload.
    ctx.textToSpeech.catalogChanged()
  }).catch((error: unknown) => {
    // The service may start after the Host; a failed probe defers discovery to the next synthesis.
    ctx.logger.warn('OpenVoice voice roster probe failed', error)
  })
  void refresh()
  ctx.effect(() => {
    const unregister = ctx.textToSpeech.register({
      info: {
        id: config.providerId as TtsProviderId,
        name: config.displayName,
        location: 'host-local',
        get voices() { return voices },
        intake: { accept: ACCEPTED_RECORDING_TYPES, maxBytes: config.maxReferenceBytes },
      },
      intake: async (intake, signal) => {
        await client.uploadReference({ voiceId: intake.voiceId, audio: intake.audio }, signal)
        // Republish the roster so the stored recording becomes selectable without a reload.
        await refresh()
        return { id: intake.voiceId, name: intake.voiceId }
      },
      synthesize: async (input, signal) => {
        // Re-probe before synthesis so a reference audio dropped after Host start becomes selectable.
        await refresh()
        return await client.synthesize({
          text: input.text, voiceId: input.voiceId ?? config.voice, speed: input.speed ?? config.speed,
        }, signal)
      },
    })
    return async () => { await unregister() }
  })
}
