/**
 * Interactive OAuth 2.0 authorization-code support for Streamable HTTP MCP
 * servers, built on the MCP SDK's `auth()` orchestrator and
 * `OAuthClientProvider` interface.
 *
 * The flow runs entirely at plugin load (pre-flight): discovery, dynamic
 * client registration (RFC 7591) when the server supports it, PKCE (RFC 7636),
 * a loopback redirect listener (RFC 8252 §7.1), and the token exchange. The
 * user's browser opens on the authorization URL; the headless fallback is the
 * same URL printed to the log. Tokens, client registration, and discovery
 * state persist through the credential seam as one grant record per server, so
 * subsequent loads skip the interactive leg entirely. At runtime the transport
 * refreshes through the same provider — `auth()` performs the refresh grant
 * and `saveTokens` re-persists — and never needs the redirect listener again.
 *
 * A repeated 401 after a refresh failure means the grant itself is no longer
 * valid; the connection fails loudly with reload instructions instead of
 * reopening a browser, so a dead grant can never loop interactively.
 *
 * @module
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { auth } from '@modelcontextprotocol/client'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  OAuthTokens,
  StoredOAuthClientInformation,
} from '@modelcontextprotocol/client'
import { CredentialProvider, credentialKey } from '@deepseek-ai/dsh-credentials'

/** Plugin config for the interactive OAuth authorization-code flow. */
export interface OAuthConfig {
  /**
   * OAuth scopes to request. Omission requests the server's default scope.
   * Include `offline_access` to receive a refresh token when the server
   * requires opt-in for one.
   */
  scopes?: string[]
  /**
   * Loopback redirect URI the authorization server must call back to
   * (`http://127.0.0.1:<port>/callback`). Omission or a zero port binds an
   * OS-assigned port at flow start.
   */
  redirectUri?: string
  /** Client id from a registration made outside the Harness. */
  clientId?: string
  /** Client secret for a confidential client; omitted clients authenticate as public. */
  clientSecret?: string
  /** How long the loopback listener waits for the browser round trip (ms). */
  callbackTimeoutMs?: number
}

/** Fully resolved OAuth config; defaulting happens here, never inline. */
export interface ResolvedOAuthConfig {
  scopes: string[]
  redirectUri?: string
  clientId?: string
  clientSecret?: string
  callbackTimeoutMs: number
}

/** Default wait for the browser round trip. */
export const DEFAULT_CALLBACK_TIMEOUT_MS = 300_000

/**
 * Resolve the raw `oauth` config in one explicit step; misconfiguration fails
 * the plugin instance at load.
 * @param config - raw `oauth` config block.
 * @param path - diagnostic prefix naming the config location in thrown messages.
 * @returns the frozen resolved config.
 */
export function resolveOAuthConfig(config: OAuthConfig, path: string): ResolvedOAuthConfig {
  const redirectUri = config.redirectUri
  if (redirectUri !== undefined) {
    let url: URL
    try {
      url = new URL(redirectUri)
    } catch {
      throw new Error(`${path}.redirectUri is not a valid URL`)
    }
    if (url.protocol !== 'http:') {
      throw new Error(`${path}.redirectUri must be a loopback http:// URL`)
    }
    const host = url.hostname
    if (host !== '127.0.0.1' && host !== '[::1]' && host !== 'localhost') {
      throw new Error(`${path}.redirectUri must bind a loopback host (127.0.0.1, [::1], or localhost)`)
    }
  }
  const callbackTimeoutMs = config.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS
  if (!Number.isFinite(callbackTimeoutMs) || callbackTimeoutMs <= 0 || callbackTimeoutMs > 2 ** 31 - 1) {
    throw new Error(`${path}.callbackTimeoutMs must be a positive number below 2^31`)
  }
  return Object.freeze({
    scopes: config.scopes ?? [],
    ...(redirectUri === undefined ? {} : { redirectUri }),
    ...(config.clientId === undefined ? {} : { clientId: config.clientId }),
    ...(config.clientSecret === undefined ? {} : { clientSecret: config.clientSecret }),
    callbackTimeoutMs,
  })
}

/**
 * Minimal persistence surface for one server's OAuth state. The production
 * adapter stores the blob as a credential-seam grant record; tests use an
 * in-memory map. The whole blob is owned by this module — other records on the
 * same seam key space are unaffected.
 */
export interface OAuthStore {
  /** The previously stored blob, or `undefined` when nothing is stored. */
  load(): Promise<Record<string, unknown> | undefined>
  /** Replace the blob wholesale with the next payload. */
  store(payload: Record<string, unknown>): Promise<void>
}

