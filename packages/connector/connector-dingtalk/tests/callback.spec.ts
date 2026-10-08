import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { DingtalkCallbackError, readUtf8Body, translateDingtalkCallback } from '../src/callback.ts'

const WEBHOOK_URL = 'https://oapi.dingtalk.com/robot/sendBySession?session=x'

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

/** One text callback payload with per-test field overrides. */
function textPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    msgtype: 'text',
    text: { content: 'hello' },
    msgId: 'm-1',
    conversationId: 'conv-1',
    senderStaffId: 'staff-1',
    sessionWebhook: WEBHOOK_URL,
    sessionWebhookExpiredTime: 1_700_003_600_000,
    ...overrides,
  }
}

describe('bounded UTF-8 body intake', () => {
  it('decodes Buffer and string chunks', async () => {
    await expect(readUtf8Body(request({ chunks: [Buffer.from('{"a"'), ':1}'] }), 64))
      .resolves.toBe('{"a":1}')
  })

  it('rejects a chunked body past the cap and drains the stream', async () => {
    const streamed = request({ chunks: [Buffer.from('ab'), Buffer.from('c')] })
    await expect(readUtf8Body(streamed, 2)).rejects.toMatchObject({ status: 413 })
    expect(streamed.resume).toHaveBeenCalledOnce()
  })

  it('normalizes stream failure and incomplete EOF as an aborted body', async () => {
    await expect(readUtf8Body(request({ error: new Error('socket') }), 64))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
    await expect(readUtf8Body(request({ complete: false }), 64))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
  })

  it('rejects bytes that are not valid UTF-8', async () => {
    await expect(readUtf8Body(request({ chunks: [Buffer.from([0xff, 0xfe])] }), 64))
      .rejects.toMatchObject({ status: 400, message: 'request body is not valid UTF-8' })
  })
})

describe('DingTalk callback translation', () => {
  it('translates a full text callback into connector fields with its reply session', () => {
    expect(translateDingtalkCallback(textPayload())).toEqual({
      message: {
        provider: 'dingtalk',
        channel: 'conv-1',
        messageId: 'm-1',
        sender: 'staff-1',
        text: 'hello',
      },
      sessionWebhook: WEBHOOK_URL,
      sessionWebhookExpiresAt: 1_700_003_600_000,
    })
  })

  it('falls back to the sender id when no staff id is present', () => {
    const translated = translateDingtalkCallback(textPayload({ senderStaffId: undefined, senderId: 'sid-1' }))
    expect(translated).toMatchObject({ message: { sender: 'sid-1' } })
  })

  it('ignores callbacks that are not text messages', () => {
    expect(translateDingtalkCallback(textPayload({ msgtype: 'picture' }))).toBeUndefined()
  })

  it('refuses a callback without a usable msgtype', () => {
    expect(() => translateDingtalkCallback(textPayload({ msgtype: '' }))).toThrow(DingtalkCallbackError)
    expect(() => translateDingtalkCallback(textPayload({ msgtype: undefined })))
      .toThrow('msgtype must be a non-empty string')
    expect(() => translateDingtalkCallback(textPayload({ msgtype: '' })))
      .toThrow('msgtype must be a non-empty string')
  })

  it('refuses a session webhook that is not an absolute https URL', () => {
    expect(() => translateDingtalkCallback(textPayload({ sessionWebhook: '' })))
      .toThrow('sessionWebhook must be a non-empty string')
    expect(() => translateDingtalkCallback(textPayload({ sessionWebhook: 'not-a-url' })))
      .toThrow('must be an absolute URL')
    expect(() => translateDingtalkCallback(textPayload({ sessionWebhook: 'http://oapi.dingtalk.com/x' })))
      .toThrow('must be an https URL')
  })

  it('refuses a missing or non-positive session expiry', () => {
    expect(() => translateDingtalkCallback(textPayload({ sessionWebhookExpiredTime: undefined })))
      .toThrow('must be a positive integer')
    expect(() => translateDingtalkCallback(textPayload({ sessionWebhookExpiredTime: 'soon' })))
      .toThrow('must be a positive integer')
    expect(() => translateDingtalkCallback(textPayload({ sessionWebhookExpiredTime: 0 })))
      .toThrow('must be a positive integer')
  })

  it('refuses structurally invalid text callbacks', () => {
    expect(() => translateDingtalkCallback(textPayload({ conversationId: '' })))
      .toThrow('conversationId must be a non-empty string')
    expect(() => translateDingtalkCallback(textPayload({ msgId: undefined })))
      .toThrow('msgId must be a non-empty string')
    expect(() => translateDingtalkCallback(textPayload({ senderStaffId: undefined, senderId: undefined })))
      .toThrow('sender id must be a non-empty string')
    expect(() => translateDingtalkCallback(textPayload({ text: undefined })))
      .toThrow('text content must be a non-empty string')
    expect(() => translateDingtalkCallback(textPayload({ text: { content: '  ' } })))
      .toThrow('text content must be a non-empty string')
  })
})
