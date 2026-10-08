---
description: "The SQLite FTS5 long-term-memory provider for ctx.memory: a derived, owner-only store that records memories as BM25-ranked FTS5 rows and answers lexical recall, with an optional fused vector path only when a deployment supplies its own embedding endpoint, for users and maintainers composing local agent memory."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-sqlite

English | [中文](README.zh.md)

## Summary

Use `dsh-memory-sqlite` to back `ctx.memory` with an offline, zero-dependency FTS5 store on `node:sqlite`. `remember` writes a record plus an FTS5 row, `recall` ranks with BM25, and `forget`/`list` delete and enumerate by recency. Only when a deployment supplies an HTTP embedding endpoint in `config.embedding` does it also store a vector and fuse BM25 with in-JS cosine similarity; any embedding failure degrades to the lexical path, so memory stays available offline. The store is derived data in a guarded, owner-only file, safe to delete and rebuild. It selects no embedding model and stores no credential.

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

Mount this provider when a deployment wants model-visible durable memory with no external service. It needs the `dsh-memory` seam and, for model access, `dsh-tool-memory`; it owns one SQLite file on the host filesystem and selects no embedding model unless the deployment configures one.

### Minimal configuration

`path` is the dedicated derived-store file (`:memory:` is supported). The provider opens the store once — at startup when `openAt` is `startup`, otherwise lazily on the first operation. Every numeric bound is validated positive and integral at load.

```yaml
- name: '@deepseek-ai/dsh-memory'
- name: '@deepseek-ai/dsh-memory-sqlite'
  config:
    path: .dsh/memory.sqlite
    defaultLimit: 10
- name: '@deepseek-ai/dsh-tool-memory'
```

| Field | Default | Meaning |
|---|---|---|
| `path` | required | Derived-store file; missing filesystem paths are created owner-only (`0o600`); `:memory:` is supported |
| `openAt` | `startup` | Open at startup, or lazily on the first operation |
| `journalMode` | `wal` | SQLite journal mode (a validated closed union, never caller-controlled SQL) |
| `defaultLimit` | `10` | Result count when a request omits `limit` |
| `maxLimit` | `100` | Largest accepted page size and listing pool |
| `maxTextBytes` | `8192` | UTF-8 byte ceiling for a single memory's text |
| `embedding` | absent | Optional external embedding endpoint that enables the vector path; absent means lexical only |

### Enabling the optional vector path

The vector path is off by default. Set `embedding` only when the deployment brings its own OpenAI-compatible endpoint; then `remember` also stores a vector and `recall` prefilters lexically before fusing. If the block is present but incomplete, the provider fails loud at load with `MEMORY_INVALID_REQUEST`.

```yaml
  config:
    path: .dsh/memory.sqlite
    embedding:
      url: https://embeddings.example/v1/embeddings
      model: my-embedding-model
      authEnv: MY_EMBEDDING_TOKEN
      dimension: 1536
      timeoutMs: 15000
      maxBatch: 64
```

| Field | Default | Meaning |
|---|---|---|
| `embedding.url` | required | Full embeddings endpoint URL (an OpenAI-compatible `/v1/embeddings` shape) |
| `embedding.model` | required | Model name sent to the endpoint |
| `embedding.authEnv` | required | Name of the environment variable holding the bearer token; never the token itself |
| `embedding.dimension` | required | Required embedding dimension; a mismatched response is rejected |
| `embedding.timeoutMs` | `15000` | Per-request timeout in milliseconds |
| `embedding.maxBatch` | `64` | Maximum inputs per request; longer batches are split |

The credential is read from `process.env[authEnv]` at call time and sent only as a header — it never enters configuration files, stored memories, or logs.

### What recall does

`recall` normalizes the request, runs one FTS5 `MATCH` ranked by `bm25()` to build a candidate pool, drops records filtered out by `tags`/`scope`/`namespace`/`minConfidence` and every expired record, and returns the ranked hits. The listing path applies the same filters. With an embedder configured it embeds the query, computes in-JS cosine similarity over each candidate's stored vector, and fuses the lexical and vector rankings by reciprocal-rank fusion before slicing to `limit`. A blank query, an out-of-range `limit`, or a text over `maxTextBytes` fails with `MEMORY_INVALID_REQUEST`. When the endpoint is unreachable or errors, the provider warns once and answers with the already-computed lexical ranking, so recall never fails because of embedding.

### Observable success and failures

A successful recall returns hits in descending relevance order, each wrapping a stored `MemoryRecord` (`id`, `text`, `tags`, optional `scope`, `namespace`, `confidence`, `createdAt`, `expiresAt`) plus a `score`; an empty result is a successful no-match response. Opening a file that belongs to another application, or that has unrecognized tables, fails loudly rather than resetting it; a version mismatch resets the derived schema in place. After disposal, an operation fails with `MEMORY_DISPOSED`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Derived data, never authoritative.** The store is a rebuildable cache in a guarded file; deleting it is always safe, and `application_id` plus `user_version` reconcile the schema on open.
- **Exclusive ownership guard.** `PRAGMA application_id` protects an unrelated database from an in-place reset; only a file this provider recognizes (or a fresh one) is ever mutated.
- **Lexical first, vector optional.** The default path needs no network, no model, and no secret; the vector path activates only when a deployment supplies its own endpoint, and every embedding failure degrades to the lexical ranking rather than failing the operation.
- **Fusion over raw scores.** Because BM25 and cosine live on incomparable scales, `reciprocalRankFusion` combines the two orderings by rank position, not score value, so no cross-backend calibration is assumed.
- **Serialized single connection.** All work runs through one open connection via an internal promise tail, so writes, recalls, and closes never interleave half-built state.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, provider, `remember`/`recall`/`forget`/`list`, embedding assertion, lifecycle |
| [`src/schema.ts`](src/schema.ts) | Guarded owner-only open, application-id and version reset, FTS5 and vector table creation |
| [`src/query.ts`](src/query.ts) | Draft/query normalization, FTS5 text sanitizing, cosine similarity, reciprocal-rank fusion, vector codecs |
| [`src/embedding.ts`](src/embedding.ts) | Optional OpenAI-compatible HTTP embedder reading `authEnv` at call time |
| — | No runtime invariant companion is published; the open connection and serialized work tail are private implementation state, and this provider publishes no independent lifecycle event stream or enumerable snapshot. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared memory model to the seam and the tools.

- [dsh-memory](../memory/README.md) — the seam this provider registers against.
- [dsh-tool-memory](../tool-memory/README.md) — the model-facing tools over the seam.
- [memory group map](../README.md) — the five-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-memory`, which surfaces this provider's ranked hits while this backend contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-memory` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Lexical by default** — with no `config.embedding` the store matches text and tokens by BM25 only; conceptual paraphrase recall needs the optional endpoint, and DSH never selects an embedding provider on the deployment's behalf.
- **Whole-corpus single provider** — this provider claims the entire seam for one store file; there is no multi-store or partial-corpus routing, and only one provider may hold `ctx.memory` at a time.
- **Best-effort vectors** — the vector is written after the record commits and any embedding failure only warns, so a memory may exist without a vector; recall still works lexically, but fusion coverage is not guaranteed for every record.
- **Host filesystem writes, no sandbox** — the provider reads and writes `config.path` directly with `node:sqlite` and trusts the mounted execution world; a restricted deployment must supply an appropriately scoped path or a sandboxed host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
