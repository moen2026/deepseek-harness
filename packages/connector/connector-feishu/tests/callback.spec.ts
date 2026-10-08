import { createCipheriv, createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  FeishuCallbackError,
  decryptFeishuEnvelope,
  readRawBody,
  tokenMatches,
  verifyFeishuSignature,
} from '../src/callback.ts'
import { fieldOf, tokenOf, translateFeishuCallback } from '../src/event.ts'

/** Minimal async-iterable request for byte-level branches Node fetch cannot construct. */
function request(options: {
  chunks?: Array<Buffer | string>
  complete?: boolean
  error?: unknown
} = {}): IncomingMessage & { resume: ReturnType<typeof vi.fn> } {
  const resume = vi.fn()
  return {
    complete: options.complete ?? true,
    resume,
    async * [Symbol.asyncIterator]() {
      for (const chunk of options.chunks ?? []) yield chunk
      if (options.error !== undefined) throw options.error
    },
  } as unknown as IncomingMessage & { resume: ReturnType<typeof vi.fn> }
}

/** Mirror of Feishu's documented envelope: SHA-256 key, IV prefix, AES-256-CBC, base64. */
function encryptEnvelope(payload: unknown, encryptKey: string): string {
  const key = createHash('sha256').update(encryptKey).digest()
  const iv = Buffer.alloc(16, 7)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const plaintext = typeof payload === 'string'
    ? Buffer.from(payload, 'utf8')
    : Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), 'utf8')
  return Buffer.concat([iv, cipher.update(plaintext), cipher.final()]).toString('base64')
}

/** Independent recompute of the documented signature concatenation. */
function signatureOf(timestamp: string, nonce: string, encryptKey: string, rawBody: string): string {
  return createHash('sha256')
    .update(timestamp + nonce + encryptKey)
    .update(rawBody)
    .digest('hex')
}

/** One v2 text-message payload with per-test field overrides. */
function messagePayload(
  message: Record<string, unknown> = {},
  sender: Record<string, unknown> = { sender_id: { open_id: 'ou-1' } },
): unknown {
  return {
    header: { event_type: 'im.message.receive_v1', token: 'vt' },
    event: {
      sender,
      message: {
        message_id: 'm-1',
        chat_id: 'chat-1',
        message_type: 'text',
        content: '{"text":"hello"}',
        ...message,
      },
    },
  }
}

describe('bounded raw body intake', () => {
  it('accepts an absent length and both Buffer and string chunks', async () => {
    await expect(readRawBody(request({ chunks: [Buffer.from('{"a"'), ':1}'] }), 64))
      .resolves.toEqual(Buffer.from('{"a":1}'))
  })

  it('rejects a chunked body past the cap and drains the stream', async () => {
    const streamed = request({ chunks: [Buffer.from('ab'), Buffer.from('c')] })
    await expect(readRawBody(streamed, 2)).rejects.toMatchObject({ status: 413 })
    expect(streamed.resume).toHaveBeenCalledOnce()
  })

  it('normalizes stream failure and incomplete EOF as an aborted body', async () => {
    await expect(readRawBody(request({ error: new Error('socket') }), 64))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
    await expect(readRawBody(request({ complete: false }), 64))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
  })
})

describe('signature verification', () => {
  const rawBody = '{"encrypt":"x"}'

  it('verifies the documented concatenation over the untouched bytes', () => {
    const signature = signatureOf('1700000000', 'n-1', 'ek-1', rawBody)
    expect(verifyFeishuSignature({ timestamp: '1700000000', nonce: 'n-1', signature }, 'ek-1', Buffer.from(rawBody)))
      .toBe(true)
  })

  it('rejects mismatching signatures and length mismatches', () => {
    const wrongKey = signatureOf('1700000000', 'n-1', 'ek-2', rawBody)
    expect(verifyFeishuSignature({ timestamp: '1700000000', nonce: 'n-1', signature: wrongKey }, 'ek-1', Buffer.from(rawBody)))
      .toBe(false)
    const wrongBody = signatureOf('1700000000', 'n-1', 'ek-1', '{"encrypt":"y"}')
    expect(verifyFeishuSignature({ timestamp: '1700000000', nonce: 'n-1', signature: wrongBody }, 'ek-1', Buffer.from(rawBody)))
      .toBe(false)
    expect(verifyFeishuSignature({ timestamp: '1700000000', nonce: 'n-1', signature: 'abc' }, 'ek-1', Buffer.from(rawBody)))
      .toBe(false)
  })
})

describe('envelope decryption', () => {
  it('round-trips a documented envelope', () => {
    expect(decryptFeishuEnvelope(encryptEnvelope({ challenge: 'c-1' }, 'ek-1'), 'ek-1'))
      .toEqual({ challenge: 'c-1' })
  })

  it('rejects an unreadable envelope, bad padding, and the wrong key', () => {
    expect(() => decryptFeishuEnvelope('AAAA', 'ek-1')).toThrow(FeishuCallbackError)
    expect(() => decryptFeishuEnvelope(Buffer.alloc(32, 1).toString('base64'), 'ek-1')).toThrow('could not be decrypted')
    expect(() => decryptFeishuEnvelope(encryptEnvelope({ a: 1 }, 'ek-2'), 'ek-1')).toThrow('could not be decrypted')
  })

  it('rejects decrypted non-JSON and non-UTF-8 plaintexts', () => {
    expect(() => decryptFeishuEnvelope(encryptEnvelope('plain text', 'ek-1'), 'ek-1')).toThrow('is not valid JSON')
    expect(() => decryptFeishuEnvelope(encryptEnvelope(Buffer.from([0xff, 0xfe]), 'ek-1'), 'ek-1')).toThrow('is not valid JSON')
  })
})

