import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import { describe, expect, it } from 'vitest'
import { translateTelegramUpdate } from '../src/event.ts'

describe('translateTelegramUpdate', () => {
  it('translates a text message update with numeric chat and sender ids', () => {
    expect(translateTelegramUpdate({
      update_id: 41,
      message: { message_id: 7, chat: { id: -100_200 }, from: { id: 42 }, text: 'hello' },
    })).toEqual({
      kind: 'message',
      message: {
        provider: 'telegram',
        channel: ConnectorChannelId('-100200'),
        messageId: ConnectorMessageId('41'),
        sender: '42',
        text: 'hello',
      },
    })
  })

  it('translates an inline-keyboard callback query into a resolution', () => {
    expect(translateTelegramUpdate({
      update_id: 42,
      callback_query: {
        id: 'cq-1',
        from: { id: 42 },
        data: 'dsh-approval:1:allowed-once',
        message: { message_id: 7, chat: { id: -100_200 } },
      },
    })).toEqual({
      kind: 'message',
      message: {
        provider: 'telegram',
        channel: ConnectorChannelId('-100200'),
        messageId: ConnectorMessageId('cq-1'),
        sender: '42',
        text: '',
        resolution: { actionId: 'dsh-approval:1:allowed-once', value: '' },
      },
    })
  })

  it.each([
    ['an update without a message', { update_id: 43 }],
    ['a message without text', { update_id: 44, message: { chat: { id: 1 }, from: { id: 2 } } }],
    ['a photo message', { update_id: 45, message: { chat: { id: 1 }, from: { id: 2 }, photo: [] } }],
  ] as const)('ignores %s', (_name, payload) => {
    expect(translateTelegramUpdate(payload)).toEqual({ kind: 'ignored' })
  })

  it.each([
    ['a message without an update id', { message: { chat: { id: 1 }, from: { id: 2 }, text: 'hi' } }, /update_id/],
    ['a message without a chat', { update_id: 1, message: { from: { id: 2 }, text: 'hi' } }, /chat\.id/],
    ['a message without a sender', { update_id: 1, message: { chat: { id: 1 }, text: 'hi' } }, /from\.id/],
    ['a query without a data field', { update_id: 1, callback_query: { id: 'cq', from: { id: 2 }, message: { chat: { id: 1 } } } }, /callback_query\.data/],
    ['a query without an id', { update_id: 1, callback_query: { from: { id: 2 }, data: 'a', message: { chat: { id: 1 } } } }, /callback_query\.id/],
    ['a query without a chat', { update_id: 1, callback_query: { id: 'cq', from: { id: 2 }, data: 'a' } }, /chat\.id/],
  ] as const)('refuses %s', (_name, payload, message) => {
    expect(() => translateTelegramUpdate(payload)).toThrow(message)
  })
})
