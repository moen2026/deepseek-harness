import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Video } from '@deepseek-ai/dsh-video'
import * as VideoVolc from '../src/index.ts'
import {
  VIDEO_VOLC_DEFAULT_POLL_INTERVAL_MS,
  VIDEO_VOLC_DEFAULT_TIMEOUT_MS,
} from '../src/index.ts'
import {
  ARK_CHAT_COMPLETIONS_PATH,
  ARK_CONTENT_GENERATION_TASKS_PATH,
  ARK_TASK_GET_PATH,
  createVolcVideoGenerator,
  VOLC_CONTENT_SIZES,
  VOLC_DEFAULT_ARK_BASE_URL,
  VOLC_DEFAULT_MODEL,
  VOLC_SIZES,
} from '../src/generate.ts'
import {
  createVolcAssetClient,
  VOLC_ASSET_API_VERSION,
  VOLC_DEFAULT_ASSET_BASE_URL,
} from '../src/asset.ts'

const ARK_CONFIG = { authEnv: 'VIDEO_VOLC_TEST_KEY', pollIntervalMs: 1, timeoutMs: 1000 }
const ASSET_CONFIG = {
  assetAuthEnv: 'VIDEO_VOLC_TEST_AK',
  assetSecretEnv: 'VIDEO_VOLC_TEST_SK',
  project: 'default',
  pollIntervalMs: 1,
  timeoutMs: 1000,
}
const VIDEO_URL = 'https://cdn.example.invalid/out.mp4'

/** Canned answers for the request kinds one generation or assetization makes, overridable per test. */
interface ApiOverrides {
  submit?: () => Response
  task?: () => Response
  action?: (url: string) => Response
  download?: () => Response
}

/** Route each fetch call to a canned submission, task, control-plane, or download answer. */
function stubApi(overrides: ApiOverrides = {}) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url, init) => {
    if (url.includes(ARK_CHAT_COMPLETIONS_PATH)) {
      return overrides.submit?.() ?? Response.json({ TaskId: 'task-1' })
    }
    if (url.includes(ARK_CONTENT_GENERATION_TASKS_PATH)) {
      return (init.method ?? 'GET') === 'POST'
        ? overrides.submit?.() ?? Response.json({ id: 'task-1' })
        : overrides.task?.() ?? Response.json({ id: 'task-1', status: 'succeeded', content: { video_url: VIDEO_URL } })
    }
    if (url.includes(ARK_TASK_GET_PATH)) {
      return overrides.task?.() ?? Response.json({ Status: 'Success', VideoUrl: VIDEO_URL })
    }
    if (url.includes('Action=')) {
      return overrides.action?.(url) ?? Response.json({ ResponseMetadata: {}, Result: {} })
    }
    return overrides.download?.() ?? new Response(new Uint8Array([0, 0, 0, 24]), { headers: { 'content-type': 'video/mp4' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** One control-plane fetch call's action name, JSON body, URL, and authorization header. */
interface ActionCall {
  action: string
  body: Record<string, unknown>
  url: string
  authorization: string | undefined
}

/** Every control-plane fetch call the mock has answered. */
function actionCalls(fetchMock: ReturnType<typeof stubApi>): ActionCall[] {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url, init }))
    .filter(({ url }) => url.includes('Action='))
    .map(({ url, init }) => ({
      action: new URL(url).searchParams.get('Action')!,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
      url,
      authorization: (init.headers as Record<string, string>).authorization,
    }))
}

/** One control-plane answer whose Result carries the given fields. */
function actionResult(result: Record<string, unknown>): Response {
  return Response.json({ ResponseMetadata: {}, Result: result })
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.VIDEO_VOLC_TEST_KEY
  delete process.env.VIDEO_VOLC_TEST_AK
  delete process.env.VIDEO_VOLC_TEST_SK
})

