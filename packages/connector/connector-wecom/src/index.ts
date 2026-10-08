/**
 * WeCom callback adapter for the connector seam. One plugin instance
 * registers one exact callback route on the injected WebServer and one WeCom
 * provider on `ctx.connector`. The route verifies every callback
 * (`msg_signature` over the encrypted payload), decrypts the platform's
 * AES-256-CBC envelope, answers the URL-verification echo, and admits text
 * messages and template-card button clicks through `ctx.connector.deliver()`;
 * the provider pushes outbound messages through the WeCom API as text or a
 * template card of buttons. Both registrations are effect-scoped: disposal
 * unregisters them.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-connector-wecom
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-connector'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createWecomClient } from './client.ts'
import { createWecomCallbackHandler } from './handler.ts'
import { WECOM_PROVIDER_ID } from './types.ts'

export { WecomError, WECOM_PROVIDER_ID } from './types.ts'
export type { WecomErrorCode } from './types.ts'

/** Cordis function-plugin name. */
export const name = 'connector-wecom'

/** Host services required before the route and provider can register. */
export const inject = ['webServer', 'connector', 'credentials']

/** Default per-request outbound timeout (ms). */
export const CONNECTOR_WECOM_DEFAULT_TIMEOUT_MS = 10_000

/** Required WeCom adapter configuration. */
export interface Config {
  /** Exact absolute callback route path, such as `/wecom`. */
  readonly path: string
  /** Credential reference containing the callback verification token. */
  readonly callbackTokenEnv: string
  /** Credential reference containing the 43-character encoding AES key. */
  readonly encodingAesKeyEnv: string
  /** Credential reference containing the corp id the envelope must carry. */
  readonly corpIdEnv: string
  /** Credential reference containing the app secret used to exchange access tokens. */
  readonly corpSecretEnv: string
  /** Agent id every outbound message posts as. */
  readonly agentId: number
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
  /** Per-request outbound timeout in milliseconds. Defaults to 10000. */
  readonly timeoutMs?: number
  /** API origin override, such as a proxy; defaults to `https://qyapi.weixin.qq.com`. */
  readonly apiBaseUrl?: string
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  callbackTokenEnv: z.string().role('credential-ref').required(),
  encodingAesKeyEnv: z.string().role('credential-ref').required(),
  corpIdEnv: z.string().role('credential-ref').required(),
  corpSecretEnv: z.string().role('credential-ref').required(),
  agentId: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  timeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(CONNECTOR_WECOM_DEFAULT_TIMEOUT_MS),
  apiBaseUrl: z.string(),
})

/** Validate route and origin facts that Schemastery cannot express. */
function assertConfig(config: Config): void {
  if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/')
    || config.path.includes('?') || config.path.includes('#')) {
    throw new Error('connector-wecom path must be an absolute non-root pathname without a trailing slash, query, or fragment')
  }
  if (config.apiBaseUrl !== undefined) {
    let origin: URL
    try {
      origin = new URL(config.apiBaseUrl)
    } catch {
      throw new Error('connector-wecom apiBaseUrl must be an absolute URL')
    }
    if (origin.protocol !== 'https:' || origin.search !== '' || origin.hash !== '') {
      throw new Error('connector-wecom apiBaseUrl must be an https URL without query or fragment')
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
  return (config.apiBaseUrl ?? 'https://qyapi.weixin.qq.com').replace(/\/+$/, '')
}

/**
 * Register the callback route and the WeCom provider on `ctx.connector`.
 * @param ctx - the plugin context (must inject `webServer`, `connector`, and `credentials`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertConfig(config)
  const client = createWecomClient(ctx, {
    apiBaseUrl: resolveApiBaseUrl(config),
    corpIdRef: credentialRef(config.corpIdEnv),
    corpSecretRef: credentialRef(config.corpSecretEnv),
    agentId: config.agentId,
    timeoutMs: config.timeoutMs ?? CONNECTOR_WECOM_DEFAULT_TIMEOUT_MS,
  })
  const route: WebRoute = {
    kind: 'exact',
    path: config.path,
    handler: createWecomCallbackHandler(ctx, {
      callbackTokenRef: credentialRef(config.callbackTokenEnv),
      encodingAesKeyRef: credentialRef(config.encodingAesKeyEnv),
      corpIdRef: credentialRef(config.corpIdEnv),
      maxBodyBytes: config.maxBodyBytes,
    }),
  }
  ctx.effect(() => ctx.webServer.register(route), `connector-wecom: ${config.path}`)
  ctx.effect(
    () => ctx.connector.registerProvider({
      id: WECOM_PROVIDER_ID,
      push: (channel, message, signal) => client.push(channel, message, signal),
    }),
    'connector-wecom: provider',
  )
}
