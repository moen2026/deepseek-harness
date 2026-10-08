---
description: "The memory group map: durable long-term agent memory through the memory seam, its SQLite FTS5 provider with an optional fused vector path, the model-facing memory_write/memory_search/memory_forget tools, turn-end reflection that harvests durable candidates from completed turns, and the collaboration-style profile injected into model context, for users and maintainers navigating the group."
kind: "package-group"
---

# memory/ — Durable long-term agent memory

English | [中文](README.zh.md)

## Summary

The memory group lets agents persist, recall, and forget durable facts across turns: a write returns an id and a normalized recall returns ranked hits. Use `memory-sqlite` to build a derived, owner-only FTS5 store on `node:sqlite`, lexical by default with an optional fused vector path, and `tool-memory` to expose it to the model as `memory_write`/`memory_search`/`memory_forget`. `memory-reflection` harvests durable candidates from completed turns, and `memory-profile` injects saved `style` memories into model context. The shared `memory` package keeps the vocabulary provider-neutral. This group ships no default embedding backend and selects no model.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Defines the memory service: an exclusive single-provider reservation and four order-independent routes (remember, recall, forget, list) | `ctx.memory` |
| [`memory-sqlite/`](memory-sqlite/README.md) | Builds a derived, owner-only FTS5 store and answers ranked recall, with an optional fused vector path | registers on `ctx.memory` |
| [`tool-memory/`](tool-memory/README.md) | Exposes durable memory to the model through `memory_write`/`memory_search`/`memory_forget` | registers on `ctx.tools` |
| [`memory-reflection/`](memory-reflection/README.md) | Reflects on each completed root turn with one auxiliary model call and writes approved candidates through the seam | `ctx.llm`, `ctx.memory` |
| [`memory-profile/`](memory-profile/README.md) | Injects saved `style` memories into the model context as a runtime-context section | `ctx.systemPrompt`, `ctx.memory` |

Providers store records and rank recall, not tools: `tool-memory` owns the model-facing tool names, schemas, prompt guidance, and presentation, so swapping a provider never changes how the model asks for memory. `memory-reflection` and `memory-profile` sit above the same seam, so they stay provider-neutral too.

-----

<a id="related-documentation"></a>
## Related documentation

- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-memory) — the `memory_write`/`memory_search`/`memory_forget` schemas the model receives.
- [Memory subsystem](../../docs/subsystems/memory.md) — the seam's registration surface and vocabulary.
- [MCP memory guide](../../docs/user/guide/mcp-memory.md) — the external MCP memory path this opt-in built-in capability complements.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
