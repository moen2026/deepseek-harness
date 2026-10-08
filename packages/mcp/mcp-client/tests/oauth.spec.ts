/**
 * OAuth pre-flight tests: a mock authorization server (metadata, dynamic
 * registration, PKCE S256, authorization endpoint, token endpoint) plus a mock
 * protected resource (401 challenge, bearer-gated MCP endpoint), driven by a
 * test-controlled "browser" that follows the authorization redirect into the
 * provider's real loopback listener.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { StreamableHTTPClientTransport, auth } from '@modelcontextprotocol/client'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { LoopbackOAuthProvider, credentialStoreOf, ensureAuthorized, resolveOAuthConfig } from '../src/oauth.ts'
import type { OAuthStore } from '../src/oauth.ts'

/** PKCE S256 challenge for a verifier, exactly as the SDK computes it. */
function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** In-memory {@link OAuthStore}; the provider reads and patches it wholesale. */
function memoryStore(): OAuthStore & { data: Record<string, unknown> | undefined } {
  const box: { data: Record<string, unknown> | undefined } = { data: undefined }
  return {
    get data() { return box.data },
    async load() { return box.data },
    async store(payload) { box.data = payload },
  }
}

interface MockOAuth {
  url: string
  server: Server
  /** The PKCE challenge the last authorization bound to its code. */
  lastChallenge: string | undefined
  /** The access token the last exchange minted. */
  mintedToken: string | undefined
}

/** Start one HTTP server serving both the authorization server and the resource. */
let mintCount = 0

