# Code index search

English | [中文](code-index.zh.md)

The code-index seam — a [capability seam](../glossary.md#capability-seam) exposing lexical codebase search on one `ctx.codeIndex` service, split across packages: Service Definition ([dsh-code-index](../../packages/code-index/code-index), `ctx.codeIndex` + the provider registry), Service Provider ([dsh-code-index-sqlite](../../packages/code-index/code-index-sqlite), a local SQLite FTS5 index with fused local hashed-subtoken semantic ranking over authorized workspace files), and Consumer ([dsh-tool-code-index](../../packages/code-index/tool-code-index), the `search_codebase` tool schema). Code indexing is **one optional capability**, not part of the agent-loop spine. A provider swap does not change how the model asks for a search; with no provider registered, `search` throws `CodeIndexError` `CODE_INDEX_UNAVAILABLE` and the tool answers with an actionable unavailable message.

Source: [`packages/code-index/code-index/src/types.ts`](../../packages/code-index/code-index/src/types.ts)

## Request and result

One operation, `search`, answers a lexical query. `query` is required and never defaulted; `glob`, `language`, and `limit` are optional refinements, and the provider applies its own default and cap for an omitted `limit`. A hit is a bounded line range in one indexed file — workspace-relative `path`, one-based `startLine`/`endLine`, optional `language`, a provider-defined relevance `score` (higher ranks first), and a display `snippet` already bounded by the provider. The result is total for the request (no cursor). Corpus layout, indexing, and ranking are the provider's private concern; the seam exposes no index-building or protocol escape hatch.

Providers register under an opaque identity string reserved atomically at registration; `CodeIndexError` extends `HarnessError` with stable codes `CODE_INDEX_INVALID_PROVIDER`, `CODE_INDEX_CONFLICT`, `CODE_INDEX_UNAVAILABLE`, `CODE_INDEX_DISPOSED`, and `CODE_INDEX_INVALID_REQUEST`, which callers route on instead of parsing `message`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcodeindex--codeindexservice"></a>

### `ctx.codeIndex` — `CodeIndexService`

The `ctx.codeIndex` surface: a single-provider reservation registry plus one read-only `search` that routes to the registered provider. The seam exposes exactly `search` and no index-building or protocol escape hatch — populating the corpus is the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: CodeIndexProvider): () => void

/**
 * Route one lexical search to the registered provider.
 * @param request - the normalized query.
 * @param signal - cancellation forwarded to the provider.
 * @returns a ranked, total page of hits.
 * @throws {@link CodeIndexError} with `CODE_INDEX_UNAVAILABLE` when no provider is registered.
 */
search(request: CodeSearchRequest, signal?: AbortSignal): Promise<CodeSearchPage>
```

Source: [`packages/code-index/code-index/src/types.ts`](../../packages/code-index/code-index/src/types.ts)
<!-- END GENERATED cordis-surface -->
