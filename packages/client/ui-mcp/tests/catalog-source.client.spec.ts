import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpServerSummary } from '@deepseek-ai/dsh-mcp-resources/client'
import { describe, expect, it } from 'vitest'
import { createMcpCatalog, type McpCatalogDependencies, type McpCatalogSnapshot } from '../src/client/catalog-source.ts'

function server(name: string): McpServerSummary {
  return {
    name,
    tools: [{ name: `mcp__${name}__search`, description: `search on ${name}` }],
    resources: [{ uri: `file:///data/${name}.md`, name: `${name}.md`, mimeType: 'text/markdown' }],
  }
}

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

/**
 * One Remote operation answered by scripted `answer` calls: every `call`
 * registers a fresh pending promise, so a retry's follow-up read is
 * independent of the read that preceded it.
 */
function scripted<T>(): { call: () => Promise<T>; answer: (value: T) => void } {
  const resolvers: Array<(value: T) => void> = []
  return {
    call: () => new Promise<T>((resolve) => { resolvers.push(resolve) }),
    answer: (value) => {
      const resolve = resolvers.shift()
      if (resolve === undefined) throw new Error('scripted: answer without a pending call')
      resolve(value)
    },
  }
}

interface Harness {
  deps: McpCatalogDependencies & {
    probe: { ok: (available: boolean) => void }
    listing: { ok: (servers: McpServerSummary[]) => void; fail: () => void }
    reset: () => void
  }
  snapshot: () => McpCatalogSnapshot
  subscribe: () => () => void
  onRetry: () => Promise<void>
}

function harness(): Harness {
  const probe = scripted<RemoteResult<{ available: boolean }>>()
  const servers = scripted<RemoteResult<{ servers: McpServerSummary[] }>>()
  const resetListeners: Array<() => void> = []
  const deps: McpCatalogDependencies = {
    status: () => probe.call(),
    servers: () => servers.call(),
    subscribeReset: (listener) => {
      resetListeners.push(listener)
      return () => { resetListeners.splice(resetListeners.indexOf(listener), 1) }
    },
  }
  const catalog = createMcpCatalog(deps)
  return {
    deps: {
      ...deps,
      probe: { ok: (available) => { probe.answer({ ok: true, value: { available } }) } },
      listing: {
        ok: (list) => { servers.answer({ ok: true, value: { servers: list } }) },
        fail: () => { servers.answer({ ok: false, error: new RemoteError('gateway/internal', 'boom', {}) }) },
      },
      reset: () => { for (const listener of resetListeners) listener() },
    },
    snapshot: () => catalog.hooks.catalog.getSnapshot(),
    subscribe: () => catalog.hooks.catalog.subscribe(() => undefined),
    onRetry: catalog.onRetry,
  }
}

/** Probe, read, and settle the source to a ready server list. */
async function settleServers(h: Harness, list: McpServerSummary[]): Promise<void> {
  h.deps.probe.ok(true)
  await flush()
  h.deps.listing.ok(list)
  await flush()
}

describe('createMcpCatalog', () => {
  it('holds a subscribed source with an unavailable deployment until the first read settles', async () => {
    const h = harness()
    h.subscribe()
    expect(h.snapshot()).toMatchObject({ status: 'loading', available: true, settled: false, servers: [] })
    h.deps.probe.ok(false)
    await flush()
    expect(h.snapshot()).toMatchObject({ status: 'ready', available: false, settled: true, servers: [] })
  })

  it('answers an available deployment with the server read', async () => {
    const h = harness()
    h.subscribe()
    await settleServers(h, [server('docs'), server('web')])
    expect(h.snapshot()).toMatchObject({ status: 'ready', available: true, settled: true })
    expect(h.snapshot().servers.map(entry => entry.name)).toEqual(['docs', 'web'])
  })

  it('reports a failed read as error and keeps the previous servers', async () => {
    const h = harness()
    h.subscribe()
    await settleServers(h, [server('docs')])
    const settled = h.onRetry()
    h.deps.probe.ok(true)
    await flush()
    h.deps.listing.fail()
    await settled
    expect(h.snapshot()).toMatchObject({ status: 'error', settled: true })
    expect(h.snapshot().servers.map(entry => entry.name)).toEqual(['docs'])
  })

  it('refreshes through the connection reset subscription', async () => {
    const h = harness()
    h.subscribe()
    await settleServers(h, [server('docs')])
    h.deps.reset()
    h.deps.probe.ok(true)
    await flush()
    h.deps.listing.ok([server('web')])
    await flush()
    expect(h.snapshot().servers.map(entry => entry.name)).toEqual(['web'])
  })

  it('stops reading after the last reader unsubscribes', async () => {
    const h = harness()
    const dispose = h.subscribe()
    dispose()
    // The reset subscription was released with the last reader, so a reset
    // leaves the retired snapshot untouched instead of starting a new read.
    h.deps.reset()
    expect(h.snapshot().status).toBe('loading')
  })
})
