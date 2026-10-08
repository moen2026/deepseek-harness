---
description: "Turn-end memory reflection over the memory seam: one auxiliary model call per completed turn extracts durable preferences, style guidance, and project facts from that turn's human and assistant text, and validated candidates are written back through `ctx.memory` after user approval by default (`write: 'ask'`) or directly (`write: 'auto'`), for users and maintainers composing long-term personalization."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-reflection

English | [中文](README.zh.md)

## Summary

`dsh-memory-reflection` harvests durable memory from ordinary work: after each completed root-session turn, one auxiliary model call reads that turn's human and assistant text and returns candidates that the plugin validates and writes through `ctx.memory`, tagged `reflection` and classified by namespace. Candidates that fail the safety scan (`scanUntrustedText`) are dropped before approval. The write path defaults to asking the user first (`write: 'ask'`) and can write directly (`write: 'auto'`). The exact model-visible request and the recorded outcome are session events, so every reflection is reconstructable from the log. A missing provider or route stops the reflection silently, and no extraction failure ever fails the turn. The package runtime-injects `llm` and `memory`.

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

Mount this plugin on sessions where durable preferences, style guidance, and project facts should accumulate without the user asking. It watches `turn/start`, `user/message`, `assistant/message`, and `turn/end` on every root session: the turn's human-authored and assistant text is buffered, and at `turn/end` the plugin reflects on it in the background — the finished turn is never delayed or failed by extraction. Child sessions share the root's turns and are skipped.

### The reflection call

One auxiliary request per qualifying turn sends a fixed extraction instruction plus the turn's messages framed as a JSON array, clamped to `maxInputBytes` by keeping the newest messages (an oversized final message is truncated rather than dropped). The route is the configured `provider`/`model` pair when present, otherwise the session's logged `request/header` route. The answer is parsed tolerantly: prose around one JSON object is tolerated, at most ten candidates are accepted, an unclassifiable namespace defaults to `fact`, and a missing or invalid confidence defaults to `0.7`. A blank or unparseable answer yields no candidates and no write.

### Writing candidates

With `write: 'ask'` (the default) the plugin asks the user to `Save` or `Discard` through the user-questions service, listing the candidate texts; with `write: 'auto'` it writes immediately. Written memories carry the candidate's text, namespace, and confidence plus the `reflection` tag. When candidates were extracted, the write path records `memory/reflection` on the session with outcome `written` (with the assigned ids), `rejected`, or `unavailable`; the exact request is recorded as `memory/reflection-llm-request` before dispatch. Turns that produce no candidates record nothing.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `write` | `ask` | Ask the user to approve candidates, or `auto` to write them directly |
| `provider` / `model` | session route | Explicit route for the auxiliary call; must be supplied together |
| `timeoutMs` | `30000` | End-to-end reflection-call deadline in milliseconds |
| `maxOutputTokens` | `512` | Reflection output-token cap |
| `maxInputBytes` | `32768` | Maximum UTF-8 bytes in the final JSON-framed user prompt |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory-reflection) is the exhaustive source for every accepted field.

### Failures and recovery

Extraction runs detached from the turn: a model error, a timeout, or a write error is logged as a warning and never fails the session, and a second turn end while one reflection still runs is dropped rather than queued. The reflection stops without a model call when the turn holds no text, when no memory provider holds the seam (a one-record probe listing checks first), or when no route resolves. An approval that cannot be asked — no user-questions service mounted — records `unavailable` and writes nothing. Configuration problems fail loud at load: unknown keys, non-positive bounds, and an unpaired `provider`/`model` are rejected.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the reflection and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design notes

