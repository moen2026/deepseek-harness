# Long-term memory

English | [中文](memory.zh.md)

The memory seam — a [capability seam](../glossary.md#capability-seam) exposing durable long-term memory on one `ctx.memory` service, split across packages: Service Definition ([dsh-memory](../../packages/memory/memory), `ctx.memory` + the provider registry), Service Provider ([dsh-memory-sqlite](../../packages/memory/memory-sqlite), a local SQLite FTS5 store with lexical recall and an optional fused semantic ranking), and Consumers ([dsh-tool-memory](../../packages/memory/tool-memory), the `memory_write`/`memory_search`/`memory_forget` tool schemas; [dsh-memory-reflection](../../packages/memory/memory-reflection), turn-end extraction written back through the seam; and [dsh-memory-profile](../../packages/memory/memory-profile), saved `style` records injected as a runtime-context section). Memory is **one optional capability**, not part of the agent-loop spine. A provider swap does not change how callers or the model use the seam; with no provider registered, every operation throws `MemoryError` `MEMORY_UNAVAILABLE` and the tools answer with an actionable unavailable message. DSH never selects a model or embedding provider — the semantic ranking activates only when the deployment supplies its own embedding endpoint.

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

## Operations and records

Four operations share the seam: `remember` persists a write payload and returns the provider-assigned id, `recall` answers one ranked query, `forget` deletes one record by id (`false` when no such record existed), and `list` returns stored records by recency. A write payload requires only `text`; `tags`, `scope`, a typed `namespace` (`preference`, `fact`, or `style`), a `confidence` from 0 through 1, and a `ttlMs` expiry are optional refinements. A stored record adds the assigned `id`, an ISO 8601 `createdAt` stamped by the provider, and the computed `expiresAt` when a `ttlMs` was supplied. Recall and listing take optional `tags`/`scope`/`namespace` filters, an optional `minConfidence` threshold, and an optional `limit` to which the provider applies its own default and cap, and neither ever returns an expired record; both results are total for the request (no cursor). Storage layout, ranking, and any vector retrieval are the provider's private concern; the seam exposes no embedding or protocol escape hatch.

Providers register under an opaque identity string reserved atomically at registration; `MemoryError` extends `HarnessError` with stable codes `MEMORY_INVALID_PROVIDER`, `MEMORY_CONFLICT`, `MEMORY_UNAVAILABLE`, `MEMORY_DISPOSED`, and `MEMORY_INVALID_REQUEST`, which callers route on instead of parsing `message`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryservice"></a>

### `ctx.memory` — `MemoryService`

The `ctx.memory` surface: a single-provider reservation registry plus the four routed operations (`remember`, `recall`, `forget`, `list`). The seam exposes no embedding or protocol escape hatch — storage layout and any vector retrieval are the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: MemoryProvider): () => void

/**
 * Route one write to the registered provider.
 * @param draft - the write payload.
 * @param signal - cancellation forwarded to the provider.
 * @returns the provider-assigned record identity.
 * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
 */
remember(draft: MemoryDraft, signal?: AbortSignal): Promise<string>

/**
 * Route one recall to the registered provider.
 * @param request - the normalized query.
 * @param signal - cancellation forwarded to the provider.
 * @returns a ranked, total result of hits.
 * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
 */
recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>

/**
 * Route one deletion to the registered provider.
 * @param id - the record identity to forget.
 * @param signal - cancellation forwarded to the provider.
 * @returns `true` when a record was removed, `false` when none matched.
 * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
 */
forget(id: string, signal?: AbortSignal): Promise<boolean>

/**
 * Route one listing to the registered provider.
 * @param request - the listing filter; all fields optional.
 * @param signal - cancellation forwarded to the provider.
 * @returns a total page of records.
 * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
 */
list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryPage>
```

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

<a id="ctxmemorybrowser--memorybrowserservice"></a>

### `ctx.memoryBrowser` — `MemoryBrowserService`

`ctx.memoryBrowser`. A read-and-remove face: remembering and recall stay model-side operations, so the browser cannot write memory content.

```ts cordis-catalog
/**
 * Probe whether a provider holds the seam.
 * @returns the availability answer; never rejects for an unheld seam.
 */
@Remote('status') status(): Promise<MemoryBrowserStatus>

/**
 * List stored memories by recency.
 * @param request - the listing filter; all fields optional.
 * @param signal - cancellation forwarded to the provider.
 * @returns a total page of memories.
 */
@Remote('list') async list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryPage>

/**
 * Remove one memory.
 * @param id - the memory identity to remove.
 * @param signal - cancellation forwarded to the provider.
 * @returns `true` when a memory was removed, `false` when none matched.
 */
@Remote('forget') async forget(id: string, signal?: AbortSignal): Promise<boolean>
```

Source: [`packages/memory/memory/src/browser.ts`](../../packages/memory/memory/src/browser.ts)
<!-- END GENERATED cordis-surface -->
