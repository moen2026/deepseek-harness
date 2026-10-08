import { ConnectorChannelId, ConnectorMessageId } from '@deepseek-ai/dsh-connector'
import { describe, expect, it } from 'vitest'
import { translateDispatch } from '../src/event.ts'

describe('translateDispatch', () => {
  it('translates a text MESSAGE_CREATE', () => {
    expect(translateDispatch('MESSAGE_CREATE', {
      id: 'm-1',
      channel_id: 'c-1',
      author: { id: 'u-1' },
      content: 'hello',
      type: 0,
    })).toEqual({
      kind: 'message',
      message: {
        provider: 'discord',
        channel: ConnectorChannelId('c-1'),
        messageId: ConnectorMessageId('m-1'),
        sender: 'u-1',
        text: 'hello',
      },
    })
  })

  it('translates a component interaction into a resolution', () => {
    expect(translateDispatch('INTERACTION_CREATE', {
      id: 'i-1',
      type: 3,
      token: 'it-1',
      user: { id: 'u-1' },
      message: { channel_id: 'c-1' },
      data: { custom_id: 'dsh-approval:1:allowed-once' },
    })).toEqual({
      kind: 'interaction',
      interactionId: 'i-1',
      interactionToken: 'it-1',
      message: {
        provider: 'discord',
        channel: ConnectorChannelId('c-1'),
        messageId: ConnectorMessageId('i-1'),
        sender: 'u-1',
        text: '',
        resolution: { actionId: 'dsh-approval:1:allowed-once', value: '' },
      },
    })
  })

  it('reads the sender from the guild member when there is no user', () => {
    const translated = translateDispatch('INTERACTION_CREATE', {
      id: 'i-2',
      type: 3,
      token: 'it-2',
      member: { user: { id: 'u-2' } },
      message: { channel_id: 'c-1' },
      data: { custom_id: 'a1' },
    })
    expect(translated.kind).toBe('interaction')
    expect(translated.kind === 'interaction' && translated.message.sender).toBe('u-2')
  })

  it.each([
    ['a bot-authored message', 'MESSAGE_CREATE', { id: 'm-2', channel_id: 'c-1', author: { id: 'b-1', bot: true }, content: 'echo' }],
    ['a system message', 'MESSAGE_CREATE', { id: 'm-3', channel_id: 'c-1', author: { id: 'u-1' }, content: 'joined', type: 7 }],
    ['a message without content', 'MESSAGE_CREATE', { id: 'm-4', channel_id: 'c-1', author: { id: 'u-1' } }],
    ['a non-component interaction', 'INTERACTION_CREATE', { id: 'i-3', type: 2, token: 'it-3' }],
    ['an unrelated dispatch', 'GUILD_MEMBER_UPDATE', {}],
  ] as const)('ignores %s', (_name, type, data) => {
    expect(translateDispatch(type, data)).toEqual({ kind: 'ignored' })
  })

  it.each([
    ['a message without an id', 'MESSAGE_CREATE', { channel_id: 'c-1', author: { id: 'u-1' }, content: 'hi' }, /message id/],
    ['a message without a channel', 'MESSAGE_CREATE', { id: 'm-5', author: { id: 'u-1' }, content: 'hi' }, /channel_id/],
    ['a message without an author id', 'MESSAGE_CREATE', { id: 'm-5', channel_id: 'c-1', author: {}, content: 'hi' }, /author\.id/],
    ['an interaction without an id', 'INTERACTION_CREATE', { type: 3, token: 'it-4', user: { id: 'u-1' }, message: { channel_id: 'c-1' }, data: { custom_id: 'a' } }, /interaction id/],
    ['an interaction without a token', 'INTERACTION_CREATE', { id: 'i-4', type: 3, user: { id: 'u-1' }, message: { channel_id: 'c-1' }, data: { custom_id: 'a' } }, /interaction token/],
    ['an interaction without a custom id', 'INTERACTION_CREATE', { id: 'i-4', type: 3, token: 'it-4', user: { id: 'u-1' }, message: { channel_id: 'c-1' }, data: {} }, /custom_id/],
    ['an interaction without a channel', 'INTERACTION_CREATE', { id: 'i-4', type: 3, token: 'it-4', user: { id: 'u-1' }, data: { custom_id: 'a' } }, /channel_id/],
    ['an interaction without a sender', 'INTERACTION_CREATE', { id: 'i-4', type: 3, token: 'it-4', message: { channel_id: 'c-1' }, data: { custom_id: 'a' } }, /user\.id/],
  ] as const)('refuses %s', (_name, type, data, message) => {
    expect(() => translateDispatch(type, data)).toThrow(message)
  })
})