async function startMockOAuth(): Promise<MockOAuth> {
  const issuedCodes = new Map<string, string>()
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const json = (status: number, payload: unknown, headers: Record<string, string> = {}): void => {
        response.writeHead(status, { 'content-type': 'application/json', ...headers })
        response.end(JSON.stringify(payload))
      }
      const unauthorized = (): void => {
        json(401, {}, {
          'www-authenticate': `Bearer resource_metadata="http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/oauth-protected-resource"`,
        })
      }
      switch (true) {
        case url.pathname === '/mcp': {
          const bearer = request.headers.authorization
          if (bearer !== `Bearer ${mock.mintedToken}`) {
            unauthorized()
            return
          }
          json(200, { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 't', version: '1' } } })
          return
        }
        case url.pathname === '/.well-known/oauth-protected-resource':
          json(200, {
            resource: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
            authorization_servers: [mock.url],
          })
          return
        case url.pathname === '/.well-known/oauth-authorization-server':
          json(200, {
            issuer: mock.url,
            authorization_endpoint: `${mock.url}/authorize`,
            token_endpoint: `${mock.url}/token`,
            registration_endpoint: `${mock.url}/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
          })
          return
        case url.pathname === '/register': {
          const registration = JSON.parse(body) as { redirect_uris?: string[] }
          if (!registration.redirect_uris?.every(uri => uri.startsWith('http://127.0.0.1'))) {
            json(400, { error: 'invalid_redirect_uri' })
            return
          }
          json(200, {
            client_id: 'registered-client',
            client_secret: 'registered-secret',
            redirect_uris: registration.redirect_uris,
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic',
          })
          return
        }
        case url.pathname === '/authorize': {
          const challenge = url.searchParams.get('code_challenge')
          const state = url.searchParams.get('state')
          const redirect = url.searchParams.get('redirect_uri')
          if (challenge === null || state === null || redirect === null) {
            json(400, { error: 'invalid_request' })
            return
          }
          mock.lastChallenge = challenge
          const code = `code-${issuedCodes.size}`
          issuedCodes.set(code, JSON.stringify({ challenge, redirect }))
          response.writeHead(302, { location: `${redirect}?code=${code}&state=${state}` })
          response.end()
          return
        }
        case url.pathname === '/token': {
          const params = new URLSearchParams(body)
          if (params.get('grant_type') === 'refresh_token') {
            if (params.get('refresh_token') !== 'rt-1') {
              json(400, { error: 'invalid_grant' })
              return
            }
            mock.mintedToken = `at-${++mintCount}`
            json(200, { access_token: mock.mintedToken, token_type: 'Bearer', refresh_token: 'rt-2', expires_in: 3600 })
            return
          }
          if (params.get('grant_type') === 'authorization_code') {
            const bound = issuedCodes.get(params.get('code') ?? '')
            if (bound === undefined) {
              json(400, { error: 'invalid_grant' })
              return
            }
            const { challenge, redirect } = JSON.parse(bound) as { challenge: string; redirect: string }
            if (s256(params.get('code_verifier') ?? '') !== challenge) {
              json(400, { error: 'invalid_grant' })
              return
            }
            if (params.get('redirect_uri') !== redirect) {
              json(400, { error: 'invalid_grant' })
              return
            }
            mock.mintedToken = `at-${++mintCount}`
            json(200, {
              access_token: mock.mintedToken,
              token_type: 'Bearer',
              refresh_token: 'rt-1',
              expires_in: 3600,
            })
            return
          }
          json(400, { error: 'unsupported_grant_type' })
          return
        }
        default:
          json(404, { error: 'not_found' })
          return
      }
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const mock: MockOAuth = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    server,
    lastChallenge: undefined,
    mintedToken: undefined,
  }
  return mock
}

describe('resolveOAuthConfig', () => {
  it('rejects a non-loopback redirect URI', () => {
    expect(() => resolveOAuthConfig({ redirectUri: 'https://example.com/cb' }, 'p')).toThrow('loopback')
  })

  it('rejects a non-http redirect URI', () => {
    expect(() => resolveOAuthConfig({ redirectUri: 'ftp://127.0.0.1/cb' }, 'p')).toThrow('loopback')
  })

  it('rejects a non-positive callback timeout', () => {
    expect(() => resolveOAuthConfig({ callbackTimeoutMs: 0 }, 'p')).toThrow('callbackTimeoutMs')
  })

  it('applies defaults', () => {
    expect(resolveOAuthConfig({}, 'p')).toMatchObject({ scopes: [], callbackTimeoutMs: 300_000 })
  })
})

describe('credentialStoreOf', () => {
  it('returns undefined without a credential provider', () => {
    expect(credentialStoreOf({}, 'srv')).toBeUndefined()
  })
})

describe('ensureAuthorized', () => {
  let mock: MockOAuth

  beforeAll(async () => { mock = await startMockOAuth() })
  afterAll(() => { mock.server.close() })

  function makeProvider(store: OAuthStore): LoopbackOAuthProvider {
    return new LoopbackOAuthProvider({
      serverName: 'srv',
      oauth: {},
      store,
      log: { info: () => {}, warn: () => {} },
    })
  }

  /** Authorize through the real flow so `tokens()` returns a stored grant. */
  async function preAuthorize(provider: LoopbackOAuthProvider): Promise<void> {
    const flow = ensureAuthorized(provider, `${mock.url}/mcp`, 10_000)
    await completeAuthorization(provider, flow)
  }

  /** The test browser: follow the authorization redirect, then hit the loopback callback. */
  async function completeAuthorization(provider: LoopbackOAuthProvider, flow: Promise<void>): Promise<void> {
    const redirects: URL[] = []
    vi.spyOn(provider, 'redirectToAuthorization').mockImplementation((url) => { redirects.push(url) })
    await vi.waitFor(() => { expect(redirects.length).toBeGreaterThan(0) })
    const authorization = await fetch(redirects[0] as URL, { redirect: 'manual' })
    expect(authorization.status).toBe(302)
    const callback = new URL(authorization.headers.get('location') as string)
    const landing = await fetch(callback)
    expect(landing.status).toBe(200)
    await flow
  }

  it('runs the full authorization-code flow and persists tokens', async () => {
    const store = memoryStore()
    const provider = makeProvider(store)
    const flow = ensureAuthorized(provider, `${mock.url}/mcp`, 10_000)
    await completeAuthorization(provider, flow)
    const tokens = await provider.tokens()
    expect(tokens?.access_token).toBe('at-1')
    // State, clients, and tokens are all keyed under the issuer stamp.
    const stored = store.data as { tokens: Record<string, { access_token: string }>; clients: Record<string, { client_id: string }> }
    expect(Object.keys(stored.tokens)).toEqual([mock.url])
    expect(stored.clients?.[mock.url]?.client_id).toBe('registered-client')
    // A re-load skips the interactive leg entirely.
    await ensureAuthorized(provider, `${mock.url}/mcp`, 10_000)
    expect(mock.mintedToken).toBe('at-1')
  })

  it('gates the MCP endpoint with the exchanged bearer token', async () => {
    const store = memoryStore()
    const provider = makeProvider(store)
    await preAuthorize(provider)
    const transport = new StreamableHTTPClientTransport(new URL(`${mock.url}/mcp`), { authProvider: provider })
    // tokens() is populated before the first request: start() must not mint
    // again, and the MCP endpoint must accept the bearer it carries.
    await expect(transport.start()).resolves.toBeUndefined()
    expect(mock.mintedToken).toBe(`at-${mintCount}`)
    await transport.close()
  })

  it('refreshes the stored grant through the SDK auth() runtime path', async () => {
    const store = memoryStore()
    const provider = makeProvider(store)
    await preAuthorize(provider)
    const before = await provider.tokens()
    // The runtime 401 path: the transport's OAuth adapter calls auth(),
    // which refreshes through the stored refresh token and re-persists.
    const result = await auth(provider, { serverUrl: new URL(`${mock.url}/mcp`) })
    expect(result).toBe('AUTHORIZED')
    expect(mock.mintedToken).toBe(`at-${mintCount}`)
    const after = await provider.tokens()
    expect(after?.access_token).not.toBe(before?.access_token)
    expect(after?.access_token).toBe(`at-${mintCount}`)
  })

  it('rejects a callback whose state does not match the redirect', async () => {
    const store = memoryStore()
    const provider = makeProvider(store)
    const redirects: URL[] = []
    vi.spyOn(provider, 'redirectToAuthorization').mockImplementation((url) => { redirects.push(url) })
    const flow = ensureAuthorized(provider, `${mock.url}/mcp`, 10_000)
    // Start the rejects assertion before the browser leg: the rejection lands
    // while the callback fetch is being awaited, before a later assertion
    // could attach a handler, which vitest would report as unhandled.
    const flowAssertion = expect(flow).rejects.toThrow('state mismatch')
    await vi.waitFor(() => { expect(redirects.length).toBeGreaterThan(0) })
    const authorization = await fetch(redirects[0] as URL, { redirect: 'manual' })
    const callback = new URL(authorization.headers.get('location') as string)
    callback.searchParams.set('state', 'forged')
    await expect(fetch(callback)).resolves.toMatchObject({ status: 400 })
    await flowAssertion
  })

  it('fails loud when the browser round trip times out', async () => {
    const store = memoryStore()
    const provider = makeProvider(store)
    const redirects: URL[] = []
    vi.spyOn(provider, 'redirectToAuthorization').mockImplementation((url) => { redirects.push(url) })
    const flow = ensureAuthorized(provider, `${mock.url}/mcp`, 50)
    const flowAssertion = expect(flow).rejects.toThrow('authorization was not completed')
    await vi.waitFor(() => { expect(redirects.length).toBeGreaterThan(0) })
    await flowAssertion
  })
})

describe('CredentialProvider grant records', () => {
  it('exposes the abstract provider the store adapter checks', () => {
    expect(typeof CredentialProvider).toBe('function')
  })
})
