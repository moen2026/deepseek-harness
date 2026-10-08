---
description: "The document-creation capability seam (ctx.documents): a single-provider reservation registry and one order-independent route — create — over neutral content blocks and finished Office document bytes, for users and maintainers composing Office file generation for agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-documents

English | [中文](README.zh.md)

## Summary

Use `dsh-documents` to give agents Office file creation: one `create` route takes a format, a title, and ordered content blocks and returns the provider's document bytes with their media type, so a backend's engines, intermediate formats, and layout policy never change the request or the result. A single provider reserves the seam exclusively, and registration is atomic: an invalid or conflicting claim publishes nothing. Combine it with a provider such as `dsh-office-create` and the model-facing `dsh-tool-document`; alone it answers no request and throws `DOCUMENTS_UNAVAILABLE`. It owns no engine and renders no bytes itself.

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

Mount a documents provider and the `create_document` tool to let the model produce DOCX, XLSX, or PPTX files. This package is the service those packages register against; it defines no UI, tool, or creation backend of its own.

### When to choose it

Choose this service when a deployment wants model-visible Office document creation backed by an engine the model never builds or addresses. It covers one route — create — with provider-owned engines and layout; request shape and result shape are fixed by the seam, so replacing the provider does not change what the model sees or how it asks.

### Composing a documents stack

The seam needs a provider and a consumer to do anything. A minimal composition mounts the service, the local-engine provider, and the tool:

```yaml
- name: '@deepseek-ai/dsh-documents'
- name: '@deepseek-ai/dsh-office-create'
- name: '@deepseek-ai/dsh-tool-document'
```

The engine, intermediate formats, and limits are configured in the provider package; see [dsh-office-create](../office-create/README.md) and [dsh-tool-document](../tool-document/README.md).

### The operation

`create(request, signal?)` takes a `DocumentCreateRequest` — a required `format` (`docx`, `xlsx`, or `pptx`), a `title`, and ordered `blocks` — and returns a `DocumentResult` of raw document `data` bytes with the `mediaType` they decode as. Blocks are the seam's neutral, template-agnostic vocabulary: `heading`, `text`, `bullets`, `table`, and `chartPlaceholder`. The seam applies no timeout or byte cap; consumers own those bounds and durably commit the bytes through the filesystem service before presenting them.

### Failures and recovery

A request fails with the structured error `DOCUMENTS_UNAVAILABLE` when no provider is registered — mount a provider or continue without document creation. Invalid or conflicting registrations fail with `DOCUMENTS_INVALID_PROVIDER` or `DOCUMENTS_CONFLICT` before any route is published, a malformed request fails with `DOCUMENTS_INVALID_REQUEST`, and a backend failure fails with `DOCUMENTS_PROVIDER_FAILED`. Consumers catch `DocumentsError` and route on its stable `code`; through the tool, an unmounted seam surfaces as an actionable unavailable answer the model can read.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Capability seam, Service Definition role.** The package owns `ctx.documents` and the provider registry; providers own engines and intermediate representations, not tools, and `dsh-tool-document` is the only owner of the model-facing surface.
- **Exclusive whole-format reservation.** One provider holds the seam at a time; a creation backend claims the deployment's Office pipeline, so a second registration is a conflict rather than a co-existing route.
- **Atomic registration.** `registerProvider()` validates and conflict-checks everything before mutating: an invalid or conflicting registration publishes nothing, and its disposer releases the reservation.
- **Order-independent routing.** The route forwards to the single registered provider through `ctx.effect()`, so the reservation lives and dies with the registering fiber; registration and HMR order never change which provider answers.
- **Closed, provider-agnostic vocabulary.** The request and result shapes are fixed across backends — adding a block kind is a compile-enforced change across the seam, providers, and the tool. There is no protocol escape hatch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Documents` service, `registerProvider`/`create`, `DocumentsError` codes |
| [`src/types.ts`](src/types.ts) | Seam vocabulary: blocks, request, result, provider, and service contracts |
| — | No runtime invariant companion is published; the provider reservation is private, atomically updated state; the seam exposes neither an enumerable snapshot nor lifecycle events to compare independently. |

### Registration and disposal lifecycle

Registration and disposal run through `ctx.effect()`, so the provider route lives and dies with the registering fiber. `registerProvider()` returns a synchronous disposer; the seam drops the always-resolved effect promise so its disposer API stays synchronous. `DocumentsError` extends `HarnessError` with stable codes (`DOCUMENTS_INVALID_PROVIDER`, `DOCUMENTS_CONFLICT`, `DOCUMENTS_UNAVAILABLE`, `DOCUMENTS_DISPOSED`, `DOCUMENTS_INVALID_REQUEST`, `DOCUMENTS_PROVIDER_FAILED`) that callers route on instead of parsing `message`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared creation model to the provider and the tool.

- [dsh-office-create](../office-create/README.md) — the LibreOffice-kit-backed provider that registers against this seam.
- [dsh-tool-document](../tool-document/README.md) — the model-facing tool over this seam.
- [document group map](../README.md) — the package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-document`, which owns the model-facing `create_document` schema, prompt guidance, and rendered results while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-document` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the seam's current scope. They are package constraints, not a task backlog.

- **Single provider per runtime** — one creation backend is a whole-format claim, so a second registration conflicts instead of co-existing. A deployment-configured selector above registrations is the intended extension if multi-provider routing is ever needed.
- **One route, no editing** — the seam exposes only `create`; opening, editing, or converting existing documents are different capabilities (`office-to-pdf` covers conversion) and have no route here.
- **No timeout or byte bounds** — the seam applies no cap, so consumers own the byte budget and providers own the engine timeout.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
