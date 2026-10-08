---
description: "Turn-boundary collaboration-style profile injection over the memory seam: reads saved `style` memories and contributes them to the runtime context as a system-prompt section so durable user preferences apply across turns, re-reading at load and after every turn end and contributing nothing when no provider is mounted, for users and maintainers composing long-term personalization."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-profile

English | [中文](README.zh.md)

## Summary

`dsh-memory-profile` turns the memory seam's `style` records into standing guidance: it lists the newest saved style memories and contributes them as a runtime-context section, so the model applies durable collaboration preferences across turns and sessions without a tool call. An absent or failing provider contributes nothing and keeps the last successful text, and model visibility rides the ordinary runtime-context mechanism, so every injected snapshot is recorded in the session log before it can shape a request. The package runtime-injects only `memory` and `systemPrompt` and never writes to the store.

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

Mount this plugin where saved collaboration-style memories should shape the model's behavior. The plugin only reads `ctx.memory`: the model-facing write path is `dsh-tool-memory`'s `memory_write` with `namespace: 'style'`, and `dsh-memory-reflection` may propose them.

### The injected section

The plugin refreshes its snapshot at load and after every turn end, listing at most `maxItems` style records in the provider's listing order (most recent first) and rendering a fixed header line plus one `- ` bullet per record. An empty store, an absent provider, or a failing read renders nothing; a failing read keeps the last successful text instead of flapping the section to empty. The section text is evaluated when a request is assembled, so a refresh that lands while a turn is already running applies from the next request onward.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxItems` | `20` | Largest number of style memories injected in one snapshot |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory-profile) is the exhaustive source for every accepted field.

### Failures and recovery

A non-positive-integer `maxItems` fails at load, so misconfiguration fails loud. A read failure — no provider mounted, a disposed provider, an I/O error — is absorbed: the plugin keeps the last successful text and retries at the next turn end, so a transient provider failure never breaks a turn and never empties a previously injected section.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the plugin and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design notes

- **Consumer-only.** The plugin runtime-injects only `memory` and `systemPrompt`; it writes nothing and imports no provider.
- **Turn-boundary refresh with a latch.** A refresh started while one is in flight is skipped, so a burst of turn ends cannot stack listings; the newest completed read replaces the cached text.
- **Failing reads keep their last success.** The refresh catches every read error and leaves the cached text untouched, so a transient provider failure does not flap the injected section to empty.
- **Pure rendering.** `renderProfile` returns `''` for an empty listing and otherwise the fixed header plus one bullet per record, so the injected text is a pure function of the listed records.
- **Logged before visible.** The text is served through the ordinary runtime-context mechanism under `memory:profile`, so every snapshot is recorded in the session log before it can shape a request.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config validation, `renderProfile`, the refresh latch, and the context registration |
| — | No runtime invariant companion is published; the plugin owns one cached string and a read latch, so there is no independent lifecycle stream or enumerable snapshot to compare. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the injected section to the seam and the store.

- [dsh-memory](../memory/README.md) — the seam this plugin reads.
- [dsh-memory-sqlite](../memory-sqlite/README.md) — the provider that answers the listing.
- [dsh-tool-memory](../tool-memory/README.md) — the model-facing write path for `style` memories.
- [memory group map](../README.md) — the five-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt context

#### What the model sees

One runtime-context section (first-party order 125, name `memory:profile`) carries the saved collaboration-style memories. With at least one stored record it renders the header line and one bullet per record, newest first:

##### Rendered section

```markdown
Saved collaboration style preferences for this user. Apply them unless the current task says otherwise:
- <style memory text>
```

#### Token effect

One header line plus one short bullet per injected record, recomputed at most once per turn end; with no stored style memory the rendered text is empty.

#### KV Cache effect

The section sits near the top of the system prompt (first-party order 125) and is stable between refreshes; saving or forgetting a `style` memory changes it at the next turn boundary, which invalidates prefix reuse from this section.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the plugin is a poor fit. They are current package constraints, not a task backlog.

- **Style namespace only** — the profile injects records classified `style`; `preference` and `fact` records stay reachable through `memory_search` and are never injected automatically.
- **Turn-boundary staleness** — a refresh lands at load and at the end of each turn, so a style memory written mid-turn first appears in the next snapshot, and a read that fails waits for the next turn end to retry.
- **Provider-gated** — with no memory provider mounted the plugin contributes nothing; it never falls back to another store.
- **Newest `maxItems` only** — the snapshot lists the provider's most recent records under the configured cap, so a style memory beyond the cap is not injected.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
