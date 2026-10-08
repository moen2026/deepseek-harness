/**
 * Feishu (Lark) callback adapter for the connector seam. One plugin instance
 * registers one exact callback route on the injected WebServer and one Feishu
 * provider on `ctx.connector`. The route verifies every callback (encrypt-key
 * signature or verification token), answers the URL-verification challenge,
 * and admits text messages through `ctx.connector.deliver()`; the provider
 * pushes outbound messages by minting a tenant access token and posting text
 * to the addressed chat. Both registrations are effect-scoped: disposal
 * unregisters them.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-connector-feishu
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-connector'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createFeishuClient } from './client.ts'
import { createFeishuCallbackHandler } from './handler.ts'
import { FEISHU_PROVIDER_ID } from './types.ts'

export { FeishuError, FEISHU_PROVIDER_ID } from './types.ts'
export type { FeishuErrorCode } from './types.ts'

/** Cordis function-plugin name. */
export const name = 'connector-feishu'

/** Host services required before the route and provider can register. */
export const inject = ['webServer', 'connector', 'credentials']

/** Default per-request outbound timeout (ms). */
export const CONNECTOR_FEISHU_DEFAULT_TIMEOUT_MS = 10_000

/** Required Feishu adapter configuration. */
export interface Config {
  /** Exact absolute callback route path, such as `/feishu`. */
  readonly path: string
  /** Feishu app id (public); sent with the tenant token request. */
  readonly appId: string
  /** Credential reference containing the Feishu app secret. */
  readonly appSecretEnv: string
  /** Credential reference containing the event verification token. */
  readonly verificationTokenEnv: string
  /** Credential reference containing the event encrypt key; omit for plaintext callbacks only. */
  readonly encryptKeyEnv?: string
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
  /** Per-request outbound timeout in milliseconds. Defaults to 10000. */
  readonly timeoutMs?: number
  /** API origin override for Lark, such as `https://open.larksuite.com`; defaults to `https://open.feishu.cn`. */
  readonly apiBaseUrl?: string
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  appId: z.string().required(),
  appSecretEnv: z.string().role('credential-ref').required(),
  verificationTokenEnv: z.string().role('credential-ref').required(),
  encryptKeyEnv: z.string().role('credential-ref'),
  maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  timeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(CONNECTOR_FEISHU_DEFAULT_TIMEOUT_MS),
  apiBaseUrl: z.string(),
})

/** Validate route, identity, and origin facts that Schemastery cannot express. */
function assertConfig(config: Config): void {
  if (config.appId.trim() !== config.appId || config.appId === '') {
    throw new Error('connector-feishu appId must be a non-empty trimmed string')
  }
  if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/')
    || config.path.includes('?') || config.path.includes('#')) {
    throw new Error('connector-feishu path must be an absolute non-root pathname without a trailing slash, query, or fragment')
  }
  if (config.apiBaseUrl !== undefined) {
    let origin: URL
    try {
      origin = new URL(config.apiBaseUrl)
    } catch {
      throw new Error('connector-feishu apiBaseUrl must be an absolute URL')
    }
    if (origin.protocol !== 'https:' || origin.search !== '' || origin.hash !== '') {
      throw new Error('connector-feishu apiBaseUrl must be an https URL without query or fragment')
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
  return (config.apiBaseUrl ?? 'https://open.feishu.cn').replace(/\/+$/, '')
}

/**
 * Register the callback route and the Feishu provider on `ctx.connector`.
 * @param ctx - the plugin context (must inject `webServer`, `connector`, and `credentials`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertConfig(config)
  const client = createFeishuClient(ctx, {
    apiBaseUrl: resolveApiBaseUrl(config),
    appId: config.appId,
    appSecretRef: credentialRef(config.appSecretEnv),
    timeoutMs: config.timeoutMs ?? CONNECTOR_FEISHU_DEFAULT_TIMEOUT_MS,
  })
  const route: WebRoute = {
    kind: 'exact',
    path: config.path,
    handler: createFeishuCallbackHandler(ctx, {
      verificationTokenRef: credentialRef(config.verificationTokenEnv),
      ...config.encryptKeyEnv === undefined ? {} : { encryptKeyRef: credentialRef(config.encryptKeyEnv) },
      maxBodyBytes: config.maxBodyBytes,
    }),
  }
  ctx.effect(() => ctx.webServer.register(route), `connector-feishu: ${config.path}`)
  ctx.effect(
    () => ctx.connector.registerProvider({
      id: FEISHU_PROVIDER_ID,
      push: (channel, message, signal) => client.push(channel, message, signal),
    }),
    'connector-feishu: provider',
  )
}
