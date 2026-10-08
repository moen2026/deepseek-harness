---
description: "Web memory center: the right-Sidebar page listing the deployment's stored memory entries, with the Turn cards for memory_write calls."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-memory

English | [中文](README.zh.md)

## Summary

A right-Sidebar page type that lists the memory entries this deployment stores, with each entry's text, creation date, namespace, and tags. It deletes an entry and refreshes after the Remote acknowledgement. A deployment without a memory provider renders an explicit unavailable state rather than a failed read. The package also renders per-Turn cards for settled `memory_write` tool calls, derived from the raw session events.

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

The shipped Web bundle mounts this package together with the Host memory group. The Sidebar guide page carries the center's entry; picking it opens the page, whose tab chip reads the namespace's tab label. Each row shows the stored text, the creation date in the viewer's locale (an unparsable stamp falls back to the stored value), the optional namespace, and the tags. The delete action is disabled while its deletion is in flight, and the row stays visible until an authoritative read confirms the removal. A failed read keeps the last known records and offers Retry. Writing and searching memories stay model-side tool operations; the page cannot create or edit content. Inside a conversation, a Turn card after the reply lists the memory entries the Turn's settled `memory_write` calls produced.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry registers the page type `@deepseek-ai/dsh-client-ui-memory` under the kind `memory` in two stages: its definition into `ctx.sidebarRightTabs` — carrying the guide entry that opens it — then its body into the keyed `sidebar.right.pane.tab` seat under the definition's id. One catalog source backs the page, created over the Remote face `ctx.remote.memory` (`status`, `list`, `forget`) with the connection-reset event as its invalidation source. Every read probes `status` first: an unheld seam settles the page with `available: false` and no list read, so the unavailable state cannot be confused with a query failure a retry would clear. Deletion follows the shared catalog pattern: a pending mark while the Remote call is in flight, an outcome of `deleted`, `failed`, or `pending` resolved to the caller, and a fresh read after an acknowledged removal rather than joining a read that may have been sent before it. Subscriptions exist only while the framework observes the source; the final unsubscribe releases the reset listener and invalidates pending responses. The Turn cards register a conversation node definition that accumulates `tool_memory` `memory_write` calls per Turn — matching the call, narrowing the settled result JSON, and dropping malformed or non-ok payloads — and publish them under the `memory-remembered` key of `ConversationTurnDataMap`; a `conversation.chat.turnTail` slot renders the card, bounded by the Turn's recorded end sequence. The Host face ([@deepseek-ai/dsh-memory/browser](../../memory/memory/README.md)) routes to `ctx.memory` and owns no storage.

No runtime invariant companion is published because the catalog renders Host-owned stored memories and owns only disposable query and deletion interaction state.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Memory](../../memory/memory/README.md) owns the seam, the storage providers, and the model-side tools.
- [Slots](../../../docs/subsystems/slots.md) documents injected hooks and panel contributions.

<a id="model-experience"></a>
## Model Experience

None, as this browser UI registers no model-facing tools or messages; the memory tools serve model recall.

#### KV Cache effect

None. Catalog presentation and Turn cards do not enter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The page lists the whole store without search or filtering; discovery of relevant memories remains with the model-side memory tool.
- Deletion is hard: the provider removes the stored entry, and the page offers no undo or archive.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
