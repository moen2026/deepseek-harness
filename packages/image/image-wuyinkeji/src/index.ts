/**
 * Wuyinkeji-backed generation provider for `ctx.image`. One plugin instance
 * selects one public async image task endpoint, its ratio vocabulary, and its
 * reference-image policy through `model` (GPT-Image-2.5 or NanoBanana2Lite),
 * then submits the text prompt (plus reference-image URLs on NanoBanana2Lite)
 * as JSON. The credential is read from an environment variable named
 * by `authEnv` at call time and never stored. Endpoint failures surface as
 * typed `IMAGE_PROVIDER_FAILED` errors the caller reports — there is no local
 * fallback generation. Registration with the seam is effect-scoped: disposal
 * unregisters it.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-image-wuyinkeji
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ImageProvider } from '@deepseek-ai/dsh-image'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  createWuyinkejiGenerator,
  WUYINKEJI_DEFAULT_BASE_URL,
  WUYINKEJI_MODELS,
  type WuyinkejiGenerator,
  type WuyinkejiModel,
} from './generate.ts'

export {
  createWuyinkejiGenerator,
  WUYINKEJI_DEFAULT_BASE_URL,
  WUYINKEJI_MODELS,
} from './generate.ts'
export type {
  WuyinkejiGenerationConfig,
  WuyinkejiGenerator,
  WuyinkejiModel,
} from './generate.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'image-wuyinkeji'

/** Services required by this plugin. */
export const inject = ['image']

/** Default delay (ms) between result-detail polls of one generation task. */
export const IMAGE_WUYINKEJI_DEFAULT_POLL_INTERVAL_MS = 3_000

/**
 * Default overall timeout (ms) covering submission, polling, and download.
 * Elapses inside the stock tool-call budget, so a slow generation surfaces
 * this typed timeout before a generic tool deadline preempts it.
 */
export const IMAGE_WUYINKEJI_DEFAULT_TIMEOUT_MS = 120_000

/** Default generation model, used when the configuration names none. */
export const IMAGE_WUYINKEJI_DEFAULT_MODEL = 'gpt-image-2.5'

/** Provider configuration: the endpoint base, the credential variable name, and the timing knobs. */
export interface Config {
  /** Endpoint base URL; the submit and detail paths are appended. Defaults to the public API. */
  baseURL?: string
  /** Model selecting the submission endpoint, ratio vocabulary, and reference-image forwarding. Defaults to `gpt-image-2.5`. */
  model?: WuyinkejiModel
  /** Name of the environment variable holding the API key; never the key itself. */
  authEnv: string
  /**
   * Aspect ratio sent when a request carries no `size`, expressed in the selected
   * model's vocabulary (for example `1024*1024`); omitted = endpoint default.
   */
  aspectRatio?: string
  /** Delay between result-detail polls in milliseconds. Defaults to 3000. */
  pollIntervalMs?: number
  /** Overall timeout covering submission, polling, and download in milliseconds. Defaults to 120000. */
  timeoutMs?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  baseURL: z.string(),
  model: z.union([...WUYINKEJI_MODELS]).default(IMAGE_WUYINKEJI_DEFAULT_MODEL),
  authEnv: z.string().required(),
  aspectRatio: z.string(),
  pollIntervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(IMAGE_WUYINKEJI_DEFAULT_POLL_INTERVAL_MS),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(IMAGE_WUYINKEJI_DEFAULT_TIMEOUT_MS),
})

/**
 * Register the Wuyinkeji generation provider on `ctx.image`.
 * @param ctx - the plugin context (must inject `image`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const generator: WuyinkejiGenerator = createWuyinkejiGenerator({
    baseURL: config.baseURL ?? WUYINKEJI_DEFAULT_BASE_URL,
    ...config.model === undefined ? {} : { model: config.model },
    authEnv: config.authEnv,
    ...config.aspectRatio === undefined ? {} : { aspectRatio: config.aspectRatio },
    ...config.pollIntervalMs === undefined ? {} : { pollIntervalMs: config.pollIntervalMs },
    ...config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs },
  })
  const provider: ImageProvider = {
    id: 'image-wuyinkeji',
    generate: (request, signal) => generator(request, signal),
  }
  ctx.image.registerProvider(provider)
}
