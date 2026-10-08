---
description: "The model-facing memory tools: memory_write, memory_search, and memory_forget over the ctx.memory seam, with an actionable unavailable answer when no provider is mounted, lexical-by-default recall, and an optional semantic ranking only when the deployment supplies its own embedding endpoint, for users and maintainers composing model long-term memory."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

English | [中文](README.zh.md)

## Summary

`dsh-tool-memory` gives a model three tools over `ctx.memory`: `memory_write` persists a durable fact and returns its id — after `scanUntrustedText` rejects unsafe text with redacted findings, because a persisted memory re-enters model context on every recall — `memory_search` returns ranked hits, and `memory_forget` deletes one by id. All three are unavailable until a memory provider is mounted; without one they return an actionable "memory unavailable" message instead of failing the session. Recall ranks lexically by default; a semantic ranking activates only when the deployment configures its own embedding endpoint, and DSH never selects a model or embedding provider. Search results are bounded by `maxResultChars`. The package runtime-injects only `tools`, `memory`, and `systemPrompt` and imports no provider.

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

An agent writes a memory when the user asks it to remember something, searches when past context may be relevant, and forgets when asked to drop a prior memory; the tool's prompt guidance tells it all three are optional and to continue without memory when unavailable.

### The tools

`memory_write` takes a required `text` plus optional `tags`, `scope`, `namespace`, `confidence`, and `ttl_ms`. `memory_search` takes a required `query` plus optional `tags`, `scope`, `namespace`, `min_confidence`, and `limit`. `memory_forget` takes a required `id`. Each trims its inputs, drops blank refinements, normalizes `tags` (trimmed, de-duplicated, order-preserving), validates a supplied `namespace` against the closed `preference`/`fact`/`style` vocabulary, a supplied `confidence` or `min_confidence` within 0 through 1, and a supplied `ttl_ms` as a positive integer, and rejects a blank required field or a non-positive-integer `limit` as an actionable argument error before touching the seam. Provider choice, storage path, ranking, and result bounds stay outside model input; they belong to the mounted provider.

### What the model gets back

