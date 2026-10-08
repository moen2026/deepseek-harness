/**
 * HTTP transcription provider for `ctx.audio`. One plugin instance is configured with an
 * OpenAI-compatible `/audio/transcriptions` endpoint and uploads raw audio bytes as
 * `multipart/form-data`. The credential is read from an environment variable named by
 * `authEnv` at call time and never stored. Endpoint failures surface as typed
 * `AUDIO_PROVIDER_FAILED` errors the caller reports — there is no local fallback
 * transcription. Registration with the seam is effect-scoped: disposal unregisters it.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-audio-http
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AudioProvider } from '@deepseek-ai/dsh-audio'
import { createHttpTranscriber, type HttpTranscriber } from './transcribe.ts'

export { createHttpTranscriber, uploadMediaType, type HttpTranscriber, type HttpTranscriptionConfig } from './transcribe.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'audio-http'

/** Services required by this plugin. */
export const inject = ['audio']

/** Default per-request timeout (ms) for one transcription round trip. */
export const AUDIO_HTTP_DEFAULT_TIMEOUT_MS = 60_000

/** Provider configuration: the endpoint, its model, and the credential variable name. */
export interface Config {
  /** Full transcription endpoint URL (an OpenAI-compatible `/audio/transcriptions` shape). */
  url: string
  /** Model name sent to the endpoint. */
  model: string
  /** Name of the environment variable holding the bearer token; never the token itself. */
  authEnv: string
  /** Per-request timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  url: z.string().required(),
  model: z.string().required(),
  authEnv: z.string().required(),
  timeoutMs: z.number().step(1).min(1).default(AUDIO_HTTP_DEFAULT_TIMEOUT_MS),
})

/**
 * Register the HTTP transcription provider on `ctx.audio`.
 * @param ctx - the plugin context (must inject `audio`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const transcriber: HttpTranscriber = createHttpTranscriber({
    url: config.url,
    model: config.model,
    authEnv: config.authEnv,
    ...config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs },
  })
  const provider: AudioProvider = {
    id: 'audio-http',
    transcribe: (request, signal) => transcriber(request, signal),
  }
  ctx.audio.registerProvider(provider)
}
