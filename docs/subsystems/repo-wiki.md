# Repository wiki

English | [中文](repo-wiki.zh.md)

The repository-wiki seam — a [capability seam](../glossary.md#capability-seam) exposing generated Markdown documentation pages on one `ctx.repoWiki` service, split across packages: Service Definition ([dsh-repo-wiki](../../packages/wiki/repo-wiki), `ctx.repoWiki` + the provider registry), Service Provider ([dsh-repo-wiki-generator](../../packages/wiki/repo-wiki-generator), the LLM-backed generator that renders workspace source documents into pages under `.dsh/wiki/` and tracks per-page source fingerprints), and Consumer ([dsh-tool-repo-wiki](../../packages/wiki/tool-repo-wiki), the model-facing `read_wiki` tool). The wiki is **one optional capability**, not part of the agent-loop spine. A provider swap does not change how callers or the model use the seam; with no provider registered, every read throws `RepoWikiError` `REPO_WIKI_UNAVAILABLE` and the tool answers with an actionable unavailable message. Storage layout and the generation pipeline are the provider's private concern — the seam is strictly read-only.

Source: [`packages/wiki/repo-wiki/src/types.ts`](../../packages/wiki/repo-wiki/src/types.ts)

## Pages and staleness

One read vocabulary shares the seam: a `WikiPageSummary` carries the wiki-relative `path`, the human `title` derived from the page's first heading, and the `stale` flag; a `WikiPage` adds the page's complete Markdown `content`; a `WikiOutlineEntry` adds the page's heading lines in document order; and `WikiListing` is the ordered page list behind `listPages`. Pages are plain Markdown files, so a generated wiki can be read directly, diffed, and committed to Git for team sharing.

Staleness is metadata, never an automatic rewrite: the provider records each page's generation-time source fingerprint in the page's front matter, and a read recomputes the fingerprint against the live sources. A page whose sources changed — or whose recorded source disappeared — reads back as `stale: true` while its content stays exactly as generated, so a wiki never changes behind a reader's back.

Providers register under an opaque identity string reserved atomically at registration; `RepoWikiError` extends `HarnessError` with stable codes `REPO_WIKI_INVALID_PROVIDER`, `REPO_WIKI_CONFLICT`, `REPO_WIKI_UNAVAILABLE`, `REPO_WIKI_INVALID_PATH`, and `REPO_WIKI_NOT_FOUND`, which callers route on instead of parsing `message`. Page paths are normalized before any provider call: they must be non-empty relative `.md` paths that stay inside the wiki root.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxrepowiki--repowikiservice"></a>

### `ctx.repoWiki` — `RepoWikiService`

The `ctx.repoWiki` surface: a single-provider reservation registry plus the read-only routes (`getPage`, `listPages`, `outline`) that forward to the registered provider. The seam exposes exactly the read routes — populating, regenerating, and storing pages is the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: RepoWikiProvider): () => void

/**
 * Route one page read to the registered provider.
 * @param path - the wiki-relative `.md` path.
 * @returns the page's identity and body.
 * @throws {@link RepoWikiError} with `REPO_WIKI_UNAVAILABLE` when no provider is registered.
 */
getPage(path: string): Promise<WikiPage>

/**
 * List every page through the registered provider.
 * @returns the page summaries ordered by path.
 * @throws {@link RepoWikiError} with `REPO_WIKI_UNAVAILABLE` when no provider is registered.
 */
listPages(): Promise<WikiListing>

/**
 * Return every page's heading structure through the registered provider.
 * @returns the outline entries ordered by path.
 * @throws {@link RepoWikiError} with `REPO_WIKI_UNAVAILABLE` when no provider is registered.
 */
outline(): Promise<readonly WikiOutlineEntry[]>
```

Source: [`packages/wiki/repo-wiki/src/types.ts`](../../packages/wiki/repo-wiki/src/types.ts)
<!-- END GENERATED cordis-surface -->