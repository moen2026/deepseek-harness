---
description: "Model-facing knowledge_ingest, knowledge_search, knowledge_remove, and knowledge_list tools over the DeepSeek Harness knowledge seam (ctx.knowledge): a safety-scanned ingest path, bounded rendered results, and a graceful unavailable answer, for users and maintainers tuning the model's knowledge-base surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-knowledge

English | [中文](README.zh.md)

## Summary

Use `dsh-tool-knowledge` to expose the shared knowledge base to the model: `knowledge_ingest` persists one titled document and returns its id, `knowledge_search` retrieves ranked hits with excerpts, `knowledge_remove` deletes one by id, and `knowledge_list` browses by tag. The tools own the model-visible schemas, prompt guidance, and rendered results, while the `ctx.knowledge` provider owns storage, ranking, and snippets — so swapping a provider never changes how the model asks. Without a registered provider, every tool answers with an actionable unavailable message instead of failing the session.

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

Mount the plugin on a context that provides `ctx.knowledge` (the seam plus a provider such as `dsh-knowledge-sqlite`); the tools register themselves and one system-prompt section.

```yaml
- name: '@deepseek-ai/dsh-knowledge'
- name: '@deepseek-ai/dsh-knowledge-sqlite'
  config:
    path: .dsh/knowledge.sqlite
- name: '@deepseek-ai/dsh-tool-knowledge'
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxResultChars` | `8000` | Largest complete rendered result in characters, including truncation metadata. |
| `timeoutMs` | `30000` | Tool-call timeout budget in ms. |

### The tools

`knowledge_ingest` takes a required `title` and `text`, optional `tags`, and optional `source`; it returns the provider-assigned id. Ingested documents re-enter model context on every search hit, so the ingest path scans the untrusted title and text and returns a `rejected` status with redacted findings instead of persisting an unsafe candidate. `knowledge_search` takes a required `query` plus optional `tags` and `limit`, and returns ranked hits with `snippet` fields. `knowledge_remove` takes an `id` and reports `ok` or `not_found`. `knowledge_list` takes optional `tags` and `limit` and returns most-recent-first document summaries. Every tool returns an `unavailable` status with guidance when no provider is mounted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Consumer role only.** The package owns model-facing names, schemas, prompt guidance, and presentation; it imports no provider and contributes nothing to storage or ranking.
- **Safety-scanned ingest.** The same scan discipline as `dsh-tool-memory` applies: persisted documents re-enter model context on every search, so the write path scans and refuses unsafe candidates.
- **Bounded rendering.** Results render as bounded text with a truncation notice, so a large corpus cannot flood the model's context through one call.
- **Graceful unavailability.** A missing provider is a normal deployment state, not an error: every tool returns the actionable `unavailable` answer and the session continues.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: four tool registrations, prompt section, configuration schema |
| [`src/render.ts`](src/render.ts) | Pure argument validation, result rendering, and UI presentation |
| — | No runtime invariant companion is published; the tools are stateless routes over the seam, and the seam's own error codes carry availability. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-knowledge](../knowledge/README.md) — the seam whose contract these tools project.
- [dsh-knowledge-sqlite](../knowledge-sqlite/README.md) — the local provider behind a default deployment.
- [knowledge group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

### Knowledge tools and prompt guidance

#### What the model sees

The model sees four tools — `knowledge_ingest`, `knowledge_search`, `knowledge_remove`, `knowledge_list` — plus one prompt section telling it when each applies. Search returns ranked hits as bounded text lines `[score] id  title — snippet [tags] (source)`; listing returns `id  title [tags] (source)` lines. All rendered results are capped at `maxResultChars` with a truncation notice. A rejected ingest returns the redacted scan findings and asks the model to rewrite; an unmounted provider returns the actionable unavailable answer.

#### Token effect

The four schemas and the prompt section contribute fixed request-context tokens while the provider is mounted; rendered results land in tool results, not the request prefix.

#### KV Cache effect

The prompt section is static per configuration, so request prefixes stay stable across calls; rendered results land in tool results, not the prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the tools' current scope. They are package constraints, not a task backlog.

- **No update route** — documents are immutable once ingested; the model removes and re-ingests to revise one, matching the seam's four routes.
- **No cross-session scoping in the tool layer** — the corpus is deployment-wide; per-workspace or per-user partitioning is the provider's concern, and the tools expose only tags.
- **Snippet wording is provider-owned** — the excerpt's length and delimiters vary across providers, and the tools render them verbatim.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