- **Turn-end, not per-step.** Extraction runs once per completed turn from the buffered human and assistant text, so cost and latency stay bounded per turn and a partial exchange is never extracted.
- **Root sessions only.** `turn/start` seeds a buffer for sessions without a parent; child sessions share the root's turns and are skipped.
- **One reflection per session at a time.** A session with an in-flight reflection drops a new turn end, so overlapping calls cannot double-write.
- **Probe before paying.** A one-record listing confirms that a provider holds the seam before any model call; without one the reflection stops with no cost.
- **Tolerant parsing, closed vocabulary.** `parseReflectionCandidates` tolerates prose around one JSON object and yields no candidates for a blank or non-conforming answer, defaulting an unclassifiable namespace to `fact` and an invalid confidence to `0.7`.
- **Explicit route resolution.** The configured pair wins; otherwise the session's logged request route answers; with neither, the reflection stops.
- **Logged before visible.** The exact request is appended as `memory/reflection-llm-request` before dispatch, and each write-path outcome is appended as `memory/reflection`.
- **Detached failures.** The whole reflection is wrapped: any error warns once through the plugin logger, and the session's in-flight marker is released in `finally`.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config validation, session-event buffering, the reflection call, approval, write-back, and events |
| [`src/extract.ts`](src/extract.ts) | Pure extraction policy: system instruction, framing and clamping, candidate parsing, route resolution, finish translation |
| — | No runtime invariant companion is published; the buffered turn text and the in-flight marker are private per-session state, and the two session events are the observable stream. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the reflection call to the seam and the model-facing surfaces.

- [dsh-memory](../memory/README.md) — the seam the candidates are written through.
- [dsh-memory-profile](../memory-profile/README.md) — the model-visible side of saved `style` records.
- [dsh-tool-memory](../tool-memory/README.md) — the model-facing tools over the same store.
- [memory group map](../README.md) — the five-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

### Auxiliary reflection request

#### What the model sees

After a completed turn, one auxiliary request carries the fixed extraction instruction plus that turn's human and assistant text framed as a JSON array; the exact request is logged as `memory/reflection-llm-request` before dispatch, so it is reconstructable from the session log. The instruction is:

##### Extraction instruction

```markdown
You extract durable memories from one coding-assistant conversation turn.
Return only a JSON object of the form {"memories":[{"text":"...","namespace":"preference|fact|style","confidence":0.0}]} and no other prose.
Extract only durable user preferences, collaboration-style guidance, or project facts worth carrying into future sessions; skip transient details.
Return {"memories":[]} when nothing qualifies.
```

#### Token effect

One extra model call per qualifying turn: input bounded by `maxInputBytes`, output by `maxOutputTokens` (default 512), and the whole call by the `timeoutMs` deadline; the auxiliary call's tokens are separate from the main conversation.

#### KV Cache effect

The extraction instruction is identical on every reflection, so its prefix is reusable across turns; only the framed JSON payload changes, and the main conversation's cached prefix is untouched by this separate request.

### Write-back approval

#### What the model sees

No prompt or schema text of this package's own. When `write` is `ask`, the question — `Save this extracted memory?` or `Save these N extracted memories?`, with the candidate texts listed — is addressed to the human through the user-questions service, and candidates are written only on `Save`. A written memory reaches the model later only through the surfaces that read the store, such as the memory profile's injected section or `memory_search`.

#### Token effect

Zero token effect on the auxiliary request; approval gates a store write rather than adding generation.

#### KV Cache effect

None; the approval exchange is outside the model requests this package makes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the reflection is a poor fit. They are current package constraints, not a task backlog.

- **Turn-boundary only** — extraction runs after a turn completes from the buffered text; a turn that never completes is never reflected on, and a turn end dropped while a reflection is in flight is lost rather than queued.
- **Writes are gated by default** — `write: 'ask'` pauses each turn with candidates on a human answer; unattended accumulation requires opting into `auto`. With no question responder mounted, candidates are discarded as `unavailable`.
- **Provider- and route-gated** — with no memory provider the reflection stops at its probe, and with neither a configured pair nor a logged session route it stops before calling; neither case fails the turn nor records an outcome.
- **One auxiliary generation per qualifying turn** — bounded by `maxInputBytes`, `maxOutputTokens`, and the `timeoutMs` deadline, but still real cost on top of the main conversation.
- **Single-shot extraction** — an unparseable answer simply yields no candidates, and at most ten candidates are accepted per turn; there is no retry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
