/**
 * Volcengine Ark (Seedance) generation provider for `ctx.video`. One plugin
 * instance submits video tasks to the Ark inference plane over Bearer ARK
 * API-key auth — chat-completions-shaped by default, or the content-generation
 * task family when the configured model speaks Seedance 2.5 — polls the task
 * until settlement, and downloads the settled video into raw bytes. When the
 * deployment also configures a control-plane AK/SK pair, every public
 * reference-image URL is first registered as a private Seedance asset and
 * referenced as `asset://`. All credentials are read from environment
 * variables named in the configuration at call time and never stored.
 * Endpoint failures surface as typed `VIDEO_PROVIDER_FAILED` errors the
 * caller reports — there is no local fallback generation. Registration with
 * the seam is effect-scoped: disposal unregisters it.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-video-volc
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { VideoProvider } from '@deepseek-ai/dsh-video'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  createVolcVideoGenerator,
  VOLC_DEFAULT_ARK_BASE_URL,
  type VolcVideoGenerator,
} from './generate.ts'
import { createVolcAssetClient, type VolcAssetClient } from './asset.ts'

export {
  ARK_CHAT_COMPLETIONS_PATH,
  ARK_CONTENT_GENERATION_TASKS_PATH,
  ARK_TASK_GET_PATH,
  createVolcVideoGenerator,
  VOLC_CONTENT_SIZES,
  VOLC_DEFAULT_ARK_BASE_URL,
  VOLC_DEFAULT_MODEL,
  VOLC_SIZES,
} from './generate.ts'
export { createVolcAssetClient, VOLC_ASSET_API_VERSION } from './asset.ts'
export type { VolcVideoGenerationConfig, VolcVideoGenerator } from './generate.ts'
export type { VolcAssetClient, VolcAssetClientConfig } from './asset.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'video-volc'

/** Services required by this plugin. */
export const inject = ['video']

/** Default delay (ms) between task polls of one generation or asset registration. */
export const VIDEO_VOLC_DEFAULT_POLL_INTERVAL_MS = 10_000

/**
 * Default overall timeout (ms) covering submission, polling, and download.
 * Video generations take minutes, so the budget exceeds the image one; it
 * elapses inside the stock tool-call budget, so a slow generation surfaces
 * this typed timeout before a generic tool deadline preempts it.
 */
export const VIDEO_VOLC_DEFAULT_TIMEOUT_MS = 600_000

/** Provider configuration: the endpoints, the credential variable names, and the timing knobs. */
export interface Config {
  /** Ark inference base URL. Defaults to the public plane. */
  arkBaseURL?: string
  /** Ark model identifier. Defaults to `seedance-2.0`. */
  model?: string
  /** Name of the environment variable holding the ARK API key; never the key itself. */
  authEnv: string
  /**
   * Name of the environment variable holding the Volcengine access key;
   * configure it together with `assetSecretEnv` to register public reference
   * images as private Seedance assets.
   */
  assetAuthEnv?: string
  /** Name of the environment variable holding the Volcengine secret key; see {@link Config.assetAuthEnv}. */
  assetSecretEnv?: string
  /** Project name the private assets are filed under. Defaults to `default`. */
  project?: string
  /** Asset group the private assets are filed into; omitted groups are created on first use. */
  assetGroupId?: string
  /** Control-plane base URL. Defaults to the public plane. */
  assetBaseURL?: string
  /** Signing region. Defaults to `cn-beijing`. */
  region?: string
  /** Delay between task or asset polls in milliseconds. Defaults to 10000. */
  pollIntervalMs?: number
  /** Overall timeout covering submission, polling, and download in milliseconds. Defaults to 600000. */
  timeoutMs?: number
  /**
   * Whether the content-generation family (Seedance 2.5 models) generates
   * native audio; omitted values leave the field out of the submission.
   */
  generateAudio?: boolean
  /**
   * Value submitted as `extra_body.omni_reference_task_type` for
   * content-generation submissions, for example `reference`; omitted values
   * leave the field out.
   */
  referenceTaskType?: string
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  arkBaseURL: z.string(),
  model: z.string(),
  authEnv: z.string().required(),
  assetAuthEnv: z.string(),
  assetSecretEnv: z.string(),
  project: z.string(),
  assetGroupId: z.string(),
  assetBaseURL: z.string(),
  region: z.string(),
  pollIntervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(VIDEO_VOLC_DEFAULT_POLL_INTERVAL_MS),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(VIDEO_VOLC_DEFAULT_TIMEOUT_MS),
  generateAudio: z.boolean(),
  referenceTaskType: z.string(),
})

/**
 * Register the Volcengine Ark generation provider on `ctx.video`.
 * @param ctx - the plugin context (must inject `video`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  if ((config.assetAuthEnv === undefined) !== (config.assetSecretEnv === undefined)) {
    throw new Error('video-volc: assetAuthEnv and assetSecretEnv must be configured together')
  }
  const assetClient: VolcAssetClient | undefined = config.assetAuthEnv === undefined || config.assetSecretEnv === undefined
    ? undefined
    : createVolcAssetClient({
      ...config.assetBaseURL === undefined ? {} : { assetBaseURL: config.assetBaseURL },
      ...config.region === undefined ? {} : { region: config.region },
      project: config.project ?? 'default',
      assetAuthEnv: config.assetAuthEnv,
      assetSecretEnv: config.assetSecretEnv,
      ...config.assetGroupId === undefined ? {} : { groupId: config.assetGroupId },
      pollIntervalMs: config.pollIntervalMs ?? VIDEO_VOLC_DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: config.timeoutMs ?? VIDEO_VOLC_DEFAULT_TIMEOUT_MS,
    })
  const generator: VolcVideoGenerator = createVolcVideoGenerator({
    arkBaseURL: config.arkBaseURL ?? VOLC_DEFAULT_ARK_BASE_URL,
    ...config.model === undefined ? {} : { model: config.model },
    authEnv: config.authEnv,
    project: config.project ?? 'default',
    ...config.generateAudio === undefined ? {} : { generateAudio: config.generateAudio },
    ...config.referenceTaskType === undefined ? {} : { referenceTaskType: config.referenceTaskType },
    ...config.pollIntervalMs === undefined ? {} : { pollIntervalMs: config.pollIntervalMs },
    ...config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs },
  })
  const provider: VideoProvider = {
    id: 'video-volc',
    generate: (request, signal) => {
      if (assetClient === undefined || request.referenceImage === undefined) return generator(request, signal)
      return assetClient.assetize(request.referenceImage, signal).then((referenceImage) => {
        return generator({ ...request, referenceImage }, signal)
      })
    },
  }
  ctx.video.registerProvider(provider)
}
