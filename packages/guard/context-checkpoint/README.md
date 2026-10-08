---
description: "Pinned-context checkpoint guard that re-surfaces context the model lost to compaction, for users and maintainers choosing, configuring, or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-context-checkpoint

English | [中文](README.zh.md)

## Summary

This package keeps pinned context with the model across compaction. You pin texts the work depends on — a constraint block, a decision record, an interface contract — and before each model step the guard checks that every pin is still present in the conversation. When a pin has been compacted or pruned away, it reminds the model to re-obtain the source instead of acting on remembered content. The reminder is advisory: it never blocks a step. Nothing is pinned by default — mount the plugin per composition with an explicit pin list.

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

### When to choose it

Choose it when a session depends on specific source text surviving compaction — long constraint documents, acceptance criteria, a wire contract — and the failure you fear is the model continuing confidently without it. Avoid it for content cheap to re-derive, and for content a summary reliably preserves: a pin that survives quoted inside the compaction summary counts as present, because the model can still read it.

### Configuring the pins

Mount the plugin with the texts to pin:

```yaml
- name: '@deepseek-ai/dsh-context-checkpoint'
  config:
    pins:
      - label: tenant-filter-rule
        text: 'Every query must filter by tenant id before it reaches storage.'
```

| Field | Default | Meaning |
|---|---|---|
| `pins` | (required) | Texts that must stay present; each `label` names the reminder and `text` is matched as a literal substring |

Invalid configuration fails at startup with a clear error — an empty pin list, an empty pin text, or a duplicate label — never a silent inert plugin. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-context-checkpoint) documents every accepted value.

### What you get

While every pin's text is still in the conversation, the guard is invisible. After a compaction or prune removes a pin the model has already seen, the next step's context carries one reminder naming the lost pins and directing the model to re-read or re-obtain the source first. The reminder stays in context and keeps the guard quiet; if compaction removes the reminder too, the guard re-reminds. A pin whose text returns to the context resets cleanly.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the guard detects loss and delivers reminders, and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design commitments

- **Advisory, not veto.** The guard appends a reminder to the step's entered messages; it never rejects or rewrites a step.
- **Check what the model will see.** Detection runs on `agent/pre-step` against the step's entered message series — the same user-message stream compaction rewrites — so a pin counts as present exactly when the model can still read it.
- **Suppress by presence, not counters.** The injected reminder names the missing labels in its summary; while it survives in context the guard stays quiet, and its removal re-arms the reminder with no cross-event bookkeeping.
- **Fail loud at load.** The pin list validates in `apply` and throws, never falling back to inert behavior.

### Detection and delivery

Per agent, the guard remembers which pin labels it has seen in context (`WeakMap<Agent, Set<string>>`); a pin never seen has nothing to lose, so a pin naming content the model has not read yet stays silent until that content arrives. On each step the guard scans the entered messages for each pin's literal text; each seen-but-missing pin whose reminder is not itself still present contributes to one reminder message appended after the entered messages, source `{kind: 'context-checkpoint', form: 'notice', summary: '<labels>'}`. A session resumed from persistence starts with a fresh seen-set: reminders re-arm only after the pin is seen again.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, fail-loud validation, pre-step listener |
| — | No runtime invariant companion is published; the guard exposes no package-owned event or snapshot that an independent companion can observe. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Agent lifecycle](../../../docs/agent-lifecycle.md) — the step lifecycle whose pre-step waterfall this guard checks on.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-context-checkpoint) — every accepted config field and its source declaration.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### Checkpoint reminder

#### What the model sees

When a seen pin is missing and no reminder for it survives in context, the step receives the reminder below. No tool schema or normal-call text is added.

##### Checkpoint reminder

```markdown
Pinned context (<labels>) is no longer present in the conversation — an earlier compaction or prune removed it. Do not act on remembered content you can no longer see: re-read or re-obtain the source before continuing work that depends on it.
```

#### Token effect

Zero tokens while every pin is present or its reminder survives. One reminder per loss episode, retained history afterwards.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the guard is a poor fit. They are current package constraints, not a task backlog.

- **User-message context only** — detection scans the step's user-message series; text living only in tool results or the system prompt is not tracked.
- **Literal substring matching** — a paraphrased or reformatted constraint no longer matches; there is no semantic matching.
- **Seen-state is in-memory** — a resumed session re-arms only after each pin is seen again; a pin already lost before the resume surfaces only once its text reappears and later vanishes.
- **Advisory only** — the guard cannot re-inject the lost content itself; re-obtaining it is the model's action.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
