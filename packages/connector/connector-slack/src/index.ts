/**
 * Slack callback adapter for the connector seam. One plugin instance
 * registers one exact callback route on the injected WebServer and one Slack
 * provider on `ctx.connector`. The route verifies every callback (signed
 * with the app signing secret), answers the URL-verification challenge and
 * Block Kit interactivity, and admits text messages and action clicks through
 * `ctx.connector.deliver()`; the provider pushes outbound messages by posting
 * text or Block Kit blocks with the bot token. Both registrations are
 * effect-scoped: disposal unregisters them.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-connector-slack
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-connector'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createSlackClient } from './client.ts'
import { createSlackCallbackHandler } from './handler.ts'
import { SLACK_PROVIDER_ID } from './types.ts'

export { SlackError, SLACK_PROVIDER_ID } from './types.ts'
export type { SlackErrorCode } from './types.ts'

/** Cordis function-plugin name. */
export const name = 'connector-slack'

/** Host services required before the route and provider can register. */
export const inject = ['webServer', 'connector', 'credentials']

/** Default per-request outbound timeout (ms). */
export const CONNECTOR_SLACK_DEFAULT_TIMEOUT_MS = 10_000

/** Required Slack adapter configuration. */
export interface Config {
  /** Exact absolute callback route path, such as `/slack`. */
  readonly path: string
  /** Credential reference containing the app signing secret. */
  readonly signingSecretEnv: string
  /** Credential reference containing the bot token used for outbound pushes. */
  readonly botTokenEnv: string
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
  /** Per-request outbound timeout in milliseconds. Defaults to 10000. */
  readonly timeoutMs?: number
  /** API origin override, such as a proxy; defaults to `https://slack.com`. */
  readonly apiBaseUrl?: string
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  signingSecretEnv: z.string().role('credential-ref').required(),
  botTokenEnv: z.string().role('credential-ref').required(),
  maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  timeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(CONNECTOR_SLACK_DEFAULT_TIMEOUT_MS),
  apiBaseUrl: z.string(),
})

/** Validate route and origin facts that Schemastery cannot express. */
function assertConfig(config: Config): void {
  if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/')
    || config.path.includes('?') || config.path.includes('#')) {
    throw new Error('connector-slack path must be an absolute non-root pathname without a trailing slash, query, or fragment')
  }
  if (config.apiBaseUrl !== undefined) {
    let origin: URL
    try {
      origin = new URL(config.apiBaseUrl)
    } catch {
      throw new Error('connector-slack apiBaseUrl must be an absolute URL')
    }
    if (origin.protocol !== 'https:' || origin.search !== '' || origin.hash !== '') {
      throw new Error('connector-slack apiBaseUrl must be an https URL without query or fragment')
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
  return (config.apiBaseUrl ?? 'https://slack.com').replace(/\/+$/, '')
}

/**
 * Register the callback route and the Slack provider on `ctx.connector`.
 * @param ctx - the plugin context (must inject `webServer`, `connector`, and `credentials`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertConfig(config)
  const client = createSlackClient(ctx, {
    apiBaseUrl: resolveApiBaseUrl(config),
    botTokenRef: credentialRef(config.botTokenEnv),
    timeoutMs: config.timeoutMs ?? CONNECTOR_SLACK_DEFAULT_TIMEOUT_MS,
  })
  const route: WebRoute = {
    kind: 'exact',
    path: config.path,
    handler: createSlackCallbackHandler(ctx, {
      signingSecretRef: credentialRef(config.signingSecretEnv),
      maxBodyBytes: config.maxBodyBytes,
    }),
  }
  ctx.effect(() => ctx.webServer.register(route), `connector-slack: ${config.path}`)
  ctx.effect(
    () => ctx.connector.registerProvider({
      id: SLACK_PROVIDER_ID,
      push: (channel, message, signal) => client.push(channel, message, signal),
    }),
    'connector-slack: provider',
  )
}
