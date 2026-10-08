---
description: "The long-term-memory capability seam (ctx.memory): a single-provider reservation registry and four order-independent routes — remember, recall, forget, and list — over normalized requests, for users and maintainers composing or extending durable agent memory."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Summary

Use `dsh-memory` to give agents a durable long-term memory: a write returns an assigned id, a normalized recall returns ranked hits, and forget and list round out the store, so a provider's storage and ranking never change the request or the model-visible result. A single provider reserves the seam exclusively, and registration is atomic: an invalid or conflicting claim publishes nothing. Combine it with a provider such as `dsh-memory-sqlite` and the model-facing `dsh-tool-memory`; alone it answers no operation and throws `MEMORY_UNAVAILABLE`. It selects no embedding model on the caller's behalf.

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

Mount a memory provider and the `memory_write`/`memory_search`/`memory_forget` tools to give agents a store that persists across turns. This package is the service those packages register against; it defines no UI, tool, or store of its own.

### When to choose it

Choose this service when a deployment wants model-visible durable memory backed by a store the model never builds. It covers four routes — write, recall, forget, list — with provider-owned ranking and bounds; storage layout, timestamps, and any vector retrieval stay the provider's private concern. The service is provider-neutral: a local FTS5 store and any future backend register the same way, so replacing the provider does not change what the model sees or how it asks.

### Composing a memory stack

The seam needs a provider and a consumer to do anything. A minimal composition mounts the service, a SQLite provider, and the tools:

```yaml
- name: '@deepseek-ai/dsh-memory'
- name: '@deepseek-ai/dsh-memory-sqlite'
  config:
    path: .dsh/memory.sqlite
- name: '@deepseek-ai/dsh-tool-memory'
```

The store path, ranking, and result caps are configured in the provider package; see [dsh-memory-sqlite](../memory-sqlite/README.md) and [dsh-tool-memory](../tool-memory/README.md).

### The operations

`remember(draft, signal?)` takes a `MemoryDraft` — a required `text` plus optional `tags`, `scope`, `namespace`, `confidence`, and `ttlMs` — and returns the provider-assigned id. `recall(request, signal?)` takes a `MemoryRecallRequest` (a required `query`, optional `tags`, `scope`, `namespace`, `minConfidence`, and `limit`) and returns a `MemoryRecallResult` of `MemoryHit`s in descending relevance order, each wrapping a stored `MemoryRecord`. `forget(id, signal?)` returns `true` when a record was removed. `list(request?, signal?)` returns the most recent records, optionally filtered by the same refinements. A record carries the `namespace`, `confidence`, and computed `expiresAt` the draft supplied, and recall and listing filter on all three: an expired record is never returned. Every field but the required one is optional so a caller sends only what it means; the seam applies no timeout or cap, so there is no `resolve()` step.

### Failures and recovery

An operation fails with the structured error `MEMORY_UNAVAILABLE` when no provider is registered — mount a provider or continue without memory. Invalid or conflicting registrations fail with `MEMORY_INVALID_PROVIDER` or `MEMORY_CONFLICT` before any route is published, an operation against a disposed provider fails with `MEMORY_DISPOSED`, and a malformed request fails with `MEMORY_INVALID_REQUEST`. Consumers catch `MemoryError` and route on its stable `code`; through the tools, these surface as error or unavailable results the model can read.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Capability seam, Service Definition role.** The package owns `ctx.memory` and the provider registry; providers store records and rank recall, not tools, and `dsh-tool-memory` is the only owner of the model-facing surface.
- **Exclusive whole-corpus reservation.** One provider holds the seam at a time; unlike a per-caller route, a memory store claims the entire corpus, so a second registration is a conflict rather than a co-existing route.
- **Atomic registration.** `registerProvider()` validates and conflict-checks everything before mutating: an invalid or conflicting registration publishes nothing, and its disposer releases the reservation.
- **Order-independent routing.** Each of the four routes forwards to the single registered provider through `ctx.effect()`, so the reservation and the routes live and die with the registering fiber; registration and HMR order never change which provider answers.
- **Closed, provider-agnostic vocabulary.** The draft, record, hit, and request shapes are fixed across backends — adding a refinement is a compile-enforced change across the seam, providers, and the tools. There is no embedding or protocol escape hatch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Memory` service, `registerProvider`/`remember`/`recall`/`forget`/`list`, `MemoryError` codes |
| [`src/types.ts`](src/types.ts) | Seam vocabulary: draft, record, request, hit, page, provider, and service contracts |
| — | No runtime invariant companion is published; the provider reservation is private, atomically updated state; the seam exposes neither an enumerable snapshot nor lifecycle events to compare independently. |

### Registration and disposal lifecycle

Registration and disposal run through `ctx.effect()`, so the provider routes live and die with the registering fiber. `registerProvider()` returns a synchronous disposer; the seam drops the always-resolved effect promise so its disposer API stays synchronous. `MemoryError` extends `HarnessError` with stable codes (`MEMORY_INVALID_PROVIDER`, `MEMORY_CONFLICT`, `MEMORY_UNAVAILABLE`, `MEMORY_DISPOSED`, `MEMORY_INVALID_REQUEST`) that callers route on instead of parsing `message`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared memory model to the provider and the tools.

- [dsh-memory-sqlite](../memory-sqlite/README.md) — the SQLite FTS5 provider that registers against this seam.
- [dsh-tool-memory](../tool-memory/README.md) — the model-facing tools over this seam.
- [memory group map](../README.md) — the five-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-memory`, which owns the model-facing `memory_write`/`memory_search`/`memory_forget` schemas, prompt guidance, and rendered results while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-memory` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the seam's current scope. They are package constraints, not a task backlog.

- **Single provider per runtime** — one memory store is a whole-corpus claim, so a second registration conflicts instead of co-existing. A deployment-configured selector above registrations is the intended extension if multi-provider routing is ever needed.
- **Four routes, no observation API** — the seam exposes only `remember`, `recall`, `forget`, and `list`; there is no store-status query or provider-change event, and availability is observed only by running a route and routing the thrown `MemoryError` codes.
- **Provider-defined score unit** — a hit's `score` only orders results within one provider; the seam makes no cross-provider comparability promise, and no request carries a timeout or cap so consumers own those bounds.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
