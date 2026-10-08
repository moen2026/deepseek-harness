/**
 * Telegram callback adapter for the connector seam. One plugin instance
 * registers one exact callback route on the injected WebServer and one
 * Telegram provider on `ctx.connector`. The route verifies every callback
 * (optional webhook secret token), admits text messages and inline-keyboard
 * callback queries through `ctx.connector.deliver()`, and best-effort
 * acknowledges each callback query; the provider pushes outbound messages by
 * posting text or an inline keyboard with the bot token. Both registrations
 * are effect-scoped: disposal unregisters them.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-connector-telegram
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-connector'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createTelegramClient } from './client.ts'
import { createTelegramCallbackHandler } from './handler.ts'
import { TELEGRAM_PROVIDER_ID } from './types.ts'

export { TelegramError, TELEGRAM_PROVIDER_ID } from './types.ts'
export type { TelegramErrorCode } from './types.ts'

/** Cordis function-plugin name. */
export const name = 'connector-telegram'

/** Host services required before the route and provider can register. */
export const inject = ['webServer', 'connector', 'credentials']

/** Default per-request outbound timeout (ms). */
export const CONNECTOR_TELEGRAM_DEFAULT_TIMEOUT_MS = 10_000

/** Required Telegram adapter configuration. */
export interface Config {
  /** Exact absolute callback route path, such as `/telegram`. */
  readonly path: string
  /** Credential reference containing the bot token. */
  readonly botTokenEnv: string
  /** Credential reference containing the webhook secret token; omit to accept every caller. */
  readonly webhookSecretEnv?: string
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
  /** Per-request outbound timeout in milliseconds. Defaults to 10000. */
  readonly timeoutMs?: number
  /** API origin override, such as a Bot API local server; defaults to `https://api.telegram.org`. */
  readonly apiBaseUrl?: string
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  botTokenEnv: z.string().role('credential-ref').required(),
  webhookSecretEnv: z.string().role('credential-ref'),
  maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  timeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(CONNECTOR_TELEGRAM_DEFAULT_TIMEOUT_MS),
  apiBaseUrl: z.string(),
})

/** Validate route and origin facts that Schemastery cannot express. */
function assertConfig(config: Config): void {
  if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/')
    || config.path.includes('?') || config.path.includes('#')) {
    throw new Error('connector-telegram path must be an absolute non-root pathname without a trailing slash, query, or fragment')
  }
  if (config.apiBaseUrl !== undefined) {
    let origin: URL
    try {
      origin = new URL(config.apiBaseUrl)
    } catch {
      throw new Error('connector-telegram apiBaseUrl must be an absolute URL')
    }
    if (origin.protocol !== 'https:' || origin.search !== '' || origin.hash !== '') {
      throw new Error('connector-telegram apiBaseUrl must be an https URL without query or fragment')
    }
  }
}

/**
 * Resolve the effective API origin. The explicit resolve step owns the
 * deployment default, so no request path hides one.
 * @param config - the validated plugin configuration.
 * @returns the API origin without trailing slashes.
 */
function resolveApiBaseUrl(config: Config): string {
  return (config.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '')
}

/**
 * Register the callback route and the Telegram provider on `ctx.connector`.
 * @param ctx - the plugin context (must inject `webServer`, `connector`, and `credentials`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertConfig(config)
  const client = createTelegramClient(ctx, {
    apiBaseUrl: resolveApiBaseUrl(config),
    botTokenRef: credentialRef(config.botTokenEnv),
    timeoutMs: config.timeoutMs ?? CONNECTOR_TELEGRAM_DEFAULT_TIMEOUT_MS,
  })
  const route: WebRoute = {
    kind: 'exact',
    path: config.path,
    handler: createTelegramCallbackHandler(ctx, client, {
      botTokenRef: credentialRef(config.botTokenEnv),
      ...config.webhookSecretEnv === undefined ? {} : { webhookSecretRef: credentialRef(config.webhookSecretEnv) },
      maxBodyBytes: config.maxBodyBytes,
    }),
  }
  ctx.effect(() => ctx.webServer.register(route), `connector-telegram: ${config.path}`)
  ctx.effect(
    () => ctx.connector.registerProvider({
      id: TELEGRAM_PROVIDER_ID,
      push: (channel, message, signal) => client.push(channel, message, signal),
    }),
    'connector-telegram: provider',
  )
}
