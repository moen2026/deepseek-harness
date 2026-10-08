# Agent Note: Opt-in built-in long-term memory

Status: implemented

English | [中文](2026-09-27-opt-in-builtin-memory.zh.md)

## Problem

A repository-scale agent needs to persist a durable fact or preference when the user says "remember this." Until now the only supported memory path was a third-party MCP server: each option required its own installation, storage or account initialization, and for HTTP servers a separately supervised process ([the archived decision](../../archived/feature/2026-07-31-third-party-memory-mcp-examples.md); setup lives in the [memory MCP guide](../../../../docs/user/guide/mcp-memory.md)). With none of those running, the `full` preset's model had no first-party way to store or recall anything across sessions, even though the harness already ships its own SQLite-backed retrieval for sessions and could do the same for memories offline.

## Decision

A built-in long-term memory capability ships as the standard three-layer family: the [dsh-memory](../../../../packages/memory/memory) seam (`ctx.memory`: a single-provider reservation plus `remember`, `recall`, `forget`, and `list`), the [dsh-memory-sqlite](../../../../packages/memory/memory-sqlite) provider (a derived `node:sqlite` store answering recall with FTS5/BM25), and the [dsh-tool-memory](../../../../packages/memory/tool-memory) consumer (`memory_write`, `memory_search`, `memory_forget`, and a short system-prompt guidance section). The `full` agent preset mounts an isolated `memory` group in which the seam and the tools always load and the provider stays disabled until a deployment names a store file through `DSH_MEMORY_PATH`; with no provider the tools return an actionable unavailable answer instead of breaking session boot.

Recall ranks lexically by default. The vector path activates only when the deployment supplies its own OpenAI-compatible HTTP embedding endpoint through the provider's `embedding` config: writes then also store a vector in a side table, recall pre-filters with BM25 and fuses it with in-JS cosine similarity over the candidates, and any endpoint failure or timeout degrades to the lexical answer so memory stays available offline. In the preset, the endpoint is assembled from `DSH_EMBEDDING_URL`, `DSH_EMBEDDING_MODEL`, `DSH_EMBEDDING_AUTH_ENV`, and `DSH_EMBEDDING_DIMENSION`; the config stores only the *name* of the bearer-token variable, and the credential is read from the environment at call time and never written to YAML, the memory store, or logs.

This decision is purely additive against the MCP path: it removes or demotes nothing from [the archived decision](../../archived/feature/2026-07-31-third-party-memory-mcp-examples.md), whose example overlays still ship and whose guide stays authoritative for external memory servers. The neutrality statement carries over unchanged — DSH selects no model and no embedding provider; a deployment that configures no endpoint gets a purely lexical store. (The code-index seam's local hashed-subtoken semantic ranking is a separate, purely algorithmic path that does not touch this rule — see [the local semantic ranking decision](2026-09-29-local-hashed-semantic-code-index.md).)

## Alternatives considered

**Keep the MCP examples as the only memory path.** It kept failing the offline case: the `full` preset promises working reads and writes without external servers, accounts, or supervised processes, and the harness already owns the SQLite machinery for that. The MCP route remains available beside the built-in one.

**A native vector extension such as `sqlite-vec`.** The repository's supply-chain build policy forbids native build scripts, and `node:sqlite` loads no extensions. In-JS cosine similarity over a BM25-prefiltered candidate set keeps the fusion in-process with zero added dependencies.

**An embedding method on `ctx.llm` with a selected default provider.** The repo has no embedding seam today, and defaulting a provider would contradict the memory MCP guide's explicit stance that DSH does not choose a model or embedding provider; the endpoint therefore stays deployment-owned.

**Storing memories through the session or storage seams.** Those stores own persistence without ranking, result bounds, or snippet rendering; putting recall semantics in every consumer would duplicate the provider's work and diverge per surface.

## Consequences

- A deployment that sets no new environment variables sees no behavior change: the memory tools mount, the provider stays disabled, and memory operations answer "unavailable" in a form the model can report.
- The store file is derived, owner-only (`0o600`), guarded by a dedicated `PRAGMA application_id`, schema-versioned by `user_version`, and safe to delete and rebuild.
- Enabling the vector path adds one HTTP round trip per write and per prefiltered recall; the degrade-to-lexical guarantee keeps availability independent of the endpoint's health.
- Built-in memory and an external memory MCP server can both be mounted in the same deployment; their stores are never unified, and recall never crosses between them.
