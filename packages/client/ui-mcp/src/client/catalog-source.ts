/** Authoritative MCP discovery reads for the MCP panel page. */

import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpBrowserStatus, McpServerSummary } from '@deepseek-ai/dsh-mcp-resources/client'

/** Read state exposed to the MCP panel page. */
export interface McpCatalogSnapshot {
  readonly servers: readonly McpServerSummary[]
  readonly status: 'loading' | 'ready' | 'error'
  /**
   * Whether any MCP server is registered, answered by the first read's probe.
   *
   * A serverless deployment is a state of the page rather than a failed read:
   * the Host face answers the probe explicitly, so the page renders its
   * unavailable state instead of an error a retry cannot clear.
   */
  readonly available: boolean
  /**
   * Whether an authoritative read has ever succeeded.
   *
   * The first snapshot reports `loading` with no servers, and a later refresh
   * republishes `loading` over the servers of the last successful read, so
   * `status` alone cannot separate a first read from a refresh. A failed read
   * leaves it alone.
   */
  readonly settled: boolean
}

/** Remote operations and invalidations scoped by the registering entry. */
export interface McpCatalogDependencies {
  /** Probe whether any server is registered; answered before each server read. */
  readonly status: () => Promise<RemoteResult<McpBrowserStatus>>
  readonly servers: () => Promise<RemoteResult<{ servers: McpServerSummary[] }>>
  readonly subscribeReset: (listener: () => void) => () => void
}

/** Props injected through the MCP panel's slot. */
export interface McpCatalogInjected {
  readonly hooks: { readonly catalog: HostObservable<McpCatalogSnapshot> }
  /**
   * Reload the panel: after a query failure, and after a connection reset.
   * @returns Resolution after publishing the read result; failures remain in catalog state.
   */
  readonly onRetry: () => Promise<void>
}

/**
 * Create a catalog whose Remote subscriptions follow its framework
 * subscribers. Each read probes availability first: a serverless deployment
 * settles the page without a server read.
 * @param deps - Remote calls and invalidation subscriptions.
 * @returns observable catalog and component callbacks.
 */
export function createMcpCatalog(deps: McpCatalogDependencies): McpCatalogInjected {
  let snapshot: McpCatalogSnapshot = { servers: [], status: 'loading', available: true, settled: false }
  const listeners = new Set<() => void>()
  let disposers: readonly (() => void)[] = []
  let epoch = 0
  let lifecycle = 0
  const publish = (next: McpCatalogSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const read = async (current: number): Promise<void> => {
    let probe: RemoteResult<McpBrowserStatus>
    try {
      probe = await deps.status()
    } catch (_error: unknown) {
      // Transport rejection has the same visible retry path as a Remote failure.
      if (current === epoch) publish({ ...snapshot, status: 'error' })
      return
    }
    if (current !== epoch) return
    if (probe.ok && !probe.value.available) {
      publish({ ...snapshot, servers: [], status: 'ready', available: false, settled: true })
      return
    }
    let result: RemoteResult<{ servers: McpServerSummary[] }>
    try {
      result = await deps.servers()
    } catch (_error: unknown) {
      if (current === epoch) publish({ ...snapshot, status: 'error' })
      return
    }
    if (current !== epoch) return
    publish(result.ok
      ? { ...snapshot, servers: result.value.servers, status: 'ready', available: true, settled: true }
      : { ...snapshot, status: 'error' })
  }
  // A reset states that the connection moved, so its read supersedes whatever
  // is in flight instead of joining it.
  const invalidate = (): Promise<void> => {
    const current = ++epoch
    publish({ ...snapshot, status: 'loading' })
    return read(current)
  }
  return {
    hooks: {
      catalog: {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          if (listeners.size === 1) {
            lifecycle++
            disposers = [deps.subscribeReset(() => { void invalidate() })]
            void invalidate()
          }
          return () => {
            listeners.delete(listener)
            if (listeners.size !== 0) return
            for (const dispose of disposers) dispose()
            disposers = []
            epoch++
            lifecycle++
          }
        },
      },
    },
    onRetry: () => invalidate(),
  }
}
