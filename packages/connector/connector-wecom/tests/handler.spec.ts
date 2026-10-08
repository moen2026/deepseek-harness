import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  encryptWecomMessage,
  parseWecomXmlFields,
  wecomAesKey,
  wecomSignature,
} from '../src/callback.ts'
import { createWecomCallbackHandler } from '../src/handler.ts'

const TOKEN = 'token-1'
const AES_KEY = wecomAesKey('A'.repeat(43))
const CORP_ID = 'corp-1'
const TOKEN_REF = credentialRef('DSH_WECOM_TOKEN')
const AES_KEY_REF = credentialRef('DSH_WECOM_AES_KEY')
const CORP_ID_REF = credentialRef('DSH_WECOM_CORP_ID')

/** Credential map keyed by the env name each ref carries, plus the deliver observation. */
function fakeContext(
  values: Record<string, string> = {
    DSH_WECOM_TOKEN: TOKEN,
    DSH_WECOM_AES_KEY: 'A'.repeat(43),
    DSH_WECOM_CORP_ID: CORP_ID,
  },
  deliverImpl?: () => Promise<string>,
): { ctx: Context; deliver: ReturnType<typeof vi.fn> } {
  const map = new Map(Object.entries(values))
  const deliver = deliverImpl === undefined ? vi.fn(async () => 'queued') : vi.fn(deliverImpl)
  return {
    ctx: {
      credentials: {
        resolve: async (ref: string) => {
          const value = map.get(ref)
          return value === undefined ? undefined : { value, source: 'environment' }
        },
      },
      connector: { deliver },
      logger: { warn: vi.fn() },
    } as never,
    deliver,
  }
}

