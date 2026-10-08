---
description: "Web knowledge center: the right-Sidebar page listing the deployment's stored knowledge documents."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge

English | [中文](README.zh.md)

## Summary

A right-Sidebar page type that lists the knowledge documents this deployment stores, with the documents' titles, creation dates, sources, and body excerpts. It deletes a document and refreshes after the Remote acknowledgement. A deployment without a knowledge provider renders an explicit unavailable state rather than a failed read.

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

The shipped Web bundle mounts this package together with the Host knowledge group. The Sidebar guide page carries the center's entry; picking it opens the page, whose tab chip reads the namespace's tab label. Each row shows the stored title, the creation date in the viewer's locale (an unparsable stamp falls back to the stored value), the optional provenance source, and a two-line excerpt of the body. The delete action is disabled while its deletion is in flight, and the row stays visible until an authoritative read confirms the removal. A failed read keeps the last known records and offers Retry. Ingest and search stay model-side operations; the page cannot write corpus content.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry registers the page type `@deepseek-ai/dsh-client-ui-knowledge` under the kind `knowledge` in two stages: its definition into `ctx.sidebarRightTabs` — carrying the guide entry that opens it — then its body into the keyed `sidebar.right.pane.tab` seat under the definition's id. One catalog source backs the page, created over the Remote face `ctx.remote.knowledge` (`status`, `list`, `remove`) with the connection-reset event as its invalidation source. Every read probes `status` first: an unheld seam settles the page with `available: false` and no list read, so the unavailable state cannot be confused with a query failure a retry would clear. Deletion follows the shared catalog pattern: a pending mark while the Remote call is in flight, an outcome of `deleted`, `failed`, or `pending` resolved to the caller, and a fresh read after an acknowledged removal rather than joining a read that may have been sent before it. Subscriptions exist only while the framework observes the source; the final unsubscribe releases the reset listener and invalidates pending responses. The Host face ([@deepseek-ai/dsh-knowledge/browser](../../knowledge/knowledge/README.md)) routes to `ctx.knowledge` and owns no storage.

No runtime invariant companion is published because the catalog renders Host-owned stored documents and owns only disposable query and deletion interaction state.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge](../../knowledge/knowledge/README.md) owns the seam, the SQLite provider, and the model-side tool.
- [Slots](../../../docs/subsystems/slots.md) documents injected hooks and panel contributions.

<a id="model-experience"></a>
## Model Experience

None, as this browser UI registers no model-facing tools or messages; the knowledge tool serves model queries.

#### KV Cache effect

None. Catalog presentation does not enter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The page lists the whole corpus without search or filtering; discovery of relevant documents remains with the model-side knowledge tool.
- Deletion is hard: the provider removes the stored document, and the page offers no undo or archive.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
