---
description: "The model-facing search_codebase tool: one read-only full-text search over the workspace's indexed source with optional glob and language refinements, relevance-ranked line ranges with snippets, and an actionable unavailable answer when no provider is mounted, for users and maintainers composing model code search."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-code-index

English | [中文](README.zh.md)

## Summary

`dsh-tool-code-index` gives a model one read-only `search_codebase` tool: a required `query` plus optional `glob` and `language` refinements return relevance-ranked line ranges with snippets over the workspace's indexed source. It is unavailable until a code-index provider is mounted; then the tool answers `ok`, otherwise it returns an actionable "index unavailable" message instead of failing the session, so the model falls back to grep/glob/read. Results are bounded by `maxResultChars`. The package runtime-injects only `tools`, `codeIndex`, and `systemPrompt` and imports no provider. Choose it when you know names or text but not their files.

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

An agent uses `search_codebase` when it knows an identifier or a phrase but not which file holds it, and a code-index provider is configured; the tool's prompt guidance tells it to fall back to grep/glob/read when the index is unavailable.

### The tool

`search_codebase` takes a required `query` (text or tokens to match) plus optional `glob` (e.g. `packages/**/*.ts`), `language` (e.g. `typescript`), and `limit`. The tool collapses whitespace in `query`, drops blank refinements, and rejects a non-positive-integer `limit` as an actionable argument error before querying. Provider choice, index path, workspace root, chunking, and result caps stay outside model input; they belong to the mounted provider.

### What the model gets back

The tool returns a closed result: `status` is `ok` with a `hits` array, or `unavailable` with an empty `hits` array when no provider holds the seam. Each hit carries a workspace-relative `path`, a one-based `startLine`/`endLine`, an optional `language`, a provider `score`, and a bounded `snippet`. Rendering emits one `path:startLine-endLine [language]  snippet` line per hit, best-score first; an empty page renders `No matching code found.` The complete text is bounded by `maxResultChars`, with a truncation notice counted inside the cap.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxResultChars` | `16000` | Largest complete rendered result, including the truncation notice |
| `timeoutMs` | `120000` | Tool-call timeout budget covering the first-search reconcile and query |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-code-index) is the exhaustive source for every accepted field.

### Failures and recovery

A `CODE_INDEX_UNAVAILABLE` from the seam is caught and returned as `status: 'unavailable'` so the session keeps running. A blank `query` or a malformed `limit` surfaces as an argument error the framework reports to the model. Any other `CodeIndexError` (an invalid request, a disposed provider) propagates as a structured tool error the model can read and route on.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design notes

- **Consumer-only.** The tool runtime-injects only `tools`, `codeIndex`, and `systemPrompt`, imports no provider, and passes only `exec.signal` to the seam.
- **Argument normalization before the seam.** `parseSearchArgs` trims and collapses `query`, trims optional refinements to absent-when-blank, and validates `limit`, so the provider receives a canonical request and malformed input is an actionable error rather than a crash.
- **Availability is data, not a crash.** The `execute` path catches `CodeIndexError` with code `CODE_INDEX_UNAVAILABLE` and returns `{ status: 'unavailable', hits: [] }`; every other error rethrows, so a genuinely broken provider is still surfaced.
- **Rendered result passthrough.** `output.render` maps the closed result to a single text part — the `unavailable` message or `formatHits(...)` output — so a native renderer sees the same canonical value the model reads.
- **Concurrency-safe read.** `isConcurrencySafe` returns `true`; the tool mutates nothing and a provider serializes its own reconcile.
- **Generic search-card presentation.** `presentSearchCall` renders a `{ card: 'generic', kind: 'search', title }` view whose title carries the query; there is no single target file, so no locations are attached.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, prompt section, `search_codebase` registration and execution |
| [`src/render.ts`](src/render.ts) | Pure argument validation, hit rendering with result caps, UI presentation |
| — | No runtime invariant companion is published; this stateless adapter contributes one tool and prompt section, while query lifecycle and result relations remain owned by the tool and code-index seams it composes. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the model-facing surface to the seam and the provider.

- [dsh-code-index](../code-index/README.md) — the seam this tool queries.
- [dsh-code-index-sqlite](../code-index-sqlite/README.md) — the provider that answers these queries.
- [code-index group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One system-prompt section (first-party order 2250) positions the code index among the search tools with the following text:

##### Verbatim guidance

```markdown
Use search_codebase for lexical full-text search over the workspace's indexed source when you know names or text but not their files; it returns ranked line ranges with snippets. It is unavailable until a code-index provider is configured — then fall back to grep/glob/read. Narrow with glob (e.g. packages/**/*.ts) or language (e.g. typescript) and raise limit only when the first page is not enough.
```

#### Token effect

Fixed guidance cost on every request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged; activation or disposal may invalidate reuse from this section.

### Tool schema

#### What the model sees

The model sees the generated [`search_codebase` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-code-index).

#### Token effect

Fixed schema cost on every request while enabled; the `timeoutMs` budget is never sent to the model.

#### KV Cache effect

Prefix-stable while the visible tool definition and order are unchanged; registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

One `path:startLine-endLine [language]  snippet` line per hit in descending `score` order, bounded by `maxResultChars`, or a distinct `No matching code found.` line for an empty page; when no provider is mounted the result is the actionable unavailable message instead of an error. A truncation notice is included inside the character cap.

#### Token effect

Capped per tool result by `maxResultChars`; the number of hits is additionally bounded by the request's `limit` and the provider's `maxLimit`.

#### KV Cache effect

Tool results append after the cached request prefix and do not directly invalidate it.

### UI presentation

#### What the model sees

Nothing. The client renders a generic search card — `{ card: 'generic', kind: 'search', title }` — whose title carries the query; there is no single target file, so no locations are attached.

#### Token effect

Zero direct token effect because rendering is client-side only.

#### KV Cache effect

None; UI presentation is outside the model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Provider-gated availability** — with no code-index provider mounted the tool always returns the unavailable message; it never builds an index itself, so a deployment must mount `dsh-code-index-sqlite` (or another provider) for real results.
- **Provider-defined ranking** — the tool exposes only what its provider ranks (fused BM25 and local hashed-subtoken semantics in the SQLite provider today); paraphrase recall is subtoken-shaped, not model-semantic, and the model is steered to fall back to grep/glob/read.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
