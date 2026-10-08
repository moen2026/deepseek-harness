---
description: "The repository-wiki capability seam (ctx.repoWiki): a single-provider reservation registry and read-only routes — getPage, listPages, outline — over generated Markdown wiki pages, for users and maintainers composing or extending repository documentation for agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-repo-wiki

English | [中文](README.zh.md)

## Summary

Use `dsh-repo-wiki` to give agents a consolidated, generated view of repository documentation: read-only routes over wiki pages, each identified by a wiki-relative `.md` path and carrying a title, a staleness flag, and the generated Markdown body. A single provider reserves the seam exclusively and registration is atomic: an invalid or conflicting claim publishes nothing. The seam exposes only the read routes — writing pages is the provider's private concern. Combine it with a provider such as `dsh-repo-wiki-generator` and the model-facing `dsh-tool-repo-wiki`; alone it throws `REPO_WIKI_UNAVAILABLE`. A page whose sources changed reads back `stale` as metadata, never rewritten automatically.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this seam when you want agents to answer repository questions from generated, consolidated documentation; register a provider to populate it.

### The provider contract

A provider implements `RepoWikiProvider`: an opaque `id` plus three read routes — `getPage(path)` returning one full page, `listPages()` returning every page summary ordered by path, and `outline()` returning every page's heading structure. The provider owns page generation, storage, and staleness tracking; none of that appears on the seam.

### Page vocabulary

A page is a `WikiPage`: a wiki-relative `.md` `path`, a human `title` derived from the page's first level-1 heading, a `stale` flag, and the complete Markdown `content`. A summary (`WikiPageSummary`) drops the body; an outline entry (`WikiOutlineEntry`) adds the page's `#`-prefixed heading lines in document order. A listing (`WikiListing`) is the ordered set of every page summary.

### Path normalization

Paths are normalized at the seam: `normalizeWikiPath` trims, converts backslashes to forward slashes, and rejects a blank path, a path without a `.md` suffix, an absolute path, and any path containing `..`, so a read can never escape the wiki root.

### Failures

`RepoWikiError` extends `HarnessError` with stable codes: `REPO_WIKI_INVALID_PROVIDER` (blank provider id), `REPO_WIKI_CONFLICT` (seam already held), `REPO_WIKI_UNAVAILABLE` (no provider registered), `REPO_WIKI_INVALID_PATH` (malformed page path), and `REPO_WIKI_NOT_FOUND` (no page at that path). Callers route on `code`, not `message`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design notes

- **Single-provider reservation.** A wiki is a whole-repo claim, so a second registration while the seam is held throws `REPO_WIKI_CONFLICT`; the disposer releases the reservation and the read routes report `REPO_WIKI_UNAVAILABLE` again.
- **Validate and conflict-check before mutating.** `registerProvider` checks the id and the reservation state before publishing anything, so a rejected registration leaves the seam exactly as it was.
- **Atomic publish via `ctx.effect`.** The provider and its disposer are populated and cleared together inside one effect, so a route always has a live provider; the synchronous disposer API discards the effect's always-resolved promise.
- **Reads normalize before routing.** `getPage` normalizes its path at the seam, so providers receive canonical paths and malformed input surfaces as `REPO_WIKI_INVALID_PATH` before provider code runs.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `RepoWiki` service, provider reservation, and the routed read operations |
| [`src/types.ts`](src/types.ts) | Page vocabulary, provider contract, error codes, and path normalization |
| — | No runtime invariant companion is published; the provider reservation is private, atomically updated state; the seam exposes neither an enumerable snapshot nor lifecycle events to compare independently. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the seam to its provider and model-facing consumer.

- [Repository wiki subsystem](../../../docs/subsystems/repo-wiki.md) — the three-package split, storage layout, and staleness semantics in context.
- [`dsh-repo-wiki-generator`](../repo-wiki-generator/README.md) — the filesystem provider that generates pages from workspace sources and serves this seam's read routes.
- [`dsh-tool-repo-wiki`](../tool-repo-wiki/README.md) — the model-facing `read_wiki` tool that turns this seam into agent capability.
- [Tool Schema Catalog](../../../docs/tool-catalog.md) — every tool contributed to `ctx.tools`, including `read_wiki`.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-repo-wiki`, which owns the model-facing `read_wiki` schema, prompt guidance, and rendered results while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-repo-wiki` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is a poor fit. They are current package constraints, not a task backlog.

- **Single provider** — the seam holds exactly one provider; there is no per-tree routing or fallback chain.
- **Read-only surface** — the seam exposes no generation or write route; populating the wiki is entirely the provider's private concern.
- **No provider, no answers** — with no provider registered, every route throws `REPO_WIKI_UNAVAILABLE`; there is no built-in empty wiki.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
