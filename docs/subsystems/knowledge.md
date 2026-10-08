# Knowledge base

English | [中文](knowledge.zh.md)

The knowledge-base seam — a [capability seam](../glossary.md#capability-seam) exposing one shared, durable document corpus on one `ctx.knowledge` service, split across packages: Service Definition ([dsh-knowledge](../../packages/knowledge/knowledge), `ctx.knowledge` + the provider registry), Service Provider ([dsh-knowledge-sqlite](../../packages/knowledge/knowledge-sqlite), the zero-dependency FTS5/BM25 store on `node:sqlite`), and Consumer ([dsh-tool-knowledge](../../packages/knowledge/tool-knowledge), the model-facing `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list` tools). The knowledge base is **one optional capability**, not part of the agent-loop spine. A provider swap does not change how callers or the model use the seam; with no provider registered, every route throws `KnowledgeError` `KNOWLEDGE_UNAVAILABLE` and the tools answer with an actionable unavailable message. Storage layout, chunking, and ranking stay the provider's private concern — the seam exposes no embedding or protocol escape hatch, and DSH never selects an embedding provider.

Source: [`packages/knowledge/knowledge/src/types.ts`](../../packages/knowledge/knowledge/src/types.ts)

## Documents and hits

One read vocabulary shares the seam: a `KnowledgeRecord` carries the provider-assigned `id`, the human `title`, the `text` body, classification `tags`, the optional `source` provenance, and the provider-stamped `createdAt`; a `KnowledgeHit` adds the provider-defined relevance `score` and a `snippet` excerpt around the first match. `ingest` takes a required `title` and `text` plus optional `tags` and `source`, and returns the assigned id. Documents are immutable once ingested; revision is remove plus re-ingest. Search and listing filter on tags, and the requested `limit` bounds the page — the seam applies no timeout or cap of its own, so consumers own those bounds.

## Position against memory and repo wiki

The knowledge base is a curated, titled document corpus shared across sessions and users, searched for passages — not the per-user, short-record `ctx.memory` seam, and not the generated, read-only `ctx.repoWiki` documentation of a repository's own source. The three retrieval seams coexist: memory answers "what does this user prefer", the repo wiki answers "how is this codebase documented", and the knowledge base answers "what has been decided and recorded here".

## Storage and ranking

`dsh-knowledge-sqlite` keeps one guarded derived store: a canonical `knowledge_records` table plus an FTS5 `knowledge_docs` index over title and body. The open guard stamps an application id and refuses foreign databases; an incompatible derived schema resets in place. Search ranks with BM25, prefilters into a bounded pool, applies tag filters in JavaScript, and returns `snippet()` excerpts; all work serializes through one connection. Caller text is always inert FTS5 data, so an unbalanced quote in user input cannot break the match expression.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledge--knowledgeservice"></a>

### `ctx.knowledge` — `KnowledgeService`

The `ctx.knowledge` surface: a single-provider reservation registry plus the four routed operations (`ingest`, `search`, `remove`, `list`). The seam exposes no chunking, embedding, or protocol escape hatch — storage layout and any vector retrieval are the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: KnowledgeProvider): () => void

/**
 * Route one ingest to the registered provider.
 * @param draft - the ingest payload.
 * @param signal - cancellation forwarded to the provider.
 * @returns the provider-assigned document identity.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
 */
ingest(draft: KnowledgeDraft, signal?: AbortSignal): Promise<string>

/**
 * Route one search to the registered provider.
 * @param request - the normalized query.
 * @param signal - cancellation forwarded to the provider.
 * @returns a ranked, total result of hits with snippets.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
 */
search(request: KnowledgeSearchRequest, signal?: AbortSignal): Promise<KnowledgeSearchResult>

/**
 * Route one deletion to the registered provider.
 * @param id - the document identity to remove.
 * @param signal - cancellation forwarded to the provider.
 * @returns `true` when a document was removed, `false` when none matched.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
 */
remove(id: string, signal?: AbortSignal): Promise<boolean>

/**
 * Route one listing to the registered provider.
 * @param request - the listing filter; all fields optional.
 * @param signal - cancellation forwarded to the provider.
 * @returns a total page of documents.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
 */
list(request?: KnowledgeListRequest, signal?: AbortSignal): Promise<KnowledgePage>
```

Source: [`packages/knowledge/knowledge/src/types.ts`](../../packages/knowledge/knowledge/src/types.ts)

<a id="ctxknowledgebrowser--knowledgebrowserservice"></a>

### `ctx.knowledgeBrowser` — `KnowledgeBrowserService`

`ctx.knowledgeBrowser`. A read-and-remove face: ingest and search stay model-side operations, so the browser cannot write corpus content.

```ts cordis-catalog
/**
 * Probe whether a provider holds the seam.
 * @returns the availability answer; never rejects for an unheld seam.
 */
@Remote('status') status(): Promise<KnowledgeBrowserStatus>

/**
 * List stored documents by recency.
 * @param request - the listing filter; all fields optional.
 * @param signal - cancellation forwarded to the provider.
 * @returns a total page of documents.
 */
@Remote('list') async list(request?: KnowledgeListRequest, signal?: AbortSignal): Promise<KnowledgePage>

/**
 * Remove one document.
 * @param id - the document identity to remove.
 * @param signal - cancellation forwarded to the provider.
 * @returns `true` when a document was removed, `false` when none matched.
 */
@Remote('remove') async remove(id: string, signal?: AbortSignal): Promise<boolean>
```

Source: [`packages/knowledge/knowledge/src/browser.ts`](../../packages/knowledge/knowledge/src/browser.ts)
<!-- END GENERATED cordis-surface -->