/** Serve one handler on an ephemeral local port and return its base URL. */
async function serve(ctx: Context, maxBodyBytes = 8192): Promise<{ baseUrl: string; close: () => void }> {
  const handler = createWecomCallbackHandler(ctx, {
    callbackTokenRef: TOKEN_REF,
    encodingAesKeyRef: AES_KEY_REF,
    corpIdRef: CORP_ID_REF,
    maxBodyBytes,
  })
  const server = createServer((request, response) => {
    void handler(request, response)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => { server.close() },
  }
}

/** Build the outer encrypted envelope XML exactly as WeCom posts it. */
function envelopeXml(inner: string, nonce: string): string {
  const encrypt = encryptWecomMessage(AES_KEY, inner, CORP_ID)
  const signature = wecomSignature([TOKEN, '1717171717', nonce, encrypt])
  return `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt><MsgSignature>${signature}</MsgSignature>`
    + `<TimeStamp>1717171717</TimeStamp><Nonce>${nonce}</Nonce></xml>`
}

/** One inner text-message document. */
function textXml(content: string, msgId: string): string {
  return '<xml><FromUserName><![CDATA[u-1]]></FromUserName><MsgType><![CDATA[text]]></MsgType>'
    + '<Content><![CDATA[' + content + ']]></Content><MsgId>' + msgId + '</MsgId></xml>'
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WeCom callback handler', () => {
  it('answers the URL-verification GET with the decrypted echo string', async () => {
    const test = fakeContext()
    const server = await serve(test.ctx)
    try {
      const echostr = encryptWecomMessage(AES_KEY, 'plain-echo', CORP_ID)
      const signature = wecomSignature([TOKEN, '1717171717', 'n1', echostr])
      const response = await fetch(`${server.baseUrl}/wecom?msg_signature=${signature}&timestamp=1717171717&nonce=n1&echostr=${encodeURIComponent(echostr)}`)
      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toBe('plain-echo')
      expect(test.deliver).not.toHaveBeenCalled()
    } finally {
      server.close()
    }
  })

  it('delivers a decrypted text message and answers success', async () => {
    const test = fakeContext()
    const server = await serve(test.ctx)
    try {
      const response = await fetch(`${server.baseUrl}/wecom`, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body: envelopeXml(textXml('hello', '7001'), 'n1'),
      })
      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toBe('success')
      expect(test.deliver).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'wecom',
        channel: 'u-1',
        messageId: '7001',
        sender: 'u-1',
        text: 'hello',
      }))
    } finally {
      server.close()
    }
  })

  it('delivers a template-card click as a resolution', async () => {
    const test = fakeContext()
    const server = await serve(test.ctx)
    try {
      const inner = '<xml><FromUserName><![CDATA[u-1]]></FromUserName><Event><![CDATA[template_card_event]]></Event>'
        + '<TaskId>task-7</TaskId><EventKey><![CDATA[dsh-a1]]></EventKey></xml>'
      const response = await fetch(`${server.baseUrl}/wecom`, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body: envelopeXml(inner, 'n2'),
      })
      expect(response.status).toBe(200)
      expect(test.deliver).toHaveBeenCalledWith(expect.objectContaining({
        messageId: 'task-7:dsh-a1',
        resolution: { actionId: 'a1', value: '' },
      }))
    } finally {
      server.close()
    }
  })

  it('answers success without delivery for ignored messages', async () => {
    const test = fakeContext()
    const server = await serve(test.ctx)
    try {
      const inner = '<xml><FromUserName><![CDATA[u-1]]></FromUserName><MsgType><![CDATA[image]]></MsgType><PicUrl><![CDATA[u]]></PicUrl></xml>'
      const response = await fetch(`${server.baseUrl}/wecom`, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body: envelopeXml(inner, 'n3'),
      })
      expect(response.status).toBe(200)
      expect(test.deliver).not.toHaveBeenCalled()
    } finally {
      server.close()
    }
  })

  it('refuses a wrong signature with 401', async () => {
    const test = fakeContext()
    const server = await serve(test.ctx)
    try {
      const response = await fetch(`${server.baseUrl}/wecom`, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body: envelopeXml(textXml('hello', '7002'), 'n4').replace(/<MsgSignature>[^<]+</, '<MsgSignature>deadbeef<'),
      })
      expect(response.status).toBe(401)
      expect(test.deliver).not.toHaveBeenCalled()
    } finally {
      server.close()
    }
  })

  it('refuses a foreign corp id envelope with 401', async () => {
    const test = fakeContext()
    const server = await serve(test.ctx)
    try {
      const encrypt = encryptWecomMessage(AES_KEY, textXml('hello', '7003'), 'corp-other')
      const signature = wecomSignature([TOKEN, '1717171717', 'n5', encrypt])
      const body = `<xml><Encrypt><![CDATA[${encrypt}]]></Encrypt><MsgSignature>${signature}</MsgSignature>`
        + '<TimeStamp>1717171717</TimeStamp><Nonce>n5</Nonce></xml>'
      const response = await fetch(`${server.baseUrl}/wecom`, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body,
      })
      expect(response.status).toBe(401)
    } finally {
      server.close()
    }
  })

  it('refuses other methods, non-XML bodies, oversized bodies, and malformed envelopes', async () => {
    const test = fakeContext()
    const server = await serve(test.ctx)
    try {
      const put = await fetch(server.baseUrl, { method: 'PUT' })
      expect(put.status).toBe(405)
      expect(put.headers.get('allow')).toBe('GET, POST')

      const wrongMedia = await fetch(server.baseUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      expect(wrongMedia.status).toBe(415)

      const oversize = await fetch(server.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body: '<xml>' + 'a'.repeat(9000) + '</xml>',
      })
      expect(oversize.status).toBe(413)

      const noEncrypt = await fetch(server.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body: '<xml><Nonce>n</Nonce></xml>',
      })
      expect(noEncrypt.status).toBe(400)

      const noQuery = await fetch(`${server.baseUrl}/wecom?nonce=n1`)
      expect(noQuery.status).toBe(400)
    } finally {
      server.close()
    }
  })

  it('answers 503 when a credential is unavailable and maps delivery refusals', async () => {
    const test = fakeContext({ DSH_WECOM_CORP_ID: '' })
    const server = await serve(test.ctx)
    try {
      const response = await fetch(`${server.baseUrl}/wecom`, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body: envelopeXml(textXml('hello', '7004'), 'n6'),
      })
      expect(response.status).toBe(503)
    } finally {
      server.close()
    }

    const refusing = fakeContext(undefined, async () => {
      throw new TypeError('not deliverable')
    })
    const deliverable = await serve(refusing.ctx)
    try {
      const response = await fetch(`${deliverable.baseUrl}/wecom`, {
        method: 'POST',
        headers: { 'content-type': 'text/xml' },
        body: envelopeXml(textXml('hello', '7005'), 'n7'),
      })
      expect(response.status).toBe(400)
    } finally {
      deliverable.close()
    }
  })

  it('keeps the outer envelope fields readable from the raw post', () => {
    expect(parseWecomXmlFields(envelopeXml(textXml('x', '1'), 'n8'))).toMatchObject({ TimeStamp: '1717171717', Nonce: 'n8' })
  })
})
