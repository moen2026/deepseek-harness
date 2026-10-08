# Agent Note: Local hashed-subtoken semantic ranking for the code index

Status: implemented

English | [中文](2026-09-29-local-hashed-semantic-code-index.zh.md)

## Problem

`search_codebase` ranked with BM25 only: a query phrased as separate words ("codebase search") could not recall a compound identifier it never spelled literally (`searchCodebase`), because the unicode61 tokenizer keeps the identifier as one token. Closing that gap with a neural embedding would require selecting a model or an endpoint, and the repository's standing neutrality rule — DSH selects no model and no embedding provider — plus the offline "installs nothing, reaches no network" contract both forbid that ([the memory decision](2026-09-27-opt-in-builtin-memory.md); the provider readme's limitations said so explicitly).

## Decision

The SQLite code-index provider ships a local, deterministic semantic ranking on by default (`semantic: true`). At index time each chunk is projected through feature hashing over word tokens, camelCase/acronym subtokens, adjacent subtoken pairs, and adjacent word pairs; the projection is L2-normalized and stored as int8 quantization in a per-chunk `code_vec` BLOB table (schema version 2 — older derived indexes reset and rebuild in place). At query time the same pure function embeds the query, an in-JS cosine scan over the vector table produces a second ranking, and reciprocal-rank fusion merges it with BM25; semantic-only matches (no lexical hit at all) still reach the page. The semantic scan applies only the glob/language refinements, never the MATCH expression, because broadening the lexical hit set is the point. Setting `semantic: false` degrades the provider to pure BM25.

This is an algorithm, not a model: the projection is a pure function of the text, involves no weights, endpoint, or network, and reproduces identical vectors on rebuild. The neutrality rule is therefore untouched — DSH still selects no neural embedding model or provider, and the memory provider's external-endpoint vector path ([the memory decision](2026-09-27-opt-in-builtin-memory.md)) is unchanged.

## Alternatives considered

**A deployment-supplied embedding endpoint, as memory does.** The code-index config surface has no endpoint field today, and requiring one breaks the provider's "installs nothing, reaches no network" contract; the memory package keeps that path for recall quality that needs true semantics.

**A local ONNX model such as MiniLM.** Real neural semantics offline, but model weights must be vendored and the native runtime collides with the supply-chain build policy; it also changes the "installs nothing" promise.

**Subtoken-aware FTS tokenization.** A custom unicode61 tokenizer wrapping is fragile, and it still cannot rank or bridge paraphrase shape — it only widens the lexical hit set.

**Default the semantic path off.** It would preserve the old behavior but forfeit the zero-configuration recall gain that motivates the work; the flag exists for deployments that want exactly the old ranking.

## Consequences

- With no configuration change, spaced paraphrases recall compound identifiers; `semantic: false` restores the previous ranking exactly.
- The derived index gains one 128-byte vector per chunk (schema version 2); a v1 index resets and rebuilds transparently.
- Recall cost is one linear int8 dot-product scan over the corpus per query — milliseconds at the provider's file ceilings — so no ANN index is warranted; hit scores on the fused path are reciprocal-rank-fusion scores (a provider-defined unit), not BM25 values.
- The fusion widens recall but adds no synonym understanding; the limitations sections of the affected readmes describe the subtoken-shaped boundary rather than a lexical-only one.
