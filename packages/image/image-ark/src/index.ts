/**
 * Volcengine Ark (Seedream) generation provider for `ctx.image`. One plugin
 * instance posts image-generation tasks to the Ark `/images/generations`
 * endpoint over Bearer ARK API-key auth — a plain prompt-to-image generation
 * by default, or a layer decomposition when configured — downloads every
 * answered image URL, and maps a decomposed answer onto the seam's layer
 * vocabulary. The credential is read from an environment variable named by
 * `authEnv` at call time and never stored. Endpoint failures surface as typed
 * `IMAGE_PROVIDER_FAILED` errors the caller reports — there is no local
 * fallback generation. Registration with the seam is effect-scoped: disposal
 * unregisters it.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-image-ark
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ImageProvider } from '@deepseek-ai/dsh-image'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { ARK_DEFAULT_BASE_URL, createArkImageGenerator, type ArkImageGenerator } from './generate.ts'

export {
  ARK_DEFAULT_BASE_URL,
  ARK_DEFAULT_MODEL,
  ARK_IMAGES_GENERATIONS_PATH,
  createArkImageGenerator,
} from './generate.ts'
export type { ArkImageGenerationConfig, ArkImageGenerator } from './generate.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'image-ark'

/** Services required by this plugin. */
export const inject = ['image']

/** Default per-request timeout (ms) covering submission and every download. */
export const IMAGE_ARK_DEFAULT_TIMEOUT_MS = 120_000

/** Provider configuration: the endpoint, its model, the credential variable name, and the decomposition switch. */
export interface Config {
  /** Ark inference base URL. Defaults to the public plane. */
  arkBaseURL?: string
  /** Ark model identifier. Defaults to `doubao-seedream-5-0-pro-260628`. */
  model?: string
  /** Name of the environment variable holding the ARK API key; never the key itself. */
  authEnv: string
  /** Ask the endpoint to decompose the generation into layers. Defaults to false. */
  layerDecomposition?: boolean
  /** Output format requested from the endpoint (`png` or `jpeg`); omitted values leave the field out. */
  outputFormat?: 'png' | 'jpeg'
  /** Per-request timeout covering submission and every download in milliseconds. Defaults to 120000. */
  timeoutMs?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  arkBaseURL: z.string(),
  model: z.string(),
  authEnv: z.string().required(),
  layerDecomposition: z.boolean(),
  outputFormat: z.union(['png', 'jpeg']),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(IMAGE_ARK_DEFAULT_TIMEOUT_MS),
})

/**
 * Register the Volcengine Ark generation provider on `ctx.image`.
 * @param ctx - the plugin context (must inject `image`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const generator: ArkImageGenerator = createArkImageGenerator({
    arkBaseURL: config.arkBaseURL ?? ARK_DEFAULT_BASE_URL,
    ...config.model === undefined ? {} : { model: config.model },
    authEnv: config.authEnv,
    ...config.layerDecomposition === undefined ? {} : { layerDecomposition: config.layerDecomposition },
    ...config.outputFormat === undefined ? {} : { outputFormat: config.outputFormat },
    ...config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs },
  })
  const provider: ImageProvider = {
    id: 'image-ark',
    generate: (request, signal) => generator(request, signal),
  }
  ctx.image.registerProvider(provider)
}
