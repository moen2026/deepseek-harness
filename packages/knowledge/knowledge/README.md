---
description: "The knowledge-base capability seam (ctx.knowledge): a single-provider reservation registry and four order-independent routes — ingest, search, remove, and list — over normalized requests, for users and maintainers composing or extending a shared agent knowledge base."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge

English | [中文](README.zh.md)

## Summary

Use `dsh-knowledge` to give agents a durable, shared knowledge base: an ingest stores one titled document and returns its id, a normalized search returns ranked hits with provider-computed snippets, and remove and list round out the corpus, so a provider's storage and ranking never change the request or the model-visible result. A single provider reserves the seam exclusively, and registration is atomic: an invalid or conflicting claim publishes nothing. Combine it with a provider such as `dsh-knowledge-sqlite` and the model-facing `dsh-tool-knowledge`; alone it answers no operation and throws `KNOWLEDGE_UNAVAILABLE`. It selects no embedding model on the caller's behalf.

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

Mount a knowledge provider and the `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list` tools to give agents a document corpus that persists across sessions and users. This package is the service those packages register against; it defines no UI, tool, or store of its own.

### When to choose it

Choose this service when a deployment wants a curated, searchable document corpus the model can extend. It covers four routes — ingest, search, remove, list — with provider-owned ranking, snippets, and bounds; storage layout, chunking, and any vector retrieval stay the provider's private concern. The service is provider-neutral: a local FTS5 store and any future backend register the same way, so replacing the provider does not change what the model sees or how it asks. For short per-user agent memories, use the `memory` seam instead; a knowledge base is a whole-corpus claim of titled documents.

### Composing a knowledge stack

The seam needs a provider and a consumer to do anything. A minimal composition mounts the service, a SQLite provider, and the tools:

```yaml
- name: '@deepseek-ai/dsh-knowledge'
- name: '@deepseek-ai/dsh-knowledge-sqlite'
  config:
    path: .dsh/knowledge.sqlite
- name: '@deepseek-ai/dsh-tool-knowledge'
```

The store path, ranking, and result caps are configured in the provider package; see [dsh-knowledge-sqlite](../knowledge-sqlite/README.md) and [dsh-tool-knowledge](../tool-knowledge/README.md).

### The operations

`ingest(draft, signal?)` takes a `KnowledgeDraft` — a required `title` and `text` plus optional `tags` and `source` — and returns the provider-assigned id. `search(request, signal?)` takes a `KnowledgeSearchRequest` (a required `query`, optional `tags`, and `limit`) and returns a `KnowledgeSearchResult` of `KnowledgeHit`s in descending relevance order, each wrapping a stored `KnowledgeRecord` plus a provider-computed `snippet`. `remove(id, signal?)` returns `true` when a document was removed. `list(request?, signal?)` returns the most recent documents, optionally filtered by tag. Every field but the required ones is optional so a caller sends only what it means; the seam applies no timeout or cap, so there is no `resolve()` step.

### Failures and recovery

An operation fails with the structured error `KNOWLEDGE_UNAVAILABLE` when no provider is registered — mount a provider or continue without the knowledge base. Invalid or conflicting registrations fail with `KNOWLEDGE_INVALID_PROVIDER` or `KNOWLEDGE_CONFLICT` before any route is published, an operation against a disposed provider fails with `KNOWLEDGE_DISPOSED`, and a malformed request fails with `KNOWLEDGE_INVALID_REQUEST`. Consumers catch `KnowledgeError` and route on its stable `code`; through the tools, these surface as error or unavailable results the model can read.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Capability seam, Service Definition role.** The package owns `ctx.knowledge` and the provider registry; providers store documents and rank search, not tools, and `dsh-tool-knowledge` is the only owner of the model-facing surface.
- **Exclusive whole-corpus reservation.** One provider holds the seam at a time; unlike a per-caller route, a knowledge base claims the entire corpus, so a second registration is a conflict rather than a co-existing route.
- **Atomic registration.** `registerProvider()` validates and conflict-checks everything before mutating: an invalid or conflicting registration publishes nothing, and its disposer releases the reservation.
- **Order-independent routing.** Each of the four routes forwards to the single registered provider through `ctx.effect()`, so the reservation and the routes live and die with the registering fiber; registration and HMR order never change which provider answers.
- **Closed, provider-agnostic vocabulary.** The draft, record, hit, and request shapes are fixed across backends — adding a refinement is a compile-enforced change across the seam, providers, and the tools. There is no chunking, embedding, or protocol escape hatch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Knowledge` service, `registerProvider`/`ingest`/`search`/`remove`/`list`, `KnowledgeError` codes |
| [`src/types.ts`](src/types.ts) | Seam vocabulary: draft, record, request, hit, page, provider, and service contracts |
| — | No runtime invariant companion is published; the provider reservation is private, atomically updated state; the seam exposes neither an enumerable snapshot nor lifecycle events to compare independently. |

### Registration and disposal lifecycle

Registration and disposal run through `ctx.effect()`, so the provider routes live and die with the registering fiber. `registerProvider()` returns a synchronous disposer; the seam drops the always-resolved effect promise so its disposer API stays synchronous. `KnowledgeError` extends `HarnessError` with stable codes (`KNOWLEDGE_INVALID_PROVIDER`, `KNOWLEDGE_CONFLICT`, `KNOWLEDGE_UNAVAILABLE`, `KNOWLEDGE_DISPOSED`, `KNOWLEDGE_INVALID_REQUEST`) that callers route on instead of parsing `message`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared knowledge model to the provider and the tools.

- [dsh-knowledge-sqlite](../knowledge-sqlite/README.md) — the SQLite FTS5 provider that registers against this seam.
- [dsh-tool-knowledge](../tool-knowledge/README.md) — the model-facing tools over this seam.
- [knowledge group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-knowledge`, which owns the model-facing `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list` schemas, prompt guidance, and rendered results while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-knowledge` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the seam's current scope. They are package constraints, not a task backlog.

- **Single provider per runtime** — one knowledge base is a whole-corpus claim, so a second registration conflicts instead of co-existing. A deployment-configured selector above registrations is the intended extension if multi-provider routing is ever needed.
- **Four routes, no observation API** — the seam exposes only `ingest`, `search`, `remove`, and `list`; there is no corpus-status query or provider-change event, and availability is observed only by running a route and routing the thrown `KnowledgeError` codes.
- **Provider-defined score unit and snippets** — a hit's `score` only orders results within one provider, and a `snippet`'s length and delimiters are the provider's choice; the seam makes no cross-provider comparability promise, and no request carries a timeout or cap so consumers own those bounds.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
