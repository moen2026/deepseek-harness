/**
 * Discord outbound delivery: post one message to a channel via the REST API
 * — plain text by default, or an action row of buttons when the message
 * carries actions (each button carries its action id back in the component
 * interaction's `custom_id`), and acknowledge each component interaction so
 * the platform stops showing the loading state. The bot token is resolved
 * from credentials at each request so rotation needs no reload, and it is
 * never logged or echoed.
 * @module @deepseek-ai/dsh-connector-discord/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectorChannelId, ConnectorOutboundMessage } from '@deepseek-ai/dsh-connector'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { DiscordError } from './types.ts'

/** Resolved outbound client values, validated once at plugin load. */
export interface DiscordClientOptions {
  /** REST API origin, such as `https://discord.com/api/v10`, without a trailing slash. */
  readonly apiBaseUrl: string
  /** Credential reference containing the bot token. */
  readonly botTokenRef: CredentialRef
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number
}

/** Outbound Discord client the provider hands to `ctx.connector`. */
export interface DiscordClient {
  /**
   * Deliver one message to a channel.
   * @param channel - the Discord channel id.
   * @param message - the message to deliver.
   * @param signal - cancellation honored across the request.
   */
  push(channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal): Promise<void>

  /**
   * Acknowledge one component interaction (deferred update) so the client's
   * loading state stops.
   * @param interactionId - the id carried by the incoming interaction.
   * @param interactionToken - the one-time interaction token Discord returned.
   * @param signal - cancellation honored across the request.
   */
  ackInteraction(interactionId: string, interactionToken: string, signal?: AbortSignal): Promise<void>
}

/**
 * Render one action-bearing message as one action row: one button per
 * action whose `custom_id` carries the action id the component interaction
 * echoes back. Called only when `actions` is present.
 * @param message - the outbound message to render.
 * @returns the `components` posted with the message.
 */
export function componentsOf(message: ConnectorOutboundMessage): Record<string, unknown> {
  return {
    components: [
      {
        type: 1,
        components: (message.actions ?? []).map(action => ({
          type: 2,
          style: action.style === 'primary' ? 1 : action.style === 'danger' ? 4 : 2,
          label: action.label,
          custom_id: action.id,
        })),
      },
    ],
  }
}

/**
 * Build a Discord client over one bot token credential.
 * @param ctx - the plugin context carrying credentials.
 * @param options - resolved origin, token reference, and timeout.
 * @returns a client that posts messages and acknowledges interactions.
 */
export function createDiscordClient(ctx: Context, options: DiscordClientOptions): DiscordClient {
  const resolveToken = async (): Promise<string> => {
    const credential = await ctx.credentials.resolve(options.botTokenRef)
    if (credential === undefined || credential.value === '') {
      throw new DiscordError('connector-discord: Discord bot token is unavailable', 'DISCORD_CREDENTIALS_UNAVAILABLE')
    }
    return credential.value
  }

  const request = async (path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<void> => {
    const token = await resolveToken()
    let response: Response
    try {
      response = await fetch(`${options.apiBaseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs), signal]),
      })
    } catch (error) {
      throw new DiscordError('connector-discord: Discord REST request failed', 'DISCORD_DELIVERY_FAILED', { cause: error })
    }
    if (!response.ok) {
      let detail = `responded ${response.status}`
      try {
        const payload: unknown = await response.json()
        const message = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).message
          : undefined
        if (typeof message === 'string' && message !== '') detail = message
      } catch {
        // response.json is the only statement in the try; a non-JSON error
        // body keeps the status detail.
      }
      throw new DiscordError(`connector-discord: Discord API ${detail}`, 'DISCORD_DELIVERY_FAILED')
    }
  }

  return {
    async push(channel, message, signal = new AbortController().signal) {
      const text = message.title === undefined ? message.text : `${message.title}\n${message.text}`
      await request(`/channels/${channel}/messages`, {
        content: text,
        ...(message.actions === undefined ? {} : componentsOf(message)),
      }, signal)
    },

    async ackInteraction(interactionId, interactionToken, signal = new AbortController().signal) {
      await request(`/interactions/${interactionId}/${interactionToken}/callback`, { type: 6 }, signal)
    },
  }
}
