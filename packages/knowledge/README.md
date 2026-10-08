---
description: "The knowledge group map: a shared, durable agent knowledge base through the knowledge seam, its SQLite FTS5 provider with bounded search excerpts, and the model-facing knowledge_ingest/knowledge_search/knowledge_remove/knowledge_list tools, for users and maintainers navigating the group."
kind: "package-group"
---

# knowledge/ — Shared knowledge base

English | [中文](README.zh.md)

## Summary

The knowledge group lets agents ingest, search, and curate a durable document corpus shared across sessions and users: an ingest stores one titled document and returns its id, a normalized search returns ranked hits with provider-computed snippets. Use `knowledge-sqlite` to build a zero-dependency FTS5/BM25 store on `node:sqlite`, and `tool-knowledge` to expose it to the model as `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list`. The shared `knowledge` package keeps the vocabulary provider-neutral. This group ships no default embedding backend and selects no model; for short per-user agent memories, see the memory group.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`knowledge/`](knowledge/README.md) | Defines the knowledge service: an exclusive single-provider reservation and four order-independent routes (ingest, search, remove, list) | `ctx.knowledge` |
| [`knowledge-sqlite/`](knowledge-sqlite/README.md) | Builds a zero-dependency FTS5/BM25 store and answers ranked search with bounded excerpts | registers on `ctx.knowledge` |
| [`tool-knowledge/`](tool-knowledge/README.md) | Exposes the knowledge base to the model through `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list` | registers on `ctx.tools` |

Providers store documents and rank search, not tools: `tool-knowledge` owns the model-facing tool names, schemas, prompt guidance, and presentation, so swapping a provider never changes how the model asks for knowledge.

-----

<a id="related-documentation"></a>
## Related documentation

- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-knowledge) — the four tool schemas the model receives.
- [Knowledge subsystem](../../docs/subsystems/knowledge.md) — the seam's registration surface and vocabulary.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