Each tool returns a closed result. `memory_write` returns `status` `ok` with an `id`, or `unavailable`. `memory_search` returns `status` `ok` with a ranked `hits` array (each an `id`, `text`, `tags`, optional `scope`, `namespace`, `confidence`, `createdAt`, `expiresAt`, `score`), or `unavailable` with an empty `hits`; an expired memory is never returned. `memory_forget` returns `status` `ok`, `not_found`, or `unavailable`. Rendering emits `Remembered (id: …).` for a write, one `[score] id  text [tags] (scope)` line per search hit, with ` namespace=` and ` conf=` suffixes when the record carries them, best-first (`No matching memories found.` for an empty page), and `Memory forgotten.` or `That memory id was not found.` for a forget. The complete search text is bounded by `maxResultChars`, with a truncation notice counted inside the cap.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxResultChars` | `8000` | Largest complete rendered search result, including the truncation notice |
| `timeoutMs` | `30000` | Tool-call timeout budget, covering a possible embedding round trip |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-memory) is the exhaustive source for every accepted field.

### Failures and recovery

A `MEMORY_UNAVAILABLE` from the seam is caught and returned as `status: 'unavailable'` so the session keeps running. A blank required field or a malformed `limit` surfaces as an argument error the framework reports to the model. Any other `MemoryError` (an invalid request, a disposed provider) propagates as a structured tool error the model can read and route on.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design notes

- **Consumer-only.** The tools runtime-inject only `tools`, `memory`, and `systemPrompt`, import no provider, and pass only `exec.signal` to the seam.
- **Argument normalization before the seam.** `parseWriteArgs`, `parseSearchArgs`, and `parseForgetArgs` trim and collapse inputs, normalize tags, validate `namespace`/`confidence`/`min_confidence`/`ttl_ms`, and validate `limit`, so the provider receives a canonical request and malformed input is an actionable error rather than a crash.
- **Availability is data, not a crash.** Each `execute` catches `MemoryError` with code `MEMORY_UNAVAILABLE` and returns an `unavailable` status; every other error rethrows, so a genuinely broken provider is still surfaced.
- **Lexical default, optional semantics.** The tools never embed or rank themselves; they surface whatever the mounted provider ranks, and the prompt states that semantic ranking exists only when the deployment supplies its own endpoint.
- **Concurrency reflects writes.** `memory_search` returns `isConcurrencySafe: true` (a pure read); `memory_write` and `memory_forget` return `false` because they mutate the store.
- **Generic card presentation.** `presentWriteCall`/`presentSearchCall`/`presentForgetCall` render `{ card: 'generic', kind, title }` views titled with the excerpt, query, or id; there is no target file, so no locations are attached.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, prompt section, `memory_write`/`memory_search`/`memory_forget` registration and execution |
| [`src/render.ts`](src/render.ts) | Pure argument validation, hit rendering with result caps, UI presentation |
| — | No runtime invariant companion is published; these stateless adapters contribute three tools and one prompt section, while storage lifecycle and result relations remain owned by the tool and memory seams they compose. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the model-facing surface to the seam and the provider.

- [dsh-memory](../memory/README.md) — the seam these tools query.
- [dsh-memory-sqlite](../memory-sqlite/README.md) — the provider that answers these operations.
- [memory group map](../README.md) — the five-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One system-prompt section (first-party order 2450) positions the memory tools and their optionality with the following text:

##### Verbatim guidance

```markdown
Use memory_write to persist a durable fact or preference when the user asks you to remember something, memory_search to recall stored memories when past context may be relevant, and memory_forget to remove a memory by its id. A written memory may carry a namespace (preference, fact, or style), a confidence, and a ttl_ms expiry after which it stops being recalled. All three are unavailable until a memory provider is configured — then continue normally without memory. Recall ranks lexically by default; an optional semantic ranking is active only when the deployment supplies its own embedding endpoint, and DSH never selects a model or embedding provider on your behalf.
```

#### Token effect

Fixed guidance cost on every request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged; activation or disposal may invalidate reuse from this section.

### Tool schema

#### What the model sees

The model sees the generated [`memory_write`, `memory_search`, and `memory_forget` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory).

#### Token effect

Fixed schema cost on every request while enabled; the `timeoutMs` budget is never sent to the model.

#### KV Cache effect

Prefix-stable while the visible tool definitions and order are unchanged; registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

A write returns `Remembered (id: …).`; a search returns one `[score] id  text [tags] (scope)` line per hit, with ` namespace=` and ` conf=` suffixes when the record carries them, in descending `score` order, bounded by `maxResultChars`, or a distinct `No matching memories found.` line for an empty page; a forget returns `Memory forgotten.` or `That memory id was not found.`. When no provider is mounted, every result is the actionable unavailable message instead of an error. A truncation notice is included inside the character cap.

#### Token effect

The search result is capped by `maxResultChars`; the number of hits is additionally bounded by the request's `limit` and the provider's `maxLimit`. Write and forget results are single short lines.

#### KV Cache effect

Tool results append after the cached request prefix and do not directly invalidate it.

### UI presentation

#### What the model sees

Nothing. The client renders generic cards — `{ card: 'generic', kind, title }` — titled with the write excerpt (`other`), the search query (`search`), or the forget id (`other`); there is no target file, so no locations are attached.

#### Token effect

Zero direct token effect because rendering is client-side only.

#### KV Cache effect

None; UI presentation is outside the model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tools are a poor fit. They are current package constraints, not a task backlog.

- **Provider-gated availability** — with no memory provider mounted the tools always return the unavailable message; they never store anything themselves, so a deployment must mount `dsh-memory-sqlite` (or another provider) for real writes and recalls.
- **No embedding selection** — the tools expose ranking only through their provider; recall is lexical unless the deployment configures its own embedding endpoint, and DSH never picks a model or embedding provider for the model.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
