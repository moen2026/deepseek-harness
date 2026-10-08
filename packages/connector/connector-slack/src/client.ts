/**
 * Slack outbound delivery: post one message to the channel via
 * `chat.postMessage` — plain text by default, or Block Kit blocks when the
 * message carries actions (each button carries its action id back in the
 * interactive callback's `action_id`). The bot token is resolved from
 * credentials at each push so rotation needs no reload, and it is never
 * logged or echoed.
 * @module @deepseek-ai/dsh-connector-slack/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectorChannelId, ConnectorOutboundMessage } from '@deepseek-ai/dsh-connector'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { SlackError } from './types.ts'

/** Resolved outbound client values, validated once at plugin load. */
export interface SlackClientOptions {
  /** API origin, such as `https://slack.com`, without a trailing slash. */
  readonly apiBaseUrl: string
  /** Credential reference containing the bot token. */
  readonly botTokenRef: CredentialRef
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number
}

/** Outbound Slack client the provider hands to `ctx.connector`. */
export interface SlackClient {
  /**
   * Deliver one message to a channel.
   * @param channel - the Slack channel id.
   * @param message - the message to deliver.
   * @param signal - cancellation honored across the request.
   */
  push(channel: ConnectorChannelId, message: ConnectorOutboundMessage, signal?: AbortSignal): Promise<void>
}

/**
 * Render one action-bearing message as Block Kit blocks: the text as a
 * markdown section, one button per action whose `action_id` and `value`
 * both carry the action id the interactive callback echoes back. Called only
 * when `actions` is present.
 * @param message - the outbound message to render.
 * @returns the Block Kit blocks posted as `chat.postMessage`'s `blocks`.
 */
export function interactiveBlocksOf(message: ConnectorOutboundMessage): readonly unknown[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message.title === undefined ? message.text : `*${message.title}*\n${message.text}`,
      },
    },
    {
      type: 'actions',
      elements: (message.actions ?? []).map(action => ({
        type: 'button',
        text: { type: 'plain_text', text: action.label, emoji: true },
        action_id: action.id,
        value: action.id,
        ...(action.style === 'primary' || action.style === 'danger' ? { style: action.style } : {}),
      })),
    },
  ]
}

/**
 * Build a Slack client over one bot token credential.
 * @param ctx - the plugin context carrying credentials.
 * @param options - resolved origin, token reference, and timeout.
 * @returns a client that posts text or Block Kit messages to a channel.
 */
export function createSlackClient(ctx: Context, options: SlackClientOptions): SlackClient {
  const resolveToken = async (): Promise<string> => {
    const credential = await ctx.credentials.resolve(options.botTokenRef)
    if (credential === undefined || credential.value === '') {
      throw new SlackError('connector-slack: Slack bot token is unavailable', 'SLACK_CREDENTIALS_UNAVAILABLE')
    }
    return credential.value
  }

  return {
    async push(channel, message, signal = new AbortController().signal) {
      const token = await resolveToken()
      const text = message.title === undefined ? message.text : `${message.title}\n${message.text}`
      const body: Record<string, unknown> = message.actions === undefined
        ? { channel, text }
        : { channel, text, blocks: interactiveBlocksOf(message) }
      let response: Response
      try {
        response = await fetch(`${options.apiBaseUrl}/api/chat.postMessage`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs), signal]),
        })
      } catch (error) {
        throw new SlackError('connector-slack: Slack request failed', 'SLACK_DELIVERY_FAILED', { cause: error })
      }
      if (!response.ok) {
        throw new SlackError(`connector-slack: Slack API responded ${response.status}`, 'SLACK_DELIVERY_FAILED')
      }
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        // response.json is the only statement in the try; a non-JSON answer is
        // exactly this refusal.
        throw new SlackError('connector-slack: Slack API returned a non-JSON body', 'SLACK_DELIVERY_FAILED')
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new SlackError('connector-slack: Slack API returned an unexpected body', 'SLACK_DELIVERY_FAILED')
      }
      if ((payload as Record<string, unknown>).ok !== true) {
        const error = (payload as Record<string, unknown>).error
        throw new SlackError(`connector-slack: Slack send failed with error ${String(error)}`, 'SLACK_DELIVERY_FAILED')
      }
    },
  }
}
