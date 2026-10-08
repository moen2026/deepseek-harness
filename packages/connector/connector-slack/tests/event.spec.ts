import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import { describe, expect, it } from 'vitest'
import { translateSlackPayload } from '../src/event.ts'

describe('translateSlackPayload', () => {
  it('echoes a url_verification challenge', () => {
    expect(translateSlackPayload({ type: 'url_verification', challenge: 'ch-1' }))
      .toEqual({ kind: 'challenge', challenge: 'ch-1' })
  })

  it('translates a text message event', () => {
    expect(translateSlackPayload({
      type: 'event_callback',
      event_id: 'Ev-1',
      event: { type: 'message', channel: 'C1', user: 'U1', text: 'hello', ts: '1.2' },
    })).toEqual({
      kind: 'message',
      message: {
        provider: 'slack',
        channel: ConnectorChannelId('C1'),
        messageId: ConnectorMessageId('Ev-1'),
        sender: 'U1',
        text: 'hello',
      },
    })
  })

  it('translates a Block Kit action click into a resolution', () => {
    expect(translateSlackPayload({
      type: 'block_actions',
      channel: { id: 'C1' },
      user: { id: 'U1' },
      message: { ts: '1.2' },
      actions: [{ action_id: 'dsh-approval:1:allowed-once', value: 'dsh-approval:1:allowed-once' }],
    })).toEqual({
      kind: 'message',
      message: {
        provider: 'slack',
        channel: ConnectorChannelId('C1'),
        messageId: ConnectorMessageId('1.2:dsh-approval:1:allowed-once'),
        sender: 'U1',
        text: '',
        resolution: { actionId: 'dsh-approval:1:allowed-once', value: 'dsh-approval:1:allowed-once' },
      },
    })
  })

  it.each([
    ['a bot echo', { type: 'event_callback', event_id: 'Ev-2', event: { type: 'message', bot_id: 'B1', text: 'hi' } }],
    ['a non-message event', { type: 'event_callback', event_id: 'Ev-3', event: { type: 'reaction_added' } }],
    ['a subtype event', { type: 'event_callback', event_id: 'Ev-4', event: { type: 'message', subtype: 'channel_join' } }],
    ['a message without text', { type: 'event_callback', event_id: 'Ev-5', event: { type: 'message', channel: 'C1' } }],
    ['an unknown payload type', { type: 'app_rate_limited' }],
  ] as const)('ignores %s', (_name, payload) => {
    expect(translateSlackPayload(payload)).toEqual({ kind: 'ignored' })
  })

  it.each([
    ['a challenge without a challenge string', { type: 'url_verification' }, /challenge/],
    ['a click without actions', { type: 'block_actions', channel: { id: 'C1' }, user: { id: 'U1' }, message: { ts: '1' } }, /action_id/],
    ['a click without a channel', { type: 'block_actions', user: { id: 'U1' }, message: { ts: '1' }, actions: [{ action_id: 'a' }] }, /channel\.id/],
    ['a click without a user', { type: 'block_actions', channel: { id: 'C1' }, message: { ts: '1' }, actions: [{ action_id: 'a' }] }, /user\.id/],
    ['a click without a message timestamp', { type: 'block_actions', channel: { id: 'C1' }, user: { id: 'U1' }, actions: [{ action_id: 'a' }] }, /message\.ts/],
    ['a message without an event id', { type: 'event_callback', event: { type: 'message', channel: 'C1', user: 'U1', text: 'hi' } }, /event_id/],
    ['a message without a channel', { type: 'event_callback', event_id: 'Ev-6', event: { type: 'message', user: 'U1', text: 'hi' } }, /channel/],
    ['a message without a user', { type: 'event_callback', event_id: 'Ev-7', event: { type: 'message', channel: 'C1', text: 'hi' } }, /user/],
  ] as const)('refuses %s', (_name, payload, message) => {
    expect(() => translateSlackPayload(payload)).toThrow(message)
  })
})
