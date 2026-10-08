---
description: "The opt-in hybrid code-index provider for ctx.codeIndex: structure-aware block chunking, BM25 over node:sqlite FTS5, and vectors from a deployment-supplied OpenAI-compatible embeddings endpoint, fused by reciprocal-rank fusion, for users and maintainers composing semantic code search."
kind: "package-reference"
---

# @deepseek-ai/dsh-code-index-hybrid

English | [中文](README.zh.md)

## Summary

Use `dsh-code-index-hybrid` to back `ctx.codeIndex` with block-aware code search when a deployment supplies its own embeddings endpoint. On first search (or eagerly at startup) it walks the workspace root, packs each bounded text file into chunks that never cut through a blank-line-delimited block, writes an FTS5 table on `node:sqlite`, and — when the endpoint is configured — stores one float32 vector per chunk. A normalized query ranks BM25 and endpoint embeddings, fused by reciprocal-rank fusion into snippet-rendered hits; an endpoint failure degrades to the lexical path with a warning at most once per provider. The index is derived data in a guarded, owner-only file, so it is safe to delete and rebuild. DSH never selects a model or embedding provider; source text from the indexed workspace is sent to the configured endpoint, so point it only at a service trusted with that source.

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

Mount this provider when a deployment wants semantic code search over its own workspace and already runs an OpenAI-compatible embeddings endpoint (for example Ollama serving `qwen3-embedding`). It needs the `dsh-code-index` seam and, for model access, `dsh-tool-code-index`; it reads source directly from `config.root` on the host filesystem. Without `config.embedding` the provider still mounts and serves pure BM25 over block-aware chunks.

### Minimal configuration

`path` is the dedicated derived-index file (`:memory:` is supported) and `root` is the absolute workspace to walk and index. `embedding` names the endpoint: `url` (an OpenAI-compatible `/v1/embeddings` shape), `model`, `authEnv` (the environment variable holding the bearer token, never the token itself), and `dimension`. An endpoint without authentication still needs `authEnv` to name a variable that is set — for example a dummy — because the credential is read from that variable at call time.

```yaml
- name: '@deepseek-ai/dsh-code-index'
- name: '@deepseek-ai/dsh-code-index-hybrid'
  config:
    path: .dsh/code-index-hybrid.sqlite
    root: .
    embedding:
      url: http://127.0.0.1:11434/v1/embeddings
      model: qwen3-embedding:0.6b
      authEnv: DSH_EMBEDDING_KEY
      dimension: 1024
- name: '@deepseek-ai/dsh-tool-code-index'
```

| Field | Default | Meaning |
|---|---|---|
| `path` | required | Derived-index file; missing filesystem paths are created owner-only (`0o600`); `:memory:` is supported |
| `root` | required | Absolute workspace root to walk and index |
| `openAt` | `startup` | Open and reconcile at startup, or on the first search |
| `journalMode` | `wal` | SQLite journal mode (a validated closed union, never caller-controlled SQL) |
| `defaultLimit` | `20` | Result count when a request omits `limit` |
| `maxLimit` | `200` | Largest accepted page size |
| `snippetChars` | `240` | Maximum snippet length in Unicode code points |
| `chunkLines` | `40` | Target lines per indexed chunk; a single block longer than this is hard-split |
| `chunkOverlap` | `4` | Trailing lines the next chunk re-opens; `0` disables overlap |
| `maxFileBytes` | `1000000` | Per-file size ceiling; larger files are skipped |
| `maxFiles` | `20000` | Total file ceiling per index build |
| `skipDirs` | `[]` | Extra directory names skipped in addition to the built-in set (`node_modules`, `.git`, …) |
| `includeGlobs` | `[]` | `*`/`?` globs restricting which relative paths are indexed when non-empty |
| `excludeGlobs` | `[]` | `*`/`?` globs excluding relative paths from indexing |
| `embedding` | absent | Deployment-supplied embeddings endpoint enabling the vector path; absent means lexical only |

Every numeric bound is validated positive and integral at load; an `embedding` block with a blank `url`, `model`, or `authEnv` fails loud at mount. Binary extensions and NUL-bearing files are skipped during the walk.

### What a search does