describe('createVolcVideoGenerator', () => {
  it('submits the prompt with its hints, polls until the task settles, and downloads the video', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    let polls = 0
    const fetchMock = stubApi({
      task: () => {
        polls += 1
        return Response.json({ Status: polls === 1 ? 'Running' : 'Success', VideoUrl: VIDEO_URL })
      },
    })
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    const result = await generator({
      prompt: 'a cat',
      size: '1920x1080',
      duration: 5,
      referenceImage: 'https://ref.example/a.png',
      aspectRatio: '16:9',
    })
    expect(result.mediaType).toBe('video/mp4')
    expect(result.data.length).toBe(4)
    expect(polls).toBe(2)

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const [submitUrl, submitInit] = fetchMock.mock.calls[0]!
    expect(submitUrl).toBe(`${VOLC_DEFAULT_ARK_BASE_URL}${ARK_CHAT_COMPLETIONS_PATH}`)
    expect((submitInit.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(submitInit.body as string)).toEqual({
      model: 'seedance-2.0',
      messages: [
        { type: 'image_url', image_url: { url: 'https://ref.example/a.png' }, role: 'reference_image' },
        { role: 'user', content: 'a cat' },
      ],
      duration: 5,
      size: '1080p',
    })

    const [taskUrl, taskInit] = fetchMock.mock.calls[1]!
    expect(taskUrl).toBe(`${VOLC_DEFAULT_ARK_BASE_URL}${ARK_TASK_GET_PATH}`)
    expect(JSON.parse(taskInit.body as string)).toEqual({ ProjectName: 'default', TaskId: 'task-1' })

    expect(fetchMock.mock.calls[3]![0]).toBe(VIDEO_URL)
  })

  it('omits every optional hint the request does not carry', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    await generator({ prompt: 'a cat' })
    const [, submitInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(submitInit.body as string)).toEqual({
      model: 'seedance-2.0',
      messages: [{ role: 'user', content: 'a cat' }],
    })
  })

  it('normalizes a multiplication-sign size hint and maps pixel pairs by their shorter side', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    await generator({ prompt: 'a cat', size: ' 1280×720 ' })
    await generator({ prompt: 'a cat', size: '720p' })
    await generator({ prompt: 'a cat', size: '1080p' })
    await generator({ prompt: 'a cat', size: '640x360' })
    const bodies = fetchMock.mock.calls
      .filter(([url]) => url.includes(ARK_CHAT_COMPLETIONS_PATH))
      .map(([, init]) => JSON.parse(init.body as string) as Record<string, unknown>)
    expect(bodies.map(body => body.size)).toEqual(['720p', '720p', '1080p', '720p'])
  })

  it('keeps the configured defaults honest', () => {
    expect(VOLC_DEFAULT_ARK_BASE_URL).toBe('https://ark.cn-beijing.volces.com')
    expect(ARK_CHAT_COMPLETIONS_PATH).toBe('/api/v3/ark/chat/completions')
    expect(ARK_TASK_GET_PATH).toBe('/api/v3/ark/task/get')
    expect(VOLC_DEFAULT_MODEL).toBe('seedance-2.0')
    expect(VOLC_SIZES).toEqual(['720p', '1080p'])
  })

  it('rejects an uninterpretable size hint before any I/O', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    await expect(generator({ prompt: 'a cat', size: 'gigantic' })).rejects.toMatchObject({
      code: 'VIDEO_INVALID_REQUEST',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-integer or non-positive duration before any I/O', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    await expect(generator({ prompt: 'a cat', duration: 2.5 })).rejects.toMatchObject({
      code: 'VIDEO_INVALID_REQUEST',
    })
    await expect(generator({ prompt: 'a cat', duration: 0 })).rejects.toMatchObject({
      code: 'VIDEO_INVALID_REQUEST',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when the configured environment variable is unset', async () => {
    const generator = createVolcVideoGenerator(ARK_CONFIG)
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/VIDEO_VOLC_TEST_KEY/)
  })

  it('surfaces a failed task status with its endpoint message', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    stubApi({ task: () => Response.json({ Status: 'Failed', Message: 'content policy' }) })
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/content policy/)
  })

  it('accepts the lowercase status and message fields the endpoint documents', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    stubApi({ task: () => Response.json({ status: 'Success', videoUrl: VIDEO_URL }) })
    const generator = createVolcVideoGenerator(ARK_CONFIG)
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('video/mp4')

    stubApi({ task: () => Response.json({ status: 'Failed', message: '' }) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/generation failed: unknown error/)
  })

  it('surfaces task and download transport failures as provider failures', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    stubApi({ task: () => { throw new Error('socket hang up') } })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/task request failed: Error: socket hang up/)

    stubApi({ download: () => { throw new Error('socket hang up') } })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/video download failed: Error: socket hang up/)
  })

  it('surfaces an interrupted task body read as a provider failure', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    stubApi({
      task: () => new Response(
        new ReadableStream({ start(controller) { controller.error(new Error('interrupted')) } }),
        { headers: { 'content-type': 'application/json' } },
      ),
    })
    const generator = createVolcVideoGenerator(ARK_CONFIG)
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/task endpoint body read failed/)
  })

  it('rejects a settled task without a video URL and a submission without a task id', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    stubApi({ task: () => Response.json({ Status: 'Success' }) })
    const generator = createVolcVideoGenerator(ARK_CONFIG)
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/carried no video URL/)

    stubApi({ submit: () => Response.json({ choices: [] }) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/carried no task id/)
  })

  it('falls back through the response id fields when the submission carries no TaskId', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi({ submit: () => Response.json({ id: 'task-2' }) })
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    await generator({ prompt: 'a cat' })
    expect(fetchMock.mock.calls[1]![0]).toBe(`${VOLC_DEFAULT_ARK_BASE_URL}${ARK_TASK_GET_PATH}`)
  })

  it('surfaces non-JSON endpoint bodies and non-object payloads as provider failures', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    stubApi({ submit: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/submission endpoint returned a non-JSON body/)

    stubApi({ submit: () => Response.json(null) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/submission endpoint returned a non-JSON body/)

    stubApi({ task: () => Response.json([1]) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/task endpoint returned a non-JSON body/)
  })

  it('surfaces HTTP status failures on both endpoints and the download', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    stubApi({ submit: () => new Response('', { status: 401 }) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/submission endpoint responded 401/)

    stubApi({ task: () => new Response('', { status: 500 }) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/task endpoint responded 500/)

    stubApi({ download: () => new Response('', { status: 403 }) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/video download responded 403/)
  })

  it('surfaces a failed download body read as a provider failure', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    stubApi({
      download: () => new Response(new ReadableStream({
        start(controller) {
          controller.error(new Error('interrupted'))
        },
      })),
    })
    const generator = createVolcVideoGenerator(ARK_CONFIG)
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/video download body read failed/)
  })

  it('redacts the credential out of transport diagnostics', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 's3cret:value'
    stubApi({
      submit: () => {
        throw new Error('connect ECONNREFUSED for key s3cret:value and s3cret%3Avalue')
      },
    })
    const generator = createVolcVideoGenerator(ARK_CONFIG)

    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/ECONNREFUSED for key \*\*\* and \*\*\*/)
    await expect(generator({ prompt: 'a cat' })).rejects.not.toThrow(/s3cret/)
  })

  it('resolves the media type from the content type, then the URL extension', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const bytes = new Uint8Array([1])
    stubApi({ download: () => new Response(bytes, { headers: { 'content-type': 'video/webm; charset=binary' } }) })
    const generator = createVolcVideoGenerator(ARK_CONFIG)
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('video/webm')

    // An opaque content type sends the resolver to the URL extension.
    const opaque = () => new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
    stubApi({
      task: () => Response.json({ Status: 'Success', VideoUrl: 'https://cdn.example.invalid/clip.mov?sig=1' }),
      download: opaque,
    })
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('video/quicktime')

    stubApi({
      task: () => Response.json({ Status: 'Success', VideoUrl: 'https://cdn.example.invalid/clip.webm' }),
      download: opaque,
    })
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('video/webm')

    stubApi({
      task: () => Response.json({ Status: 'Success', VideoUrl: 'https://cdn.example.invalid/clip' }),
      download: opaque,
    })
    expect((await generator({ prompt: 'a cat' })).mediaType).toBe('video/mp4')
  })

  it('reports an elapsed overall timeout once the timeout signal aborts mid-poll', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    stubApi({ task: () => Response.json({ Status: 'Running' }) })
    const generator = createVolcVideoGenerator({ ...ARK_CONFIG, timeoutMs: 5 })

    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/polling was interrupted: timed out/)
  })

  it('honors an already-aborted caller signal at the next poll', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    stubApi({ task: () => Response.json({ Status: 'Running' }) })
    const generator = createVolcVideoGenerator(ARK_CONFIG)
    const controller = new AbortController()
    controller.abort()

    await expect(generator({ prompt: 'a cat' }, controller.signal)).rejects.toThrow(/polling was interrupted/)
  })
})

