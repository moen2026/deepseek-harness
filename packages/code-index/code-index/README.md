---
description: "The code-index capability seam (ctx.codeIndex): a single-provider reservation registry and one order-independent lexical code-search route over a normalized request, for users and maintainers composing or extending workspace code search."
kind: "package-reference"
---

# @deepseek-ai/dsh-code-index

English | [中文](README.zh.md)

## Summary

Use `dsh-code-index` to give agents lexical full-text search over a workspace's indexed source: a normalized query returns ranked line ranges with match snippets, so a provider's ranking and corpus never change the request or the model-visible result. A single provider reserves the seam exclusively — a code index is a whole-corpus claim, not a per-extension route — and registration is atomic: an invalid or conflicting claim publishes nothing. This package must be combined with a provider such as `dsh-code-index-sqlite` and the model-facing `dsh-tool-code-index`; alone it answers no query and throws `CODE_INDEX_UNAVAILABLE`.

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

Mount a code-index provider and the `search_codebase` tool to give agents a ranked text search over source that stays stable when the backend changes. This package is the service those packages register against; it defines no UI, tool, or index of its own.

### When to choose it

Choose this service when a deployment wants model-visible code search backed by an index the model never builds. It covers one read-only lexical search returning scored hits; corpus construction, chunking, ranking, and result bounds stay the provider's private concern. The service is provider-neutral: a local FTS5 index and any future backend register the same way, so replacing the provider does not change what the model sees or how it asks.

### Composing a search stack

The seam needs a provider and a consumer to do anything. A minimal composition mounts the service, a SQLite provider, and the tool:

```yaml
- name: '@deepseek-ai/dsh-code-index'
- name: '@deepseek-ai/dsh-code-index-sqlite'
  config:
    path: .dsh/code-index.sqlite
    root: .
- name: '@deepseek-ai/dsh-tool-code-index'
```

The index path, workspace root, chunking, and result caps are configured in the provider package; see [dsh-code-index-sqlite](../code-index-sqlite/README.md) and [dsh-tool-code-index](../tool-code-index/README.md).

### The operation

`search(request, signal?)` takes a normalized `CodeSearchRequest` — a required `query` plus optional `glob`, `language`, and `limit` refinements — and returns a `CodeSearchPage` of `CodeSearchHit`s in descending relevance order. Every field but `query` is optional so a caller sends only what it means; the seam applies no timeout or cap, so there is no `resolve()` step. A hit carries a workspace-relative `path`, a one-based line range, an optional `language`, a provider-defined `score`, and a bounded `snippet`.

### Failures and recovery

A query fails with the structured error `CODE_INDEX_UNAVAILABLE` when no provider is registered — mount a provider or fall back to grep/glob/read. Invalid or conflicting registrations fail with `CODE_INDEX_INVALID_PROVIDER` or `CODE_INDEX_CONFLICT` before any route is published, a query against a disposed provider fails with `CODE_INDEX_DISPOSED`, and a malformed request fails with `CODE_INDEX_INVALID_REQUEST`. Consumers catch `CodeIndexError` and route on its stable `code`; through the tool, these surface as error results the model can read.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Capability seam, Service Definition role.** The package owns `ctx.codeIndex` and the provider registry; providers register a corpus and a ranker, not tools, and `dsh-tool-code-index` is the only owner of the model-facing surface.
- **Exclusive whole-corpus reservation.** One provider holds the seam at a time; unlike a per-extension route, a code index claims the entire workspace, so a second registration is a conflict rather than a co-existing route.
- **Atomic registration.** `registerProvider()` validates and conflict-checks everything before mutating: an invalid or conflicting registration publishes nothing, and its disposer releases the reservation.
- **Order-independent routing.** `search()` forwards to the single registered provider through `ctx.effect()`, so the reservation and the route live and die with the registering fiber; registration and HMR order never change which provider answers.
- **Closed, provider-agnostic vocabulary.** The request and hit shapes are fixed across backends — adding a refinement is a compile-enforced change across the seam, providers, and the tool. There is no index-building or protocol escape hatch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `CodeIndex` service, `registerProvider`/`search`, `CodeIndexError` codes |
| [`src/types.ts`](src/types.ts) | Seam vocabulary: request, hit, page, provider, and service contracts |
| — | No runtime invariant companion is published; the provider reservation is private, atomically updated state; the seam exposes neither an enumerable snapshot nor lifecycle events to compare independently. |

### Registration and disposal lifecycle

Registration and disposal run through `ctx.effect()`, so the provider route lives and dies with the registering fiber. `registerProvider()` returns a synchronous disposer; the seam drops the always-resolved effect promise so its disposer API stays synchronous. `CodeIndexError` extends `HarnessError` with stable codes (`CODE_INDEX_INVALID_PROVIDER`, `CODE_INDEX_CONFLICT`, `CODE_INDEX_UNAVAILABLE`, `CODE_INDEX_DISPOSED`, `CODE_INDEX_INVALID_REQUEST`) that callers route on instead of parsing `message`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared search model to the provider and the tool.

- [dsh-code-index-sqlite](../code-index-sqlite/README.md) — the SQLite FTS5 provider that registers against this seam.
- [dsh-tool-code-index](../tool-code-index/README.md) — the model-facing tool over this seam.
- [code-index group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-code-index`, which owns the model-facing `search_codebase` schema, prompt guidance, and rendered results while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-code-index` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the seam's current scope. They are package constraints, not a task backlog.

- **Single provider per runtime** — one code index is a whole-corpus claim, so a second registration conflicts instead of co-existing. A deployment-configured selector above registrations is the intended extension if multi-provider routing is ever needed.
- **One lexical search, no observation API** — the seam exposes only `search`; there is no index-status query or provider-change event, and availability is observed only by running `search()` and routing the thrown `CodeIndexError` codes.
- **Provider-defined score unit** — `score` only orders hits within one provider; the seam makes no cross-provider comparability promise, and the request carries no timeout or cap so consumers own those bounds.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
