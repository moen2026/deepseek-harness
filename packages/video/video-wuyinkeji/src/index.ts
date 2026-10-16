/**
 * Wuyinkeji-backed generation provider for `ctx.video`. One plugin instance
 * selects one public async video task endpoint and its request-field mapping
 * through `model` (Google-Omni or MiniMax H3), then submits the text prompt
 * (plus optional size, duration, aspect-ratio, frame-conditioning, and
 * reference-media hints) as JSON. The credential is read from an environment variable named
 * by `authEnv` at call time and never stored. Endpoint failures surface as
 * typed `VIDEO_PROVIDER_FAILED` errors the caller reports — there is no local
 * fallback generation. Registration with the seam is effect-scoped: disposal
 * unregisters it.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-video-wuyinkeji
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { VideoProvider } from '@deepseek-ai/dsh-video'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  createWuyinkejiVideoGenerator,
  WUYINKEJI_DEFAULT_BASE_URL,
  WUYINKEJI_VIDEO_MODELS,
  type WuyinkejiVideoGenerator,
  type WuyinkejiVideoModel,
} from './generate.ts'

export {
  createWuyinkejiVideoGenerator,
  WUYINKEJI_DEFAULT_BASE_URL,
  WUYINKEJI_VIDEO_GOOGLE_OMNI_PATH,
  WUYINKEJI_VIDEO_MINIMAX_H3_PATH,
  WUYINKEJI_VIDEO_MODELS,
} from './generate.ts'
export type {
  WuyinkejiVideoGenerationConfig,
  WuyinkejiVideoGenerator,
  WuyinkejiVideoModel,
} from './generate.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'video-wuyinkeji'

/** Services required by this plugin. */
export const inject = ['video']

/** Default generation model, used when the configuration names none. */
export const VIDEO_WUYINKEJI_DEFAULT_MODEL: WuyinkejiVideoModel = 'google-omni'

/** Default delay (ms) between result-detail polls of one generation task. */
export const VIDEO_WUYINKEJI_DEFAULT_POLL_INTERVAL_MS = 10_000

/**
 * Default overall timeout (ms) covering submission, polling, and download.
 * Video generations take minutes, so the budget exceeds the image one; it
 * elapses inside the stock tool-call budget, so a slow generation surfaces
 * this typed timeout before a generic tool deadline preempts it.
 */
export const VIDEO_WUYINKEJI_DEFAULT_TIMEOUT_MS = 600_000

/** Provider configuration: the endpoint base, the model, the credential variable name, and the timing knobs. */
export interface Config {
  /** Endpoint base URL; the submit and detail paths are appended. Defaults to the public API. */
  baseURL?: string
  /** Model selecting the submission endpoint and request-field mapping. Defaults to `google-omni`. */
  model?: WuyinkejiVideoModel
  /** Name of the environment variable holding the API key; never the key itself. */
  authEnv: string
  /** Delay between result-detail polls in milliseconds. Defaults to 10000. */
  pollIntervalMs?: number
  /** Overall timeout covering submission, polling, and download in milliseconds. Defaults to 600000. */
  timeoutMs?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  baseURL: z.string(),
  model: z.union([...WUYINKEJI_VIDEO_MODELS]).default(VIDEO_WUYINKEJI_DEFAULT_MODEL),
  authEnv: z.string().required(),
  pollIntervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(VIDEO_WUYINKEJI_DEFAULT_POLL_INTERVAL_MS),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(VIDEO_WUYINKEJI_DEFAULT_TIMEOUT_MS),
})

/**
 * Register the Wuyinkeji generation provider on `ctx.video`.
 * @param ctx - the plugin context (must inject `video`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const generator: WuyinkejiVideoGenerator = createWuyinkejiVideoGenerator({
    baseURL: config.baseURL ?? WUYINKEJI_DEFAULT_BASE_URL,
    ...config.model === undefined ? {} : { model: config.model },
    authEnv: config.authEnv,
    ...config.pollIntervalMs === undefined ? {} : { pollIntervalMs: config.pollIntervalMs },
    ...config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs },
  })
  const provider: VideoProvider = {
    id: 'video-wuyinkeji',
    generate: (request, signal) => generator(request, signal),
  }
  ctx.video.registerProvider(provider)
}
