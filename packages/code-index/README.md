---
description: "The code-index group map: workspace code search through the code-index seam, its SQLite FTS5 provider, an opt-in hybrid provider with deployment-supplied embeddings, and the model-facing search_codebase tool, for users and maintainers navigating the group."
kind: "package-group"
---

# code-index/ — Workspace code search

English | [中文](README.zh.md)

## Summary

The code-index group lets agents run full-text search over a workspace's indexed source: a normalized query returns BM25-ranked line ranges with snippets. Use `code-index-sqlite` to build a derived, offline FTS5 index over a workspace root on `node:sqlite`, and `tool-code-index` to expose it to the model as `search_codebase`. Use `code-index-hybrid` instead when the deployment supplies an OpenAI-compatible embeddings endpoint: it adds structure-aware chunking and stores one vector per chunk, fusing BM25 and endpoint-embedding rankings by reciprocal-rank fusion. The shared `code-index` package keeps the request and result vocabulary provider-neutral, so swapping a provider does not change model requests. The index is derived data in a guarded, owner-only file and is always safe to delete and rebuild; the offline provider ships no embedding backend and reaches no network, and the hybrid provider reaches only the endpoint the deployment configures.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`code-index/`](code-index/README.md) | Defines the code-search service: an exclusive single-provider reservation and one order-independent lexical search route | `ctx.codeIndex` |
| [`code-index-sqlite/`](code-index-sqlite/README.md) | Builds a derived, owner-only FTS5 index over a workspace root and answers ranked, snippet-rendered queries | registers on `ctx.codeIndex` |
| [`code-index-hybrid/`](code-index-hybrid/README.md) | Optional provider adding block-aware chunking and deployment-supplied endpoint vectors fused with BM25 | registers on `ctx.codeIndex` |
| [`tool-code-index/`](tool-code-index/README.md) | Exposes ranked code search to the model through the `search_codebase` tool | registers on `ctx.tools` |

Providers register a corpus and a ranker, not tools: `tool-code-index` is the only owner of the model-facing name, schema, prompt guidance, and presentation, so swapping a provider never changes how the model asks for code search.

-----

<a id="related-documentation"></a>
## Related documentation

- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-code-index) — the `search_codebase` schema the model receives.
- [Code-index subsystem](../../docs/subsystems/code-index.md) — the seam's registration surface and vocabulary.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
