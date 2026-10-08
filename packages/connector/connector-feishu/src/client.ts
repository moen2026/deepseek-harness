/**
 * Feishu outbound delivery: mint (and cache until near expiry) the tenant
 * access token, then post one message to the channel via `im/v1/messages` —
 * plain text by default, or an interactive card when the message carries
 * actions (each button carries its action id back in the card callback's
 * `action.value`). The app secret is resolved from credentials at each mint
 * so rotation needs no reload, and it is never logged or echoed.
 * @module @deepseek-ai/dsh-connector-feishu/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectorChannelId, ConnectorOutboundMessage } from '@deepseek-ai/dsh-connector'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { FeishuError } from './types.ts'

/** Cached tenant token with the wall-clock instant it stops being usable. */
interface CachedToken {
  readonly value: string
  readonly expiresAt: number
}

/** Margin subtracted from the platform expiry so a push never races the token's end. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000

/** Resolved outbound client values, validated once at plugin load. */
export interface FeishuClientOptions {
  /** API origin, such as `https://open.feishu.cn`, without a trailing slash. */
  readonly apiBaseUrl: string
  /** Feishu app id sent with the token request. */
  readonly appId: string
  /** Credential reference containing the app secret. */
  readonly appSecretRef: CredentialRef
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number
}

/** Outbound Feishu client the provider hands to `ctx.connector`. */
export interface FeishuClient {
  /**
   * Deliver one message to a chat.
   * @param channel - the Feishu chat id.
   * @param message - the message to deliver.
   * @param signal - cancellation honored across the request.
   */
  push(channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal): Promise<void>
}

/**
 * Render one action-bearing message as a Feishu interactive card: the text as
 * a markdown block, one button per action with the action id in the button
 * value the card callback echoes. Called only when `actions` is present.
 * @param message - the outbound message to render.
 * @returns the card JSON posted as the `im/v1/messages` content.
 */
export function interactiveCardOf(message: ConnectorOutboundMessage): Record<string, unknown> {
  return {
    ...(message.title === undefined
      ? {}
      : { header: { title: { tag: 'plain_text', content: message.title } } }),
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: message.text } },
      {
        tag: 'action',
        actions: (message.actions ?? []).map(action => ({
          tag: 'button',
          text: { tag: 'plain_text', content: action.label },
          type: action.style === 'primary' ? 'primary' : action.style === 'danger' ? 'danger' : 'default',
          value: { actionId: action.id },
        })),
      },
    ],
  }
}

/**
 * Build a Feishu client over one app's credentials.
 * @param ctx - the plugin context carrying credentials.
 * @param options - resolved origin, app id, secret reference, and timeout.
 * @returns a client that mints tenant tokens on demand and posts text messages.
 */
export function createFeishuClient(ctx: Context, options: FeishuClientOptions): FeishuClient {
  let cached: CachedToken | undefined

  const resolveSecret = async (): Promise<string> => {
    const credential = await ctx.credentials.resolve(options.appSecretRef)
    if (credential === undefined || credential.value === '') {
      throw new FeishuError('connector-feishu: Feishu app secret is unavailable', 'FEISHU_CREDENTIALS_UNAVAILABLE')
    }
    return credential.value
  }

  const requestJson = async (url: string, init: RequestInit, signal: AbortSignal): Promise<Record<string, unknown>> => {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs), signal]) })
    } catch (error) {
      throw new FeishuError('connector-feishu: Feishu request failed', 'FEISHU_DELIVERY_FAILED', { cause: error })
    }
    if (!response.ok) {
      throw new FeishuError(`connector-feishu: Feishu API responded ${response.status}`, 'FEISHU_DELIVERY_FAILED')
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      // response.json is the only statement in the try; a non-JSON answer is
      // exactly this refusal.
      throw new FeishuError('connector-feishu: Feishu API returned a non-JSON body', 'FEISHU_DELIVERY_FAILED')
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new FeishuError('connector-feishu: Feishu API returned an unexpected body', 'FEISHU_DELIVERY_FAILED')
    }
    return payload as Record<string, unknown>
  }

  const mintToken = async (signal: AbortSignal): Promise<string> => {
    const appSecret = await resolveSecret()
    const payload = await requestJson(
      `${options.apiBaseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: options.appId, app_secret: appSecret }),
      },
      signal,
    )
    const token = payload.tenant_access_token
    const expire = payload.expire
    if (payload.code !== 0 || typeof token !== 'string' || token === ''
      || typeof expire !== 'number' || !Number.isFinite(expire)) {
      throw new FeishuError(`connector-feishu: Feishu token request failed with code ${String(payload.code)}`, 'FEISHU_DELIVERY_FAILED')
    }
    cached = { value: token, expiresAt: Date.now() + Math.max(expire * 1000 - TOKEN_EXPIRY_MARGIN_MS, 0) }
    return token
  }

  const tenantToken = async (signal: AbortSignal): Promise<string> => {
    if (cached !== undefined && Date.now() < cached.expiresAt) return cached.value
    return await mintToken(signal)
  }

  return {
    async push(channel, message, signal = new AbortController().signal) {
      const token = await tenantToken(signal)
      let body: Record<string, unknown>
      if (message.actions === undefined) {
        const text = message.title === undefined ? message.text : `${message.title}\n${message.text}`
        body = { receive_id: channel, msg_type: 'text', content: JSON.stringify({ text }) }
      } else {
        body = { receive_id: channel, msg_type: 'interactive', content: JSON.stringify(interactiveCardOf(message)) }
      }
      const payload = await requestJson(
        `${options.apiBaseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        signal,
      )
      if (payload.code !== 0) {
        throw new FeishuError(`connector-feishu: Feishu send failed with code ${String(payload.code)}`, 'FEISHU_DELIVERY_FAILED')
      }
    },
  }
}