/** The payload layout this build persists (opaque to the credential seam). */
interface OAuthStoredState {
  /** Dynamic or external client registration, keyed by authorization-server issuer. */
  clients?: Record<string, OAuthClientInformationMixed>
  /** Tokens keyed by the issuer that minted them (RFC 6749 §2.2). */
  tokens?: Record<string, OAuthTokens>
  /** Cached RFC 9728 / server-metadata discovery state, keyed by issuer. */
  discovery?: Record<string, OAuthDiscoveryState>
  /** The issuer whose tokens `tokens()` without a context should return. */
  lastIssuer?: string
}

/** Narrow the stored blob, tolerating anything a hand-edit may have left. */
function asStoredState(payload: Record<string, unknown> | undefined): OAuthStoredState {
  return payload as OAuthStoredState | undefined ?? {}
}

/**
 * Credential-seam adapter: one grant record per MCP server
 * (`mcp-client/<server-name>`), read-decide-replaced through the provider's
 * locked `modifyRecord` path so concurrent reloads cannot lose a write.
 * @param credentials - the live credential provider service.
 * @param serverName - the mcp-client `serverName` owning the state.
 * @returns an {@link OAuthStore} over the grant record.
 */
export function credentialGrantStore(credentials: CredentialProvider, serverName: string): OAuthStore {
  const key = credentialKey('mcp-client', serverName.toLowerCase().replaceAll('_', '-'))
  const readPayload = async (): Promise<Record<string, unknown> | undefined> => {
    const record = await credentials.readRecord(key)
    return record?.kind === 'grant' && typeof record.payload === 'object' && record.payload !== null
      ? record.payload as Record<string, unknown>
      : undefined
  }
  return {
    load: readPayload,
    async store(next) {
      // oxlint-disable-next-line typescript/require-await -- the mutate callback contract returns a Promise
      await credentials.modifyRecord(key, async (current) => {
        // `current` is the record read under the lock: reusing it cannot lose
        // a write committed between `load` and here.
        return current?.kind === 'grant' && sameJson(current.payload, next)
          ? current
          : { kind: 'grant', payload: next }
      })
    },
  }
}

/** Structural JSON equality; the stored blob only ever holds JSON values. */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => sameJson(a[k], b[k]))
}

/** Logger subset the provider needs, so cordis's logger can be passed directly. */
export interface OAuthLog {
  info(message: string): void
  warn(message: string): void
}

/**
 * Open the authorization URL in the user's default browser. Failure is not an
 * error: the same URL is always printed to the log, so a headless host simply
 * loses the convenience.
 */
function openBrowser(url: URL): void {
  try {
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url.toString()] : [url.toString()]
    const child = spawn(command, args, { stdio: 'ignore', detached: true, shell: false })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Logged URL is the fallback surface.
  }
}

/** One `LoopbackOAuthProvider` per mcp-client instance. */
export class LoopbackOAuthProvider implements OAuthClientProvider {
  private readonly serverName: string
  private readonly resolved: ResolvedOAuthConfig
  private readonly store: OAuthStore
  private readonly log: OAuthLog

  /** In-flight loopback listener, started by the first `redirectUrl` read. */
  private server: Server | undefined
  private serverPort = 0
  /** Resolves with the callback query when the user agent returns. */
  private callback: PromiseWithResolvers<URLSearchParams> | undefined
  /** State minted for the outstanding redirect, matched against the callback. */
  private expectedState: string | undefined
  /** PKCE verifier saved by the SDK for the outstanding redirect. */
  private codeVerifierValue: string | undefined

  constructor(input: { serverName: string; oauth: OAuthConfig; store: OAuthStore; log: OAuthLog }) {
    this.serverName = input.serverName
    this.resolved = resolveOAuthConfig(input.oauth, `mcp-client(${input.serverName}): oauth`)
    this.store = input.store
    this.log = input.log
  }

  /** Cleanup the loopback listener when the plugin instance disposes. */
  dispose(): Promise<void> {
    return this.closeListener()
  }

  /** Scopes the flow requests, passed to `auth()` on both legs. */
  get scopes(): string[] {
    return this.resolved.scopes
  }

  /** Bind the loopback listener once; resolves with the bound redirect URL. */
  private bindPromise: Promise<string> | undefined

  /**
   * Bind the loopback listener and return the redirect URL the authorization
   * server must call back to. The OS-assigned port is only known once the
   * socket is bound, so this must complete before the flow starts — the
   * `redirectUrl` getter reads the bound port synchronously.
   */
  async bind(): Promise<string> {
    this.bindPromise ??= new Promise<string>((resolve, reject) => {
      const server = createServer((request, response) => {
        // The handler is synchronous: an unknown path or a failed state check
        // answers the browser and rejects the flow directly.
        this.handleCallback(request, response)
      })
      server.once('error', reject)
      server.listen(this.listenedPort(), '127.0.0.1', () => {
        // The listener serves one user round trip; it must never hold the
        // process open on its own.
        server.unref()
        this.server = server
        this.serverPort = (server.address() as AddressInfo).port
        resolve(this.resolved.redirectUri ?? `http://127.0.0.1:${this.serverPort}/callback`)
      })
    })
    return this.bindPromise
  }