On the first query the provider opens the guarded database, walks `root`, splits each file into block-aware chunks (a chunk boundary never falls inside a block unless that block alone exceeds `chunkLines`, and the next chunk re-opens the trailing `chunkOverlap` lines), and stores one FTS5 row per chunk plus — when the endpoint is configured — one float32 vector keyed by the chunk. A fingerprint table re-chunks only files whose size or mtime changed and drops files that disappeared. `search()` normalizes the query into a single inert FTS5 phrase, ranks with `bm25()`, embeds the query text, scores every stored vector of the configured dimension by cosine similarity, and fuses both orderings by reciprocal-rank fusion — so a spaced paraphrase recalls a compound identifier it never spells literally. Any endpoint failure during indexing or search degrades to the lexical path; chunks indexed during a failure simply carry no vector.

### Observable success and failures

A successful query returns hits in descending relevance order with `path`, one-based `startLine`/`endLine`, optional `language`, `score`, and a marker-free bounded `snippet`; an empty result page is a successful no-match response. A blank or NUL-bearing query, or an out-of-range `limit`, fails with `CODE_INDEX_INVALID_REQUEST`. Opening a file that belongs to another application, or that has unrecognized tables, fails loudly rather than resetting it; a version mismatch resets the derived schema in place. After disposal, a query fails with `CODE_INDEX_DISPOSED`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Block-aware chunking, never mid-block cuts.** `chunkFile` packs blank-line-delimited blocks up to `chunkLines` and folds an overlap re-open into the next chunk's fresh content, so a function or paragraph stays whole and a symbol spanning a boundary is indexed on both sides.
- **Embedding is a deployment capability, not a DSH choice.** The vector path exists only when `config.embedding` names an endpoint; the embedder is the same HTTP client `dsh-memory-sqlite` exports, and DSH never selects a model or provider.
- **Degradation over unavailability.** Every endpoint failure — indexing or query time — degrades to the lexical path with one warning per provider, so search stays available offline.
- **Derived data, never authoritative.** The index is a rebuildable cache in a guarded file; the fingerprint table reconciles the corpus incrementally, and deleting the file is always safe.
- **Bounded walk.** Size ceilings, a total-file ceiling, a built-in skip-directory set, and a binary-extension table bound the corpus, so an unbounded workspace cannot make indexing run away.
- **Inert query text.** The shared `normalizeSearch` from `dsh-code-index-sqlite` quotes the caller text as one FTS5 phrase, so query syntax stays data.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, provider registration, walk, reconcile, fused `search()` |
| [`src/schema.ts`](src/schema.ts) | Guarded owner-only open, application-id and version reset, FTS5 and vector table creation |
| [`src/chunk.ts`](src/chunk.ts) | Block-aware chunking with overlap |
| — | No runtime invariant companion is published; the open connection and reconcile tail are private implementation state, and this provider publishes no independent lifecycle event stream or enumerable snapshot. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared search model to the seam and the tool.

- [dsh-code-index](../code-index/README.md) — the seam this provider registers against.
- [dsh-code-index-sqlite](../code-index-sqlite/README.md) — the offline sibling provider and the shared query helpers this package reuses.
- [dsh-tool-code-index](../tool-code-index/README.md) — the model-facing tool over the seam.
- [code-index group map](../README.md) — the four-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-code-index`, which surfaces this provider's ranked hits while this backend contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-code-index` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Source text leaves the process** — with `config.embedding` set, indexed source text and the query are sent to the configured endpoint; point it only at a service trusted with that source, and prefer a loopback or private-network deployment for proprietary code.
- **Whole-corpus brute-force vectors** — every query scores every stored vector in JS; large corpora should lower `maxFiles` or the embedding dimension. An ANN index is deferred.
- **Endpoints without authentication need a dummy variable** — the shared embedder reads the bearer token from `authEnv` at call time, so an unauthenticated local endpoint still needs `authEnv` to name a variable that is set; the header is sent and ignored.
- **Whole-corpus single provider** — this provider claims the entire seam for one `root`; only one provider may hold `ctx.codeIndex` at a time.
- **Reconcile granularity is per-file mtime/size** — a changed file is fully re-chunked and re-embedded; content-defined chunking and incremental sub-file diffs are deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