describe('verification-token comparison', () => {
  it('accepts an equal token and rejects mismatches or length differences', () => {
    expect(tokenMatches('vt-1', 'vt-1')).toBe(true)
    expect(tokenMatches('vt-1', 'vt-2')).toBe(false)
    expect(tokenMatches('vt', 'vt-1')).toBe(false)
  })
})

describe('token extraction', () => {
  it('reads the top-level token, the header token, or nothing', () => {
    expect(tokenOf({ token: 'a' })).toBe('a')
    expect(tokenOf({ header: { token: 'b' } })).toBe('b')
    expect(tokenOf({ token: 123 })).toBeUndefined()
    expect(tokenOf({})).toBeUndefined()
  })
})

describe('field access on unknown values', () => {
  it('reads objects only and refuses arrays, scalars, and null', () => {
    expect(fieldOf({ a: 1 }, 'a')).toBe(1)
    expect(fieldOf(null, 'a')).toBeUndefined()
    expect(fieldOf([1], '0')).toBeUndefined()
    expect(fieldOf('text', 'length')).toBeUndefined()
  })
})

describe('Feishu callback translation', () => {
  it('translates a full text-message event into connector fields', () => {
    expect(translateFeishuCallback(messagePayload())).toEqual({
      kind: 'message',
      message: { provider: 'feishu', channel: 'chat-1', messageId: 'm-1', sender: 'ou-1', text: 'hello' },
    })
  })

  it('falls back to the sender user id when no open id is present', () => {
    const translated = translateFeishuCallback(messagePayload({}, { sender_id: { user_id: 'uid-1' } }))
    expect(translated).toMatchObject({ kind: 'message', message: { sender: 'uid-1' } })
  })

  it('returns the challenge for a URL-verification call', () => {
    expect(translateFeishuCallback({ type: 'url_verification', challenge: 'c-1', token: 'vt' }))
      .toEqual({ kind: 'challenge', challenge: 'c-1' })
  })

  it('refuses a URL-verification call without a challenge', () => {
    expect(() => translateFeishuCallback({ type: 'url_verification', token: 'vt' }))
      .toThrow('challenge must be a non-empty string')
  })

  it('translates a card action click into a resolution message', () => {
    expect(translateFeishuCallback({
      header: { event_id: 'evt-1', event_type: 'card.action.trigger', token: 'vt' },
      event: {
        operator: { open_id: 'ou-1' },
        context: { open_message_id: 'om-1', open_chat_id: 'chat-1' },
        action: { value: { actionId: 'dsh-approval:abc:allowed-once' } },
      },
    })).toEqual({
      kind: 'message',
      message: {
        provider: 'feishu',
        channel: 'chat-1',
        messageId: 'evt-1',
        sender: 'ou-1',
        text: '',
        resolution: { actionId: 'dsh-approval:abc:allowed-once', value: '' },
      },
    })
  })

  it('falls back to the operator user id and refuses structurally invalid card clicks', () => {
    const click = (overrides: Record<string, unknown>): unknown => ({
      header: { event_id: 'evt-1', event_type: 'card.action.trigger', token: 'vt' },
      event: {
        operator: {},
        context: { open_message_id: 'om-1', open_chat_id: 'chat-1' },
        action: { value: { actionId: 'dsh-approval:abc:allowed-once' } },
        ...overrides,
      },
    })
    expect(translateFeishuCallback(click({ operator: { user_id: 'uid-1' } })))
      .toMatchObject({ kind: 'message', message: { sender: 'uid-1' } })
    expect(() => translateFeishuCallback(click({ context: { open_message_id: 'om-1' } })))
      .toThrow('context.open_chat_id must be a non-empty string')
    expect(() => translateFeishuCallback(click({ operator: { open_id: 'ou-1' }, action: { value: {} } })))
      .toThrow('value.actionId must be a non-empty string')
    expect(() => translateFeishuCallback({
      header: { event_type: 'card.action.trigger', token: 'vt' },
      event: { operator: { open_id: 'ou-1' }, context: { open_chat_id: 'chat-1' }, action: { value: { actionId: 'a' } } },
    })).toThrow('header.event_id must be a non-empty string')
  })

  it('ignores events that are not text messages', () => {
    expect(translateFeishuCallback({ header: { event_type: 'im.chat.updated' } })).toEqual({ kind: 'ignored' })
    expect(translateFeishuCallback(messagePayload({ message_type: 'image' }))).toEqual({ kind: 'ignored' })
    expect(translateFeishuCallback(messagePayload({ message_type: undefined }))).toEqual({ kind: 'ignored' })
  })

  it('refuses structurally invalid text messages', () => {
    expect(() => translateFeishuCallback(messagePayload({ content: '' })))
      .toThrow('message.content must be a non-empty string')
    expect(() => translateFeishuCallback(messagePayload({ content: 'plain' })))
      .toThrow('message.content must be JSON text')
    expect(() => translateFeishuCallback(messagePayload({ content: '{}' })))
      .toThrow('message text must be a non-empty string')
    expect(() => translateFeishuCallback(messagePayload({ content: '{"text":"  "}' })))
      .toThrow('message text must be a non-empty string')
    expect(() => translateFeishuCallback(messagePayload({ chat_id: '' })))
      .toThrow('message.chat_id must be a non-empty string')
    expect(() => translateFeishuCallback(messagePayload({ message_id: undefined })))
      .toThrow('message.message_id must be a non-empty string')
    expect(() => translateFeishuCallback(messagePayload({}, {})))
      .toThrow('message sender id must be a non-empty string')
  })
})
