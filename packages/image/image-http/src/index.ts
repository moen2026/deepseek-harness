/**
 * HTTP generation provider for `ctx.image`. One plugin instance is configured with an
 * OpenAI-compatible `/images/generations` endpoint and posts the text prompt as JSON,
 * requesting base64 answers. The credential is read from an environment variable named
 * by `authEnv` at call time and never stored. Endpoint failures surface as typed
 * `IMAGE_PROVIDER_FAILED` errors the caller reports — there is no local fallback
 * generation. Registration with the seam is effect-scoped: disposal unregisters it.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-image-http
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ImageProvider } from '@deepseek-ai/dsh-image'
import { createHttpGenerator, type HttpGenerator } from './generate.ts'

export { createHttpGenerator, type HttpGenerationConfig, type HttpGenerator } from './generate.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'image-http'

/** Services required by this plugin. */
export const inject = ['image']

/** Default per-request timeout (ms) for one generation round trip. */
export const IMAGE_HTTP_DEFAULT_TIMEOUT_MS = 120_000

/** Provider configuration: the endpoint, its model, and the credential variable name. */
export interface Config {
  /** Full generation endpoint URL (an OpenAI-compatible `/images/generations` shape). */
  url: string
  /** Model name sent to the endpoint. */
  model: string
  /** Name of the environment variable holding the bearer token; never the token itself. */
  authEnv: string
  /** Per-request timeout in milliseconds. Defaults to 120000. */
  timeoutMs?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  url: z.string().required(),
  model: z.string().required(),
  authEnv: z.string().required(),
  timeoutMs: z.number().step(1).min(1).default(IMAGE_HTTP_DEFAULT_TIMEOUT_MS),
})

/**
 * Register the HTTP generation provider on `ctx.image`.
 * @param ctx - the plugin context (must inject `image`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const generator: HttpGenerator = createHttpGenerator({
    url: config.url,
    model: config.model,
    authEnv: config.authEnv,
    ...config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs },
  })
  const provider: ImageProvider = {
    id: 'image-http',
    generate: (request, signal) => generator(request, signal),
  }
  ctx.image.registerProvider(provider)
}
