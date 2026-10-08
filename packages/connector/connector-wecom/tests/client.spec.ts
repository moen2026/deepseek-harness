import { ConnectorChannelId } from '@deepseek-ai/dsh-connector'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWecomClient, templateCardOf } from '../src/client.ts'

const CORP_ID_REF = credentialRef('DSH_WECOM_CORP_ID')
const CORP_SECRET_REF = credentialRef('DSH_WECOM_CORP_SECRET')

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Context with only the credential service the client reads. */
function fakeContext(values: Record<string, string> = { DSH_WECOM_CORP_ID: 'corp-1', DSH_WECOM_CORP_SECRET: 'secret-1' }): never {
  const map = new Map(Object.entries(values))
  return {
    credentials: {
      resolve: async (ref: string) => {
        const value = map.get(ref)
        return value === undefined ? undefined : { value, source: 'environment' }
      },
    },
  } as never
}

function client(ctx: never): ReturnType<typeof createWecomClient> {
  return createWecomClient(ctx, {
    apiBaseUrl: 'https://qyapi.weixin.qq.com',
    corpIdRef: CORP_ID_REF,
    corpSecretRef: CORP_SECRET_REF,
    agentId: 100_000_2,
    timeoutMs: 1000,
  })
}

function stubFetch(): ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>> {
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockImplementation(async (url: string) => {
      if (url.includes('/cgi-bin/gettoken')) {
        return Response.json({ errcode: 0, errmsg: 'ok', access_token: 'token-1', expires_in: 7200 })
      }
      return Response.json({ errcode: 0, errmsg: 'ok' })
    })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('templateCardOf', () => {
  it('renders one button per action with the style hint and the action id behind the key prefix', () => {
    expect(templateCardOf({
      text: 'Run the tool?',
      actions: [
        { id: 'a1', label: 'Approve', style: 'primary' },
        { id: 'a2', label: 'Reject' },
      ],
    }, 'task-1')).toEqual({
      card_type: 'text_notice',
      main_title: { title: 'DSH' },
      sub_title_text: 'Run the tool?',
      task_id: 'task-1',
      button_list: [
        { type: 1, key: 'dsh-a1', name: 'Approve', style: 1 },
        { type: 1, key: 'dsh-a2', name: 'Reject', style: 2 },
      ],
    })
  })
})

describe('createWecomClient', () => {
  it('exchanges a token then posts plain text with the agent id and member as touser', async () => {
    const fetchMock = stubFetch()
    await client(fakeContext()).push(ConnectorChannelId('u-1'), { title: 'T', text: 'hello' })
    const [tokenUrl] = fetchMock.mock.calls[0]!
    expect(tokenUrl).toContain('/cgi-bin/gettoken?')
    expect(tokenUrl).toContain('corpid=corp-1')
    expect(tokenUrl).toContain('corpsecret=secret-1')
    const [sendUrl, sendInit] = fetchMock.mock.calls[1]!
    expect(sendUrl).toBe('https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=token-1')
    expect(JSON.parse(sendInit?.body as string)).toEqual({
      touser: 'u-1',
      msgtype: 'text',
      agentid: 100_000_2,
      text: { content: 'T\nhello' },
    })
  })

  it('posts a template card when the message carries actions', async () => {
    const fetchMock = stubFetch()
    await client(fakeContext()).push(ConnectorChannelId('u-1'), { text: 'Run?', actions: [{ id: 'a1', label: 'Go' }] })
    const [, sendInit] = fetchMock.mock.calls[1]!
    const card = JSON.parse(sendInit?.body as string) as {
      msgtype: string
      template_card: { card_type: string; task_id: string }
    }
    expect(card).toMatchObject({ msgtype: 'template_card', template_card: { card_type: 'text_notice' } })
    expect(card.template_card.task_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('caches the access token across sends until it expires', async () => {
    const fetchMock = stubFetch()
    const wecom = client(fakeContext())
    await wecom.push(ConnectorChannelId('u-1'), { text: 'one' })
    await wecom.push(ConnectorChannelId('u-1'), { text: 'two' })
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/gettoken'))).toHaveLength(1)
  })

  it('re-exchanges a token that expires within the refresh margin', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(async (url: string) => {
        if (url.includes('/cgi-bin/gettoken')) {
          return Response.json({ errcode: 0, errmsg: 'ok', access_token: 'token-1', expires_in: 30 })
        }
        return Response.json({ errcode: 0, errmsg: 'ok' })
      })
    vi.stubGlobal('fetch', fetchMock)
    const wecom = client(fakeContext())
    await wecom.push(ConnectorChannelId('u-1'), { text: 'one' })
    await wecom.push(ConnectorChannelId('u-1'), { text: 'two' })
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/gettoken'))).toHaveLength(2)
  })

  it('shares one token exchange across concurrent sends', async () => {
    const fetchMock = stubFetch()
    const wecom = client(fakeContext())
    await Promise.all([
      wecom.push(ConnectorChannelId('u-1'), { text: 'one' }),
      wecom.push(ConnectorChannelId('u-1'), { text: 'two' }),
    ])
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/gettoken'))).toHaveLength(1)
  })

  it('maps an API errcode onto WECOM_DELIVERY_FAILED with the errmsg', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(async () => Response.json({ errcode: 81013, errmsg: 'user not found' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(client(fakeContext()).push(ConnectorChannelId('u-1'), { text: 'hi' }))
      .rejects.toThrow('user not found')
  })

  it('refuses a token exchange without the corp credentials', async () => {
    const fetchMock = stubFetch()
    await expect(client(fakeContext({})).push(ConnectorChannelId('u-1'), { text: 'hi' }))
      .rejects.toMatchObject({ code: 'WECOM_CREDENTIALS_UNAVAILABLE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