describe('content-generation task family', () => {
  it('submits a content array and polls the task path when the model speaks seedance 2.5', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    let polls = 0
    const fetchMock = stubApi({
      task: () => {
        polls += 1
        return polls === 1
          ? Response.json({ id: 'task-1', status: 'running' })
          : Response.json({ id: 'task-1', status: 'succeeded', content: { video_url: VIDEO_URL } })
      },
    })
    const generator = createVolcVideoGenerator({
      ...ARK_CONFIG,
      model: 'doubao-seedance-2-5-260628',
      generateAudio: true,
      referenceTaskType: 'reference',
    })

    const result = await generator({
      prompt: 'a crisp-bite ad',
      referenceImage: 'https://ref.example/a.png',
      referenceVideo: 'https://ref.example/b.mp4',
      referenceAudio: 'https://ref.example/c.mp3',
      aspectRatio: '16:9',
      size: '1920x1080',
      duration: 15,
    })
    expect(result.mediaType).toBe('video/mp4')
    expect(polls).toBe(2)

    const [submitUrl, submitInit] = fetchMock.mock.calls[0]!
    expect(submitUrl).toBe(`${VOLC_DEFAULT_ARK_BASE_URL}${ARK_CONTENT_GENERATION_TASKS_PATH}`)
    expect(JSON.parse(submitInit.body as string)).toEqual({
      model: 'doubao-seedance-2-5-260628',
      content: [
        { type: 'text', text: 'a crisp-bite ad' },
        { type: 'image_url', image_url: { url: 'https://ref.example/a.png' }, role: 'reference_image' },
        { type: 'video_url', video_url: { url: 'https://ref.example/b.mp4' }, role: 'reference_video' },
        { type: 'audio_url', audio_url: { url: 'https://ref.example/c.mp3' }, role: 'reference_audio' },
      ],
      duration: 15,
      ratio: '16:9',
      resolution: '1080p',
      generate_audio: true,
      extra_body: { omni_reference_task_type: 'reference' },
    })
    expect(fetchMock.mock.calls[1]![0]).toBe(`${VOLC_DEFAULT_ARK_BASE_URL}${ARK_CONTENT_GENERATION_TASKS_PATH}/task-1`)
    expect(fetchMock.mock.calls[3]![0]).toBe(VIDEO_URL)
  })

  it('omits every optional hint the request and config do not carry', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createVolcVideoGenerator({ ...ARK_CONFIG, model: 'doubao-seedance-2-5-260628' })

    await generator({ prompt: 'a cat' })
    const [, submitInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(submitInit.body as string)).toEqual({
      model: 'doubao-seedance-2-5-260628',
      content: [{ type: 'text', text: 'a cat' }],
    })
  })

  it('maps pixel pairs and tokens onto the 480p/720p/1080p resolution tiers', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createVolcVideoGenerator({ ...ARK_CONFIG, model: 'doubao-seedance-2-5-260628' })

    await generator({ prompt: 'a cat', size: ' 640×480 ' })
    await generator({ prompt: 'a cat', size: '1280x720' })
    await generator({ prompt: 'a cat', size: '1080p' })
    await expect(generator({ prompt: 'a cat', size: 'gigantic' })).rejects.toMatchObject({
      code: 'VIDEO_INVALID_REQUEST',
    })
    const resolutions = fetchMock.mock.calls
      .filter(([url, init]) => url.includes(ARK_CONTENT_GENERATION_TASKS_PATH) && init.method === 'POST')
      .map(([, init]) => (JSON.parse(init.body as string) as { resolution?: string }).resolution)
    expect(resolutions).toEqual(['480p', '720p', '1080p'])
  })

  it('passes the automatic-duration sentinel through and keeps invalid durations rejected', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createVolcVideoGenerator({ ...ARK_CONFIG, model: 'doubao-seedance-2-5-260628' })

    await generator({ prompt: 'a cat', duration: -1 })
    await expect(createVolcVideoGenerator(ARK_CONFIG)({ prompt: 'a cat', duration: -1 })).rejects.toMatchObject({
      code: 'VIDEO_INVALID_REQUEST',
    })
    const contentDurations = fetchMock.mock.calls
      .filter(([url, init]) => url.includes(ARK_CONTENT_GENERATION_TASKS_PATH) && init.method === 'POST')
      .map(([, init]) => (JSON.parse(init.body as string) as { duration?: number }).duration)
    expect(contentDurations).toEqual([-1])
  })

  it('routes official doubao-seedance model ids to the content-generation family', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const generator = createVolcVideoGenerator({ ...ARK_CONFIG, model: 'doubao-seedance-1-0-pro-250528' })

    await generator({ prompt: 'a daisy field', aspectRatio: '16:9', duration: 5 })
    expect(fetchMock.mock.calls[0]![0]).toBe(`${VOLC_DEFAULT_ARK_BASE_URL}${ARK_CONTENT_GENERATION_TASKS_PATH}`)
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      model: 'doubao-seedance-1-0-pro-250528',
      content: [{ type: 'text', text: 'a daisy field' }],
      ratio: '16:9',
      duration: 5,
    })
  })

  it('surfaces a failed content-generation status and a settlement without content', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const generator = createVolcVideoGenerator({ ...ARK_CONFIG, model: 'doubao-seedance-2-5-260628' })

    stubApi({ task: () => Response.json({ status: 'failed', error: { code: 'InvalidParameter', message: 'bad prompt' } }) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/generation failed: bad prompt/)

    stubApi({ task: () => Response.json({ status: 'failed', error: 'quota exceeded' }) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/generation failed: quota exceeded/)

    stubApi({ task: () => Response.json({ status: 'succeeded' }) })
    await expect(generator({ prompt: 'a cat' })).rejects.toThrow(/carried no video URL/)
  })

  it('keeps the content-generation defaults honest', () => {
    expect(ARK_CONTENT_GENERATION_TASKS_PATH).toBe('/api/v3/contents/generations/tasks')
    expect(VOLC_CONTENT_SIZES).toEqual(['480p', '720p', '1080p'])
  })
})

