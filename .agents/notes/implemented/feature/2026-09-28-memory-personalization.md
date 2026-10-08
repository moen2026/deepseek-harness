# Agent Note: Turn-end reflection and the collaboration-style profile

Status: implemented

English | [中文](2026-09-28-memory-personalization.zh.md)

## Problem

Built-in long-term memory ([opt-in built-in memory](2026-09-27-opt-in-builtin-memory.md)) stores and recalls durable facts, but recall was fully caller-driven: the model only remembered a saved preference when it chose to run `memory_search`, and a "remember my style" instruction did not affect it on its own. Memories also carried no type, confidence, or expiry, so a preference, a project fact, and a transient detail were indistinguishable at recall time, and nothing derived standing model guidance from what the store already knew.

## Decision

Memory records become typed and expirable across the whole family. `MemoryDraft`, `MemoryRecord`, `MemoryRecallRequest`, and `MemoryListRequest` gain an optional closed-vocabulary `namespace` (`preference`, `fact`, `style`), a `confidence` from 0 through 1, and a `ttlMs` write option whose provider-computed `expiresAt` never reaches recall or listing results once past; `recall` and `list` filter on namespace and a `minConfidence` threshold beside the existing `tags`/`scope` filters. The SQLite provider moves to schema version 2 with `namespace`, `confidence`, and `expires_at` columns, and `dsh-tool-memory` extends the `memory_write`/`memory_search` parameters and its prompt guidance accordingly.

Two new Consumers sit above the same seam. [dsh-memory-reflection](../../../../packages/memory/memory-reflection) reflects on each completed root-session turn: one auxiliary model call reads that turn's human and assistant text, a tolerant JSON parser accepts at most ten candidates, and validated candidates write back through `ctx.memory` tagged `reflection`. The write path defaults to `write: 'ask'`, putting candidates to the human through the user-questions service; `write: 'auto'` writes directly. The exact request is logged as `memory/reflection-llm-request` before dispatch and each outcome as `memory/reflection`, so every reflection stays reconstructable from the session log, and a missing provider, missing route, or any model or write failure stops or warns without failing the turn.

[dsh-memory-profile](../../../../packages/memory/memory-profile) turns saved `style` records into standing guidance: it lists the newest records up to `maxItems` at load and after every turn end and contributes them as a runtime-context section (`memory:profile`, first-party order 125), so the model applies durable collaboration preferences without a tool call. An absent or failing provider contributes nothing and keeps the last successful text; every injected snapshot is recorded in the session log before it can shape a request.

## Alternatives considered

**Extracting after every step or model call.** Per-step extraction multiplies auxiliary cost and would harvest partial exchanges; the turn boundary is the smallest unit where the human and assistant text form a complete unit of intent.

**Writing candidates without asking by default.** The default `ask` gate keeps unattended accumulation opt-in: a mis-extracted memory silently shapes every future turn, and the question flow is the cheapest correction point. `auto` stays available for unattended deployments.

**Injecting every namespace into model context.** Only `style` records become standing guidance; `preference` and `fact` records are task-relevant rather than standing, stay reachable through `memory_search`, and injecting the whole store would grow the system prompt with stale, low-relevance content.

**One combined plugin for reflection and profile.** The write side and the model-visible side evolve independently and a deployment may mount either alone; splitting them keeps each plugin's configuration and failure behavior narrow.

**Relying on `tags` for classification instead of a typed namespace.** Tags stay free-form classification, but a closed namespace vocabulary makes filtering, validation, and the profile's selection compile-enforced across the seam, the provider, and the tools.

## Consequences

- The profile section changes the system prompt when `style` memories change, so saving or forgetting one invalidates prefix reuse from the section at the next turn boundary.
- Each completed root turn may add one auxiliary generation; `maxInputBytes`, `maxOutputTokens`, and `timeoutMs` bound it, but the cost is real and per-turn.
- Expired records disappear from `recall` and `list`; expiry is computed by the provider at write time and stored as `expiresAt`.
- With no provider or no route, reflection stops before calling the model; extraction failures log a warning and never fail a turn.
- The refreshed vocabulary is compile-enforced across the seam, the provider, and the tools.
