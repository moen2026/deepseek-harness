---
description: "Web MCP panel: the right-Sidebar page listing the deployment's connected MCP servers with their tools and resources."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp

English | [中文](README.zh.md)

## Summary

A right-Sidebar page type that lists the MCP servers this deployment connects, with each server's model-facing tool names and its reported resources — URI, display name, and MIME type. A server whose resource discovery is unsupported or fails keeps its tool list behind a labeled note, and a serverless deployment renders an explicit unavailable state rather than a failed read. The panel only surfaces existing discovery state; connecting servers and reading resources stay with the connection plugins and the model-side resource tools.

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

The base profile mounts the Host `mcp-browser` face beside `mcp-resources`, and the shipped Web bundle mounts this package in its roster. The Sidebar guide page carries the panel's entry; picking it opens the page, whose tab chip reads the namespace's tab label. Each server row shows the configured server name, a tool chip per registered `mcp__<server>__<raw>` tool with its description on hover, and the first resource page the server reports, each with its URI and MIME type. A `resourcesNote` replaces the resource list with its label: the server reported no resources, or the read failed — including servers without resource support. A failed read keeps the last known servers and offers Retry. Resource reads inside a conversation render through the ordinary tool presentation; the panel adds no second connection path and no model-facing surface.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry registers the page type `@deepseek-ai/dsh-client-ui-mcp` under the kind `mcp` in two stages: its definition into `ctx.sidebarRightTabs` — carrying the guide entry that opens it — then its body into the keyed `sidebar.right.pane.tab` seat under the definition's id. One catalog source backs the page, created over the Remote face `ctx.remote.mcp` (`status`, `servers`) with the connection-reset event as its invalidation source. Every read probes `status` first: a serverless deployment settles the page with `available: false` and no server read, so the unavailable state cannot be confused with a query failure a retry would clear. Subscriptions exist only while the framework observes the source; the final unsubscribe releases the reset listener and invalidates pending responses. The Host face ([@deepseek-ai/dsh-mcp-resources/browser](../../mcp/mcp-resources/README.md)) reads the resource runtime's global server layer and the tool registry view, and each server's resource page comes from one synthetic `resources/list` execution whose cancellation is the only field the connection reads; a failed per-server read degrades to the `failed` note instead of failing the whole listing.

No runtime invariant companion is published because the panel renders server-reported discovery state and owns only disposable read interaction state.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [MCP resources](../../mcp/mcp-resources/README.md) owns the resource runtime, the shared resource tools, and the browser Remote face.
- [Slots](../../../docs/subsystems/slots.md) documents injected hooks and panel contributions.

<a id="model-experience"></a>
## Model Experience

None, as this browser UI registers no model-facing tools or messages; the resource tools and each server's tools serve the model.

#### KV Cache effect

None. Panel presentation does not enter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The panel shows the first resource page each server reports; paging and template expansion stay with the model-side resource tools.
- Server connection state reflects registry membership at read time, not live transport health; a broken connection surfaces as its tools' execution failures.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
