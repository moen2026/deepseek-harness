---
description: "The SQLite FTS5 code-index provider for ctx.codeIndex: a derived, owner-only index over a workspace root, chunked into BM25-ranked FTS5 rows with a local hashed-subtoken vector per chunk, fused by reciprocal-rank fusion and queried with a bounded snippet, for users and maintainers composing local code search."
kind: "package-reference"
---

# @deepseek-ai/dsh-code-index-sqlite

English | [中文](README.zh.md)

## Summary

Use `dsh-code-index-sqlite` to back `ctx.codeIndex` with an offline code index built from a workspace root on `node:sqlite` FTS5. On first search (or eagerly at startup) it walks the root, splits each bounded text file into fixed-line chunks into an FTS5 table keyed by relative path, and answers a normalized query by fusing BM25 with a local hashed-subtoken semantic ranking into snippet-rendered hits. The index is derived data in a guarded, owner-only file, so it is safe to delete and rebuild; a fingerprint table reconciles changed files incrementally. The package installs nothing, reaches no network, and is read through `dsh-tool-code-index`.

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

Mount this provider when a deployment wants model-visible code search over its own workspace with no external service. It needs the `dsh-code-index` seam and, for model access, `dsh-tool-code-index`; it reads source directly from `config.root` on the host filesystem.

### Minimal configuration

`path` is the dedicated derived-index file (`:memory:` is supported) and `root` is the absolute workspace to walk and index. The provider opens and reconciles the index once — at startup when `openAt` is `startup`, otherwise lazily on the first search.

```yaml
- name: '@deepseek-ai/dsh-code-index'
- name: '@deepseek-ai/dsh-code-index-sqlite'
  config:
    path: .dsh/code-index.sqlite
    root: .
    defaultLimit: 20
    excludeGlobs: ['**/*.min.js']
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
| `chunkLines` | `40` | Lines per indexed chunk |
| `maxFileBytes` | `1000000` | Per-file size ceiling; larger files are skipped |
| `maxFiles` | `20000` | Total file ceiling per index build |
| `skipDirs` | `[]` | Extra directory names skipped in addition to the built-in set (`node_modules`, `.git`, …) |
| `includeGlobs` | `[]` | `*`/`?` globs restricting which relative paths are indexed when non-empty |
| `excludeGlobs` | `[]` | `*`/`?` globs excluding relative paths from indexing |
| `semantic` | `true` | Fuse BM25 with the local hashed-subtoken semantic ranking; `false` degrades to pure BM25 |

Every numeric bound is validated positive and integral at load; binary extensions and NUL-bearing files are skipped during the walk.

### What a search does

On the first query the provider opens the guarded database, walks `root`, and writes one FTS5 row per non-empty line chunk, recording each file's size and mtime fingerprint. A later reconcile re-chunks only files whose fingerprint changed and drops files that disappeared. `search()` normalizes the query into a single inert FTS5 phrase, optionally adds a path `LIKE` filter from `glob` and an exact `language` predicate, ranks with `bm25()`, fuses that ordering with per-chunk hashed-subtoken vector similarity by reciprocal-rank fusion — so a spaced paraphrase can recall a compound identifier it never spells literally — and returns bounded snippets, so an unbalanced quote in user input can never break the match expression.

### Observable success and failures

A successful query returns hits in descending relevance order with `path`, one-based `startLine`/`endLine`, optional `language`, `score`, and a marker-free bounded `snippet`; an empty result page is a successful no-match response. A blank or NUL-bearing query, or an out-of-range `limit`, fails with `CODE_INDEX_INVALID_REQUEST`. Opening a file that belongs to another application, or that has unrecognized tables, fails loudly rather than resetting it; a version mismatch resets the derived schema in place. After disposal, a query fails with `CODE_INDEX_DISPOSED`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Derived data, never authoritative.** The index is a rebuildable cache in a guarded file; the fingerprint table makes the corpus reconcile incrementally with the filesystem, and deleting the file is always safe.
- **Exclusive ownership guard.** `PRAGMA application_id` protects an unrelated database from an in-place reset; only a file this provider recognizes (or a fresh one) is ever mutated.
- **Inert query text.** `normalizeQuery` trims and collapses whitespace, then quotes the caller text as one FTS5 phrase, so query syntax stays data and reserved highlight markers are sanitized on both the write and read paths.
- **Serialized single connection.** All work runs through one open connection via an internal promise tail, so the first-search reconcile and subsequent queries never interleave half-built state.
- **Offline semantics by construction.** The semantic ranking is a pure function of the text — feature hashing over word and identifier subtokens — so no model, endpoint, or network participates, and a rebuild reproduces identical vectors.
- **Bounded walk.** Size ceilings, a total-file ceiling, a built-in skip-directory set, and a binary-extension table bound the corpus, so an unbounded workspace cannot make indexing run away.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, provider registration, walk, chunking, reconcile, `search()` |
| [`src/schema.ts`](src/schema.ts) | Guarded owner-only open, application-id and version reset, FTS5 table creation |
| [`src/query.ts`](src/query.ts) | Query normalization, FTS5 escaping, glob-to-`LIKE`, marker stripping, snippet bounding |
| [`src/semantic.ts`](src/semantic.ts) | Local hashed-subtoken embedding, int8 quantization, cosine similarity, reciprocal-rank fusion |
| — | No runtime invariant companion is published; the open connection and reconcile tail are private implementation state, and this provider publishes no independent lifecycle event stream or enumerable snapshot. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared search model to the seam and the tool.

- [dsh-code-index](../code-index/README.md) — the seam this provider registers against.
- [dsh-tool-code-index](../tool-code-index/README.md) — the model-facing tool over the seam.
- [code-index group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-code-index`, which surfaces this provider's ranked hits while this backend contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-code-index` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Subtoken-shaped semantics, not model semantics** — the fused semantic ranking is a deterministic hashed-subtoken projection: it bridges spaced queries and compound identifiers, but it does not generalize across synonyms or paraphrase, so conceptual queries still need known tokens.
- **Whole-corpus single provider** — this provider claims the entire seam for one `root`; there is no multi-root or partial-corpus routing, and only one provider may hold `ctx.codeIndex` at a time.
- **Host filesystem reads, no sandbox** — the provider reads `config.root` directly with `node:fs` and trusts the mounted execution world; it adds no confinement, so a restricted deployment must supply an appropriately scoped root or a sandboxed host.
- **Reconcile granularity is per-file mtime/size** — a changed file is fully re-chunked; content-defined chunking and incremental sub-file diffs are deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
