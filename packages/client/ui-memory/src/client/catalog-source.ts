/** Authoritative memory queries and deletion for the memory center page. */

import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryBrowserStatus, MemoryPage, MemoryRecord } from '@deepseek-ai/dsh-memory/client'

/** How one deletion settled; the page reports it inline. */
export type MemoryDeleteOutcome = 'deleted' | 'failed' | 'pending'

/** Query and mutation state exposed to the memory center page. */
export interface MemoryCatalogSnapshot {
  readonly records: readonly MemoryRecord[]
  readonly status: 'loading' | 'ready' | 'error'
  /**
   * Whether a provider holds the seam, answered by the first read's probe.
   *
   * An unheld seam is a state of the page rather than a failed read: the Host
   * face answers the probe explicitly, so the page renders its unavailable
   * state instead of an error a retry cannot clear.
   */
  readonly available: boolean
  readonly deleting: readonly string[]
  /**
   * Whether an authoritative list read has ever succeeded.
   *
   * The first snapshot reports `loading` with no records, and a later refresh
   * republishes `loading` over the records of the last successful read, so
   * `status` alone cannot separate a first read from a refresh. A failed read
   * leaves it alone.
   */
  readonly settled: boolean
}

/** Remote operations and invalidations scoped by the registering entry. */
export interface MemoryCatalogDependencies {
  /** Probe whether a provider holds the seam; answered before each list read. */
  readonly status: () => Promise<RemoteResult<MemoryBrowserStatus>>
  readonly list: () => Promise<RemoteResult<MemoryPage>>
  readonly forget: (id: string) => Promise<RemoteResult<boolean>>
  readonly subscribeReset: (listener: () => void) => () => void
}

/** Props injected through the memory center's slot. */
export interface MemoryCatalogInjected {
  readonly hooks: { readonly catalog: HostObservable<MemoryCatalogSnapshot> }
  /**
   * Delete one memory and refresh after the Remote acknowledgement.
   * @param id - memory shown in this catalog.
   * @returns 'deleted' after the acknowledged deletion's refreshed query,
   * 'failed' when the deletion was not confirmed, and 'pending' when a deletion
   * of the same memory was already in flight.
   */
  readonly onDelete: (id: string) => Promise<MemoryDeleteOutcome>
  /**
   * Reload the catalog: after a query failure, and after a connection reset.
   * @returns Resolution after publishing the read result; failures remain in catalog state.
   */
  readonly onRetry: () => Promise<void>
}

/**
 * Create a catalog whose Remote subscriptions follow its framework subscribers.
 * Each read probes the seam first: an unheld seam settles the page without a
 * list read. Mutations retain visible rows until an authoritative list read
 * succeeds, and each deletion resolves with its own outcome.
 * @param deps - Remote calls and invalidation subscriptions.
 * @returns observable catalog and component callbacks.
 */
export function createMemoryCatalog(deps: MemoryCatalogDependencies): MemoryCatalogInjected {
  let snapshot: MemoryCatalogSnapshot = { records: [], status: 'loading', available: true, deleting: [], settled: false }
  const listeners = new Set<() => void>()
  let disposers: readonly (() => void)[] = []
  let epoch = 0
  let lifecycle = 0
  const publish = (next: MemoryCatalogSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const read = async (current: number): Promise<void> => {
    let probe: RemoteResult<MemoryBrowserStatus>
    try {
      probe = await deps.status()
    } catch (_error: unknown) {
      // Transport rejection has the same visible retry path as a Remote failure.
      if (current === epoch) publish({ ...snapshot, status: 'error' })
      return
    }
    if (current !== epoch) return
    if (probe.ok && !probe.value.available) {
      publish({ ...snapshot, records: [], status: 'ready', available: false, settled: true })
      return
    }
    let result: RemoteResult<MemoryPage>
    try {
      result = await deps.list()
    } catch (_error: unknown) {
      if (current === epoch) publish({ ...snapshot, status: 'error' })
      return
    }
    if (current !== epoch) return
    publish(result.ok
      ? { ...snapshot, records: result.value.records, status: 'ready', available: true, settled: true }
      : { ...snapshot, status: 'error' })
  }
  // A reset states that the connection moved, so its read supersedes whatever
  // is in flight instead of joining it.
  const invalidate = (): Promise<void> => {
    const current = ++epoch
    publish({ ...snapshot, status: 'loading' })
    return read(current)
  }
  const remove = async (id: string): Promise<MemoryDeleteOutcome> => {
    if (snapshot.deleting.includes(id)) return 'pending'
    const started = lifecycle
    publish({ ...snapshot, deleting: [...snapshot.deleting, id] })
    let result: RemoteResult<boolean>
    try {
      result = await deps.forget(id)
    } catch (_error: unknown) {
      // A rejected deletion does not establish that the store changed.
      if (started === lifecycle) {
        publish({ ...snapshot, deleting: snapshot.deleting.filter(value => value !== id) })
      }
      return 'failed'
    }
    if (started !== lifecycle) return result.ok && result.value ? 'deleted' : 'failed'
    publish({ ...snapshot, deleting: snapshot.deleting.filter(value => value !== id) })
    // A `false` answer is a confirmed no-op, not a deletion; only a confirmed
    // removal changed the authoritative state, so its acknowledgement reads
    // again rather than joining a read that may have been sent before it.
    const confirmed = result.ok && result.value
    if (confirmed) await invalidate()
    return confirmed ? 'deleted' : 'failed'
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
            snapshot = { ...snapshot, deleting: [] }
          }
        },
      },
    },
    onDelete: remove,
    onRetry: () => invalidate(),
  }
}