  get redirectUrl(): string | undefined {
    // The configured spelling wins: a static registration's `redirect_uris`
    // must match the redirect the authorization URL carries byte for byte.
    return this.resolved.redirectUri ?? `http://127.0.0.1:${this.serverPort}/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `DeepSeek Harness (${this.serverName})`,
      client_uri: 'https://github.com/deepseek-ai/deepseek-harness',
      redirect_uris: [this.redirectUrl as string],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.resolved.clientSecret !== undefined ? 'client_secret_basic' : 'none',
      scope: this.resolved.scopes.join(' ') || undefined,
    }
  }

  state(): string {
    const value = randomBytes(16).toString('hex')
    this.expectedState = value
    return value
  }

  async clientInformation(ctx?: { issuer: string }): Promise<OAuthClientInformationMixed | undefined> {
    const state = asStoredState(await this.store.load())
    const issuer = this.issuerSlot(ctx)
    return state.clients?.[issuer]
  }

  async saveClientInformation(information: StoredOAuthClientInformation, ctx?: { issuer: string }): Promise<void> {
    await this.patchState((state) => {
      state.clients ??= {}
      state.clients[this.issuerSlot(ctx)] = information
    })
  }

  async tokens(ctx?: { issuer: string }): Promise<OAuthTokens | undefined> {
    const state = asStoredState(await this.store.load())
    const issuer = ctx?.issuer ?? state.lastIssuer
    return issuer === undefined ? undefined : state.tokens?.[issuer]
  }

  async saveTokens(tokens: OAuthTokens, ctx?: { issuer: string }): Promise<void> {
    await this.patchState((state) => {
      const issuer = ctx?.issuer ?? state.lastIssuer
      if (issuer === undefined) {
        throw new Error(`mcp-client(${this.serverName}): authorization server did not disclose an issuer; cannot store tokens`)
      }
      state.tokens ??= {}
      state.tokens[issuer] = tokens
      state.lastIssuer = issuer
    })
  }

  // oxlint-disable-next-line typescript/require-await -- provider protocol slot; memory is the required durability
  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    // The redirect round trip completes inside this process — the loopback
    // listener resolves while the SDK call that started it is still awaiting —
    // so process memory is the required durability.
    this.codeVerifierValue = codeVerifier
  }

  // oxlint-disable-next-line typescript/require-await -- provider protocol slot; memory is the required durability
  async codeVerifier(): Promise<string> {
    if (this.codeVerifierValue === undefined) {
      throw new Error(`mcp-client(${this.serverName}): no PKCE code verifier for an outstanding authorization`)
    }
    return this.codeVerifierValue
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.log.info(
      `mcp-client(${this.serverName}): awaiting authorization in your browser; if it did not open, visit: ${authorizationUrl}`,
    )
    openBrowser(authorizationUrl)
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.patchState((current) => {
      current.discovery ??= {}
      // The SDK's discovery blob carries no top-level issuer; the
      // authorization-server URL is the stable key it does carry.
      current.discovery[state.authorizationServerUrl] = state
    })
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const stored = asStoredState(await this.store.load())
    // The issuer is not known before discovery, so the cache is keyed by its
    // own issuer stamp and any single entry is the candidate.
    const entries = Object.values(stored.discovery ?? {})
    return entries.length === 1 ? entries[0] : undefined
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'verifier') {
      this.codeVerifierValue = undefined
      return
    }
    await this.patchState((state) => {
      if (scope === 'all') return {}
      if (scope === 'client') delete state.clients
      if (scope === 'tokens') { delete state.tokens; delete state.lastIssuer }
      if (scope === 'discovery') delete state.discovery
      return state
    })
  }

  /**
   * Wait for the browser round trip the outstanding redirect started.
   * @param timeoutMs - how long the loopback listener waits before failing.
   * @returns the callback query, ready for `auth()`'s code exchange.
   */
  async awaitCallback(timeoutMs: number): Promise<URLSearchParams> {
    this.callback ??= Promise.withResolvers()
    const settled = await Promise.race([
      this.callback.promise,
      this.timeout(timeoutMs),
    ])
    if (settled === undefined) {
      await this.closeListener()
      throw new Error(
        `mcp-client(${this.serverName}): authorization was not completed within ${Math.round(timeoutMs / 1000)}s;`
        + ' reload the plugin to try again',
      )
    }
    return settled
  }

  /** Reject a callback whose `state` does not match the outstanding redirect. */
  private assertState(query: URLSearchParams): void {
    const returned = query.get('state')
    if (this.expectedState !== undefined && returned !== this.expectedState) {
      throw new Error(`mcp-client(${this.serverName}): authorization callback state mismatch`)
    }
  }

  private timeout(timeoutMs: number): Promise<undefined> {
    return new Promise((resolve) => { const timer = setTimeout(() => { resolve(undefined) }, timeoutMs); timer.unref() })
  }

  private issuerSlot(ctx?: { issuer: string }): string {
    return ctx?.issuer ?? 'pending'
  }

  /** Read-modify-write the stored blob through the store's wholesale replace. */
  private async patchState(mutate: (state: OAuthStoredState) => OAuthStoredState | void): Promise<void> {
    const draft = asStoredState(await this.store.load())
    // The mutator edits the draft in place; its return value replaces the
    // draft only when it hands back a wholly different blob (invalidate).
    const next = mutate(draft) ?? draft
    await this.store.store(next as Record<string, unknown>)
  }

  /** Parse the configured redirect URI into a listen port, 0 meaning OS-assigned. */
  private listenedPort(): number {
    if (this.resolved.redirectUri === undefined) return 0
    const url = new URL(this.resolved.redirectUri)
    const port = Number(url.port)
    return url.port === '' || !Number.isInteger(port) ? 0 : port
  }

  private handleCallback(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const fail = (code: number, message: string): void => {
      response.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(message)
    }
    if (url.pathname !== '/callback') {
      fail(404, 'Not found')
      return
    }
    if (url.searchParams.has('error')) {
      this.rejectCallback(new Error(
        `authorization server returned ${url.searchParams.get('error')}: ${url.searchParams.get('error_description') ?? 'no description'}`,
      ))
      fail(502, `Authorization failed: ${url.searchParams.get('error')}`)
      return
    }
    if (!url.searchParams.has('code')) {
      fail(400, 'Missing authorization code')
      return
    }
    try {
      this.assertState(url.searchParams)
    } catch (error) {
      this.rejectCallback(error instanceof Error ? error : new Error(String(error)))
      fail(400, 'State mismatch')
      return
    }
    const expectation = this.callback
    // Resolve and answer the browser first: `server.close()` waits for this
    // very connection to finish, so closing before the response deadlocks
    // both the user agent and the flow. The close runs fire-and-forget.
    expectation?.resolve(url.searchParams)
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Authorization complete. You can close this tab and return to the Harness.')
    void this.closeListener()
  }

  private rejectCallback(error: Error): void {
    this.callback?.reject(error)
    this.callback = undefined
    void this.closeListener()
  }

  private closeListener(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.callback = undefined
    this.expectedState = undefined
    if (server === undefined) return Promise.resolve()
    return new Promise((resolve) => { server.close(() => { resolve() }) })
  }
}

/**
 * Drive one complete interactive authorization to stored tokens before the
 * connection starts. Runs only when no tokens are stored: a returning load
 * goes straight to the transport, whose runtime refreshes re-enter
 * {@link LoopbackOAuthProvider.saveTokens} through `auth()`.
 * @param provider - the loopback provider driving the flow.
 * @param serverUrl - the MCP server URL the flow authorizes against.
 * @param timeoutMs - browser round-trip timeout for the redirect leg.
 */
export async function ensureAuthorized(
  provider: LoopbackOAuthProvider,
  serverUrl: string,
  timeoutMs: number,
): Promise<void> {
  if (await provider.tokens() !== undefined) return
  // Bind the loopback listener first: the OS-assigned port must be in the
  // registered redirect URIs before discovery or registration reads them.
  await provider.bind()
  const scope = provider.scopes.join(' ')
  const redirect = await auth(provider, {
    serverUrl: new URL(serverUrl),
    ...(scope === '' ? {} : { scope }),
  })
  if (redirect === 'AUTHORIZED') return
  const query = await provider.awaitCallback(timeoutMs)
  const iss = query.get('iss')
  const exchange = await auth(provider, {
    serverUrl: new URL(serverUrl),
    authorizationCode: query.get('code') as string,
    ...(iss === null ? {} : { iss }),
  })
  if (exchange !== 'AUTHORIZED') {
    throw new Error('mcp-client: authorization code exchange did not produce tokens')
  }
}

/**
 * The production {@link OAuthStore}: a per-server grant record on the
 * credential seam. Accesses the service defensively because mcp-client does
 * not declare `credentials` as an inject — a stdio-only deployment runs
 * without any credential provider.
 * @param ctx - plugin context.
 * @param serverName - the mcp-client `serverName` owning the record.
 * @returns the store, or `undefined` when no credential provider is loaded.
 */
export function credentialStoreOf(ctx: { credentials?: unknown }, serverName: string): OAuthStore | undefined {
  try {
    const credentials = ctx.credentials
    return credentials instanceof CredentialProvider ? credentialGrantStore(credentials, serverName) : undefined
  } catch {
    return undefined
  }
}
