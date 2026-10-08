---
description: "SQLite knowledge-base provider for the DeepSeek Harness knowledge seam (ctx.knowledge): a zero-dependency FTS5/BM25 lexical store over node:sqlite that answers ranked search with bounded excerpts, for users and maintainers configuring or replacing the local knowledge store."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-sqlite

English | [中文](README.zh.md)

## Summary

Use `dsh-knowledge-sqlite` as the local knowledge-base provider for `ctx.knowledge`: one plugin instance owns a dedicated derived store on `node:sqlite` where `ingest` writes a canonical document record plus an FTS5 row over title and body, `search` ranks with BM25 and returns a bounded excerpt around the first match, and `remove`/`list` delete and enumerate by recency. The store is zero-dependency and fully local; registration with the seam is effect-scoped, so disposal unregisters the provider and closes the database.

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

Mount the plugin on a context that provides `ctx.knowledge`, then mount `dsh-tool-knowledge` to expose the corpus to the model. Configure the store with the `path` config field; everything else defaults.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `path` | required | Dedicated derived-store path; `:memory:` is supported. Missing paths are created owner-only. |
| `openAt` | `startup` | Open the database at startup or lazily on the first operation. |
| `journalMode` | `wal` | SQLite journal mode: `wal`, `delete`, `truncate`, or `persist`. |
| `defaultLimit` | `10` | Result page size when a request omits `limit`. |
| `maxLimit` | `100` | Largest accepted page size and listing pool. |
| `maxTextBytes` | `65536` | UTF-8 byte ceiling for a single document's body. |
| `maxTitleBytes` | `512` | UTF-8 byte ceiling for a single document's title. |

```yaml
- name: '@deepseek-ai/dsh-knowledge-sqlite'
  config:
    path: .dsh/knowledge.sqlite
```

### Failures and recovery

A blank title or body, a NUL-bearing or oversized field, or an out-of-range limit fails with `KNOWLEDGE_INVALID_REQUEST`, and the seam routes it to the caller unchanged. An operation after disposal fails with `KNOWLEDGE_DISPOSED`. The database open guard refuses to reset a file that belongs to another application or carries unrecognized tables; an incompatible schema version resets the derived store in place.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Service Provider role.** The provider owns storage identity, timestamps, ranking, and snippet construction; it never touches tools or prompts, so swapping it does not change the model-visible surface.
- **Derived store, guarded open.** `openKnowledgeDatabase` stamps a `PRAGMA application_id` (`0x4453484b`) and `user_version`, refuses foreign databases, and resets an incompatible derived schema in place rather than guessing.
- **Inert FTS5 data.** Caller text is stored through a NUL sanitizer and every query is quoted as one FTS5 phrase, so an unbalanced quote in user input cannot break the match expression.
- **One connection.** All work is serialized through a single open connection, so ingests, searches, and closes never interleave.
- **Tag filters in JS.** Search prefilters lexically into a bounded pool, then applies the tag filter in JavaScript over loaded records, so tags never enter the FTS index.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `SqliteKnowledgeProvider`, `apply`, configuration schema |
| [`src/schema.ts`](src/schema.ts) | Guarded open, derived-store schema (`knowledge_records` + FTS5 `knowledge_docs`) |
| [`src/query.ts`](src/query.ts) | Draft and search normalization, byte caps, FTS5 quoting and sanitizing |
| — | No runtime invariant companion is published; the store is a derived cache of plain documents readable through any SQLite browser, and the seam routes own availability. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-knowledge](../knowledge/README.md) — the seam this provider registers against.
- [dsh-tool-knowledge](../tool-knowledge/README.md) — the model-facing tools over the seam.
- [knowledge group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-knowledge`: this package contributes no prompt section, tool schema, or rendered text. Search quality and snippet wording depend on this provider, but the model-visible schemas stay stable across providers.

#### KV Cache effect

None; this package contributes nothing to any request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the provider's current scope. They are package constraints, not a task backlog.

- **Lexical only** — search is BM25 over FTS5 with no vector path; semantic retrieval would be a new provider, since the seam keeps any embedding pipeline provider-private.
- **Whole documents, no chunking** — bodies are stored and searched as one unit within the byte cap; larger corpora with passage-level indexing need a provider that chunks privately.
- **One connection per store** — all work serializes through a single connection; a high-concurrency deployment would need a different provider, not a config flag.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The derived-store open guard and the single-connection scaffolding intentionally parallel `dsh-memory-sqlite`; both regions carry `jscpd:ignore` markers with that justification, because extracting a shared helper would couple two independently versioned storage schemas.

</details>