describe('createVolcAssetClient', () => {
  it('requires both credential environment variables to be set', async () => {
    const client = createVolcAssetClient(ASSET_CONFIG)
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/must both be set/)

    process.env.VIDEO_VOLC_TEST_AK = ''
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/must both be set/)

    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/must both be set/)

    process.env.VIDEO_VOLC_TEST_SK = ''
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/must both be set/)
  })

  it('registers a reference into a new group and polls its review to Active', async () => {
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    let assetPolls = 0
    const fetchMock = stubApi({
      action: (url) => {
        const action = new URL(url).searchParams.get('Action')
        if (action === 'CreateAssetGroup') return actionResult({ Id: 'group-1' })
        if (action === 'CreateAsset') return actionResult({ Id: 'asset-1' })
        assetPolls += 1
        return actionResult(assetPolls === 1 ? { Status: 'Processing' } : { Status: 'Active' })
      },
    })
    const client = createVolcAssetClient(ASSET_CONFIG)

    const reference = await client.assetize('https://ref.example/River%20Dance.png')
    expect(reference).toBe('asset://asset-1')

    const calls = actionCalls(fetchMock)
    expect(calls.map(call => call.action)).toEqual(['CreateAssetGroup', 'CreateAsset', 'GetAsset', 'GetAsset'])
    expect(calls[0]!.body).toEqual({ Filter: { ProjectName: 'default' }, Name: 'dsh-video-volc', Type: 'AIGC' })
    expect(calls[1]!.body).toEqual({
      Filter: { ProjectName: 'default' },
      GroupId: 'group-1',
      Name: 'River Dance',
      AssetType: 'Image',
      URL: 'https://ref.example/River%20Dance.png',
    })
    expect(calls[2]!.body).toEqual({ Filter: { ProjectName: 'default' }, Id: 'asset-1' })
    expect(calls[0]!.authorization).toMatch(
      /^HMAC-SHA256 Credential=ak\/\d{8}\/cn-beijing\/ark\/request, SignedHeaders=content-type;host;x-date, Signature=[0-9a-f]{64}$/,
    )
    expect(new URL(calls[0]!.url).searchParams.get('Version')).toBe(VOLC_ASSET_API_VERSION)
  })

  it('reuses the configured group and derives the asset name from the URL stem', async () => {
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    const fetchMock = stubApi({
      action: (url) => {
        const action = new URL(url).searchParams.get('Action')
        if (action === 'CreateAsset') return actionResult({ Id: 'asset-2' })
        return actionResult({ Status: 'Active' })
      },
    })
    const client = createVolcAssetClient({ ...ASSET_CONFIG, groupId: 'group-known' })

    expect(await client.assetize('https://ref.example/pics/poster.jpg?x=1')).toBe('asset://asset-2')
    expect(await client.assetize('https://ref.example/')).toBe('asset://asset-2')
    const calls = actionCalls(fetchMock)
    expect(calls.every(call => call.action !== 'CreateAssetGroup')).toBe(true)
    expect(calls.filter(call => call.action === 'CreateAsset').map(call => call.body.Name))
      .toEqual(['poster', 'reference'])
  })

  it('surfaces the OpenAPI error envelope and control-plane failures as provider failures', async () => {
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    const client = createVolcAssetClient(ASSET_CONFIG)

    stubApi({
      action: () => Response.json({ ResponseMetadata: { Error: { Code: 'InvalidParameter', Message: 'bad group' } } }),
    })
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/InvalidParameter bad group/)

    stubApi({ action: () => new Response('', { status: 500 }) })
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/control-plane CreateAssetGroup responded 500/)

    stubApi({ action: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) })
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/returned a non-JSON body/)

    stubApi({ action: () => Response.json('plain') })
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/returned a non-JSON body/)

    stubApi({
      action: () => new Response(new ReadableStream({
        start(controller) {
          controller.error(new Error('interrupted'))
        },
      }), { headers: { 'content-type': 'application/json' } }),
    })
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/body read failed/)
  })

  it('rejects group and asset creations that carry no id', async () => {
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    stubApi({ action: () => actionResult({}) })

    const client = createVolcAssetClient(ASSET_CONFIG)
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/CreateAssetGroup response carried no group id/)

    const known = createVolcAssetClient({ ...ASSET_CONFIG, groupId: 'group-known' })
    await expect(known.assetize('https://ref.example/a.png')).rejects.toThrow(/CreateAsset response carried no asset id/)
  })

  it('rejects a failed review with its message', async () => {
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    stubApi({
      action: url => actionResult(
        new URL(url).searchParams.get('Action') === 'CreateAsset' ? { Id: 'asset-4' } : { Status: 'Failed', Message: 'policy rejection' },
      ),
    })
    const client = createVolcAssetClient({ ...ASSET_CONFIG, groupId: 'group-known' })
    await expect(client.assetize('https://ref.example/a.png')).rejects.toThrow(/failed review: policy rejection/)
  })

  it('honors an already-aborted caller signal while polling the asset review', async () => {
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    stubApi({ action: url => actionResult(new URL(url).searchParams.get('Action') === 'CreateAsset' ? { Id: 'asset-3' } : { Status: 'Processing' }) })
    const client = createVolcAssetClient({ ...ASSET_CONFIG, groupId: 'group-known' })
    const controller = new AbortController()
    controller.abort()

    await expect(client.assetize('https://ref.example/a.png', controller.signal)).rejects.toThrow(/asset polling was interrupted/)
  })

  it('surfaces a control-plane transport failure and answers bare payloads without envelopes', async () => {
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    const bare = createVolcAssetClient({ ...ASSET_CONFIG, groupId: 'group-known' })

    stubApi({ action: () => { throw new Error('boom') } })
    await expect(bare.assetize('https://ref.example/a.png')).rejects.toThrow(/CreateAsset request failed: Error: boom/)

    stubApi({
      action: url => new URL(url).searchParams.get('Action') === 'CreateAsset'
        ? Response.json({ Id: 'asset-5' })
        : Response.json({ Status: 'Active' }),
    })
    expect(await bare.assetize('https://ref.example/a.png')).toBe('asset://asset-5')
  })

  it('keeps the control-plane defaults honest', () => {
    expect(VOLC_DEFAULT_ASSET_BASE_URL).toBe('https://ark.cn-beijing.volcengineapi.com')
    expect(VOLC_ASSET_API_VERSION).toBe('2024-01-01')
  })
})

