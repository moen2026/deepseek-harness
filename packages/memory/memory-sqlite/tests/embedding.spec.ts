import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { createHttpEmbedder, type EmbeddingConfig } from '../src/embedding.ts'

interface EmbeddingRequest {
  readonly model: string
  readonly input: readonly string[]
  readonly authorization: string | undefined
}

type EndpointReply = { status?: number; body: unknown } | 'hang'

/**
 * Start a local OpenAI-compatible embeddings endpoint that records every request, so the
 * batching, ordering, and rejection paths run against real HTTP instead of a fetch double.
 */
async function serveEmbedding(
  reply: (request: EmbeddingRequest, index: number) => EndpointReply,
): Promise<{ url: string; requests: EmbeddingRequest[]; close: () => Promise<void> }> {
  const requests: EmbeddingRequest[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => { raw += String(chunk) })
    request.on('end', () => {
      const body = JSON.parse(raw) as { model: string; input: string[] }
      const recorded: EmbeddingRequest = {
        model: body.model,
        input: body.input,
        authorization: request.headers.authorization,
      }
      requests.push(recorded)
      const outcome = reply(recorded, requests.length - 1)
      if (outcome === 'hang') return
      response.statusCode = outcome.status ?? 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(outcome.body))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/v1/embeddings`,
    requests,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}

const KEY_ENV = 'DSH_MEMORY_TEST_EMBED_KEY'
const ABSENT_ENV = 'DSH_MEMORY_TEST_EMBED_ABSENT'
const BLANK_ENV = 'DSH_MEMORY_TEST_EMBED_BLANK'

/** A valid endpoint description; tests override only the fields under test. */
function endpoint(url: string, overrides: Partial<EmbeddingConfig> = {}): EmbeddingConfig {
  return { url, model: 'test-embed', authEnv: KEY_ENV, dimension: 2, ...overrides }
}

describe('createHttpEmbedder', () => {
  it('posts the batch with the bearer key and restores input order from the echoed indexes', async () => {
    process.env[KEY_ENV] = 'secret-key'
    const server = await serveEmbedding(call => ({
      body: { data: [...call.input.keys()].reverse().map(index => ({ index, embedding: [0, index + 1] })) },
    }))
    try {
      const embedder = createHttpEmbedder(endpoint(server.url))
      await expect(embedder.embed(['one', 'two'])).resolves.toEqual([[0, 1], [0, 2]])
      expect(server.requests).toHaveLength(1)
      expect(server.requests[0]?.model).toBe('test-embed')
      expect(server.requests[0]?.input).toEqual(['one', 'two'])
      expect(server.requests[0]?.authorization).toBe('Bearer secret-key')
    } finally {
      Reflect.deleteProperty(process.env, KEY_ENV)
      await server.close()
    }
  })

  it('splits inputs into maxBatch-sized requests and concatenates the parts in order', async () => {
    process.env[KEY_ENV] = 'k'
    const server = await serveEmbedding(call => ({
      body: { data: call.input.map((_, index) => ({ index, embedding: [index, call.input.length] })) },
    }))
    try {
      const embedder = createHttpEmbedder(endpoint(server.url, { maxBatch: 2 }))
      await expect(embedder.embed(['a', 'b', 'c'])).resolves.toEqual([[0, 2], [1, 2], [0, 1]])
      expect(server.requests.map(request => request.input)).toEqual([['a', 'b'], ['c']])
    } finally {
      Reflect.deleteProperty(process.env, KEY_ENV)
      await server.close()
    }
  })

  it('rejects when the referenced environment variable is missing or blank', async () => {
    Reflect.deleteProperty(process.env, ABSENT_ENV)
    process.env[BLANK_ENV] = '   '
    try {
      const url = 'http://127.0.0.1:1/v1/embeddings'
      await expect(createHttpEmbedder(endpoint(url, { authEnv: ABSENT_ENV })).embed(['x']))
        .rejects.toThrow(/is not set/)
      await expect(createHttpEmbedder(endpoint(url, { authEnv: BLANK_ENV })).embed(['x']))
        .rejects.toThrow(/is not set/)
    } finally {
      Reflect.deleteProperty(process.env, BLANK_ENV)
    }
  })

  it('rejects a non-OK endpoint response', async () => {
    process.env[KEY_ENV] = 'k'
    const server = await serveEmbedding(() => ({ status: 500, body: { error: 'boom' } }))
    try {
      await expect(createHttpEmbedder(endpoint(server.url)).embed(['x'])).rejects.toThrow(/responded 500/)
    } finally {
      Reflect.deleteProperty(process.env, KEY_ENV)
      await server.close()
    }
  })

  it('rejects a payload whose data is not an array or has the wrong length', async () => {
    process.env[KEY_ENV] = 'k'
    const server = await serveEmbedding((_call, index) => index === 0
      ? { body: { data: 'nope' } }
      : { body: { data: [{ index: 0, embedding: [0, 1] }] } })
    try {
      const embedder = createHttpEmbedder(endpoint(server.url))
      await expect(embedder.embed(['x'])).rejects.toThrow(/unexpected shape/)
      await expect(embedder.embed(['x', 'y'])).rejects.toThrow(/unexpected shape/)
    } finally {
      Reflect.deleteProperty(process.env, KEY_ENV)
      await server.close()
    }
  })

  it('rejects a vector of the wrong dimension', async () => {
    process.env[KEY_ENV] = 'k'
    const server = await serveEmbedding(() => ({ body: { data: [{ index: 0, embedding: [0, 1, 2] }] } }))
    try {
      await expect(createHttpEmbedder(endpoint(server.url)).embed(['x'])).rejects.toThrow(/dimension must be 2/)
    } finally {
      Reflect.deleteProperty(process.env, KEY_ENV)
      await server.close()
    }
  })

  it('rejects an echoed index that is not a number, negative, or out of range', async () => {
    process.env[KEY_ENV] = 'k'
    const server = await serveEmbedding((_call, index) => ({
      body: { data: [{ index: ['one', -1, 99][index], embedding: [0, 1] }] },
    }))
    try {
      const embedder = createHttpEmbedder(endpoint(server.url))
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(embedder.embed(['x'])).rejects.toThrow(/out-of-range index/)
      }
    } finally {
      Reflect.deleteProperty(process.env, KEY_ENV)
      await server.close()
    }
  })

  it('rejects a response that omits one input by repeating an index', async () => {
    process.env[KEY_ENV] = 'k'
    const server = await serveEmbedding(() => ({
      body: { data: [{ index: 0, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] },
    }))
    try {
      await expect(createHttpEmbedder(endpoint(server.url)).embed(['x', 'y'])).rejects.toThrow(/omitted an input/)
    } finally {
      Reflect.deleteProperty(process.env, KEY_ENV)
      await server.close()
    }
  })

  it('propagates a caller abort through the composed signal', async () => {
    process.env[KEY_ENV] = 'k'
    const server = await serveEmbedding(() => 'hang')
    try {
      const embedder = createHttpEmbedder(endpoint(server.url, { timeoutMs: 30_000 }))
      const controller = new AbortController()
      const pending = embedder.embed(['x'], controller.signal)
      setTimeout(() => { controller.abort() }, 30)
      await expect(pending).rejects.toThrow(/abort/i)
    } finally {
      Reflect.deleteProperty(process.env, KEY_ENV)
      await server.close()
    }
  })

  it('rejects when the endpoint does not respond within the configured timeout', async () => {
    process.env[KEY_ENV] = 'k'
    const server = await serveEmbedding(() => 'hang')
    try {
      const embedder = createHttpEmbedder(endpoint(server.url, { timeoutMs: 40 }))
      await expect(embedder.embed(['x'])).rejects.toThrow(/abort/i)
    } finally {
      Reflect.deleteProperty(process.env, KEY_ENV)
      await server.close()
    }
  })
})
