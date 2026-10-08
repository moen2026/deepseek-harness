/**
 * DingTalk callback adapter for the connector seam. One plugin instance
 * registers one exact callback route on the injected WebServer and one
 * DingTalk provider on `ctx.connector`. The route verifies every callback
 * (timestamped `sign`), remembers the reply session webhook a text message
 * arrives with, and admits messages through `ctx.connector.deliver()`; the
 * provider replies in text through the remembered session webhook. Both
 * registrations are effect-scoped: disposal unregisters them.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-connector-dingtalk
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-connector'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createDingtalkClient } from './client.ts'
import { createDingtalkCallbackHandler } from './handler.ts'
import { DINGTALK_PROVIDER_ID } from './types.ts'

export { DingtalkError, DINGTALK_PROVIDER_ID } from './types.ts'
export type { DingtalkErrorCode } from './types.ts'

/** Cordis function-plugin name. */
export const name = 'connector-dingtalk'

/** Host services required before the route and provider can register. */
export const inject = ['webServer', 'connector', 'credentials']

/** Default per-request outbound timeout (ms). */
export const CONNECTOR_DINGTALK_DEFAULT_TIMEOUT_MS = 10_000

/** Required DingTalk adapter configuration. */
export interface Config {
  /** Exact absolute callback route path, such as `/dingtalk`. */
  readonly path: string
  /** Credential reference containing the DingTalk app secret. */
  readonly appSecretEnv: string
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
  /** Per-request outbound timeout in milliseconds. Defaults to 10000. */
  readonly timeoutMs?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  appSecretEnv: z.string().role('credential-ref').required(),
  maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  timeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(CONNECTOR_DINGTALK_DEFAULT_TIMEOUT_MS),
})

/** Validate route facts that Schemastery cannot express. */
function assertConfig(config: Config): void {
  if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/')
    || config.path.includes('?') || config.path.includes('#')) {
    throw new Error('connector-dingtalk path must be an absolute non-root pathname without a trailing slash, query, or fragment')
  }
}

/**
 * Register the callback route and the DingTalk provider on `ctx.connector`.
 * @param ctx - the plugin context (must inject `webServer`, `connector`, and `credentials`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertConfig(config)
  const client = createDingtalkClient({ timeoutMs: config.timeoutMs ?? CONNECTOR_DINGTALK_DEFAULT_TIMEOUT_MS })
  const route: WebRoute = {
    kind: 'exact',
    path: config.path,
    handler: createDingtalkCallbackHandler(ctx, client, {
      appSecretRef: credentialRef(config.appSecretEnv),
      maxBodyBytes: config.maxBodyBytes,
    }),
  }
  ctx.effect(() => ctx.webServer.register(route), `connector-dingtalk: ${config.path}`)
  ctx.effect(
    () => ctx.connector.registerProvider({
      id: DINGTALK_PROVIDER_ID,
      push: (channel, message, signal) => client.push(channel, message, signal),
    }),
    'connector-dingtalk: provider',
  )
}