describe('VideoVolc plugin', () => {
  it('registers a video-volc provider that routes through the generator', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    stubApi()
    const ctx = new Context()
    await ctx.plugin(Video)
    await ctx.plugin(VideoVolc, ARK_CONFIG)

    const result = await ctx.video.generate({ prompt: 'a cat' })
    expect(result.mediaType).toBe('video/mp4')
    expect(result.data).toEqual(new Uint8Array([0, 0, 0, 24]))
  })

  it('mounts without optional fields, falling back to the defaults', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    const fetchMock = stubApi()
    const ctx = new Context()
    await ctx.plugin(Video)
    // The schema fills the timing defaults on a plugin mount, so a direct apply is the only path
    // that exercises the omitted-optional branches.
    VideoVolc.apply(ctx, { authEnv: ARK_CONFIG.authEnv })

    const result = await ctx.video.generate({ prompt: 'a cat', referenceImage: 'https://ref.example/a.png' })
    expect(result.mediaType).toBe('video/mp4')
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>
    expect(body.model).toBe('seedance-2.0')
  })

  it('assetizes a public reference image before generation when the control plane is configured', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    const fetchMock = stubApi({
      action: (url) => {
        const action = new URL(url).searchParams.get('Action')
        if (action === 'CreateAssetGroup') return actionResult({ Id: 'group-1' })
        if (action === 'CreateAsset') return actionResult({ Id: 'asset-1' })
        return actionResult({ Status: 'Active' })
      },
    })
    const ctx = new Context()
    await ctx.plugin(Video)
    await ctx.plugin(VideoVolc, {
      ...ARK_CONFIG,
      ...ASSET_CONFIG,
      region: 'cn-beijing',
      assetGroupId: 'group-1',
      assetBaseURL: `${VOLC_DEFAULT_ASSET_BASE_URL}/`,
    })

    await ctx.video.generate({ prompt: 'a cat', referenceImage: 'https://ref.example/a.png' })
    const submitCall = fetchMock.mock.calls.find(([url]) => url.includes(ARK_CHAT_COMPLETIONS_PATH))!
    const submitBody = JSON.parse(submitCall[1].body as string) as {
      messages: Array<{ role: string; image_url?: { url: string } }>
    }
    expect(submitBody.messages[0]!.role).toBe('reference_image')
    expect(submitBody.messages[0]!.image_url!.url).toBe('asset://asset-1')
  })

  it('assetizes references before a seedance 2.5 content-generation submission', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    const fetchMock = stubApi({
      action: (url) => {
        const action = new URL(url).searchParams.get('Action')
        if (action === 'CreateAssetGroup') return actionResult({ Id: 'group-1' })
        if (action === 'CreateAsset') return actionResult({ Id: 'asset-1' })
        return actionResult({ Status: 'Active' })
      },
    })
    const ctx = new Context()
    await ctx.plugin(Video)
    await ctx.plugin(VideoVolc, {
      ...ARK_CONFIG,
      ...ASSET_CONFIG,
      model: 'doubao-seedance-2-5-260628',
      generateAudio: true,
      referenceTaskType: 'reference',
    })

    await ctx.video.generate({ prompt: 'a cat', referenceImage: 'https://ref.example/a.png' })
    const submitCall = fetchMock.mock.calls.find(
      ([url, init]) => url.includes(ARK_CONTENT_GENERATION_TASKS_PATH) && init.method === 'POST',
    )!
    const submitBody = JSON.parse(submitCall[1].body as string) as {
      content: Array<{ role?: string; image_url?: { url: string } }>
      generate_audio?: boolean
      extra_body?: { omni_reference_task_type?: string }
    }
    expect(submitBody.content[1]!.role).toBe('reference_image')
    expect(submitBody.content[1]!.image_url!.url).toBe('asset://asset-1')
    expect(submitBody.generate_audio).toBe(true)
    expect(submitBody.extra_body).toEqual({ omni_reference_task_type: 'reference' })
  })

  it('routes a generation without a reference image straight to the generator even with the control plane configured', async () => {
    process.env.VIDEO_VOLC_TEST_KEY = 'secret'
    process.env.VIDEO_VOLC_TEST_AK = 'ak'
    process.env.VIDEO_VOLC_TEST_SK = 'sk'
    const fetchMock = stubApi()
    const ctx = new Context()
    await ctx.plugin(Video)
    await ctx.plugin(VideoVolc, { ...ARK_CONFIG, ...ASSET_CONFIG, model: 'seedance-2.0' })

    await ctx.video.generate({ prompt: 'a cat' })
    expect(fetchMock.mock.calls.every(([url]) => !url.includes('Action='))).toBe(true)
  })

  it('creates the asset client at mount without touching the control plane', async () => {
    stubApi()
    const ctx = new Context()
    await ctx.plugin(Video)
    // The bare config exercises the omitted project, base URL, region, group, and timing branches.
    VideoVolc.apply(ctx, { authEnv: 'X', assetAuthEnv: 'A', assetSecretEnv: 'B' })
  })

  it('refuses a half-configured control plane at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(Video)
    expect(() => { VideoVolc.apply(ctx, { ...ARK_CONFIG, assetSecretEnv: ASSET_CONFIG.assetSecretEnv }) })
      .toThrow(/assetAuthEnv and assetSecretEnv must be configured together/)
  })

  it('keeps the configured defaults honest', () => {
    expect(VIDEO_VOLC_DEFAULT_POLL_INTERVAL_MS).toBe(10_000)
    expect(VIDEO_VOLC_DEFAULT_TIMEOUT_MS).toBe(600_000)
    expect(VideoVolc.Config({ authEnv: 'X' }).pollIntervalMs).toBe(10_000)
    expect(VideoVolc.Config({ authEnv: 'X' }).timeoutMs).toBe(600_000)
    expect(() => VideoVolc.Config({ authEnv: 'X', pollIntervalMs: 0 })).toThrow()
    expect(() => VideoVolc.Config({ authEnv: 'X', timeoutMs: 0 })).toThrow()
  })
})
