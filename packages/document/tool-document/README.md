---
description: "The model-facing create_document tool over the ctx.documents seam and ctx.fs: send a title and content blocks to the reserved provider, durably write the created Office bytes into the Session workspace, and declare the file through the shared deliverables chain, with an actionable unavailable answer when no provider is mounted, for users and maintainers composing Office document creation."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

English | [中文](README.zh.md)

## Summary

`dsh-tool-document` gives a model one tool over `ctx.documents`: `create_document` sends a title and ordered content blocks to the reserved provider, durably writes the created bytes into the Session workspace at a caller-named path that is never overwritten, and declares the file through the shared `deliverables/presented` chain — the same display path the `present` tool uses — so model and user both see what was created. Without a mounted provider it returns an actionable "documents unavailable" message instead of failing the session. The package runtime-injects only `tools`, `fs`, `documents`, `systemPrompt`, and `sessionProjections` and imports no provider.

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

A model calls `create_document` when the user asks for a Word, Excel, or PowerPoint file; the tool's prompt guidance tells it to write plain text files instead when the capability is not configured.

### The tool

`create_document` takes a required `format` (`docx`, `xlsx`, or `pptx`), a `title`, a `file_path`, and ordered `blocks` (heading, text, bullets, table, or chartPlaceholder objects). It validates every block into the seam's neutral vocabulary before touching the seam, so malformed input is an actionable argument error rather than a crash. Provider choice, engine, and limits stay outside model input; they belong to the mounted provider.

### What the model gets back

The tool returns a closed result: `status` `ok` with `path` (the backend-resolved workspace path), `mediaType`, and `bytes`, or `unavailable`. Rendering emits a `<type>document</type>` envelope naming the path, media type, and byte count, and declares the delivery when the tool result settles. An occupied `file_path` never overwrites the existing file — it fails with an actionable "choose a different file_path" message. When no provider is mounted, the render is the actionable unavailable message instead of an error.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `180000` | Tool-call timeout budget, covering one engine conversion |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-document) is the exhaustive source for every accepted field.

### Failures and recovery

A `DOCUMENTS_UNAVAILABLE` from the seam is caught and returned as `status: 'unavailable'` so the session keeps running. `FS_NOT_OBSERVED` (an existing file at the target path) becomes an actionable retry message and never touches durable history. Any other error — a provider failure, an invalid request — propagates as a structured tool error the model can read and route on.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design notes

- **Consumer-only.** The tool runtime-injects only `tools`, `fs`, `documents`, `systemPrompt`, and `sessionProjections`, imports no provider, and passes only `exec.signal` to the seam.
- **Argument normalization before the seam.** `parseCreateDocumentArgs` trims scalars and rejects malformed blocks with an actionable field name, so the provider receives a canonical request.
- **Create, never clobber.** The created bytes are written through `fs.writeBytes` with the `createIfAbsent` intent, so an occupied path is an actionable error, and the file lands in the workspace with a recorded `fs/observed` version.
- **Delivery after settlement.** Like `present`, the `deliverables/presented` event is appended when the tool result settles, so the declaration only lands for a successful call and carries the settled turn number.
- **Availability is data, not a crash.** `execute` catches the seam's `DOCUMENTS_UNAVAILABLE` and returns an `unavailable` status; every other error rethrows, so a genuinely broken provider is still surfaced.
- **Generic card presentation.** `presentCreateDocumentCall` renders `{ card: 'generic', kind: 'other', title }` titled with the requested file name.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, prompt section, `create_document` registration and execution, delivery append |
| [`src/render.ts`](src/index.ts) | Pure argument validation, created-document envelope, UI presentation |
| [`src/types.ts`](src/types.ts) | Delivery-event reuse: the `deliverables/presented` declaration is owned by the present tool's package |
| — | No runtime invariant companion is published; this stateless adapter contributes one tool and prompt section, while creation lifecycle and result relations remain owned by the documents seam it composes. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the model-facing surface to the seam and the provider.

- [dsh-documents](../documents/README.md) — the seam this tool queries.
- [dsh-office-create](../office-create/README.md) — the provider that answers creations.
- [document group map](../README.md) — the package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One system-prompt section (first-party order 2457) positions the creation tool and its optionality with the following text:

##### Verbatim guidance

```markdown
Use create_document to produce an Office file (Word DOCX, Excel XLSX, or PowerPoint PPTX) from a title and content blocks. It is unavailable until a documents provider is configured — then write plain text files instead, for example by suggesting the user configure one.
```

#### Token effect

Fixed guidance cost on every request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged; activation or disposal may invalidate reuse from this section.

### Tool schema

#### What the model sees

The model sees the generated [`create_document` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-document).

#### Token effect

Fixed schema cost on every request while enabled; the `timeoutMs` budget is never sent to the model.

#### KV Cache effect

Prefix-stable while the visible tool definition and order are unchanged; registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

An ok result renders a `<type>document</type>` envelope naming the workspace path, media type, and byte count, and the delivery declaration rides the session's `deliverables/presented` event. When no provider is mounted, the result is the actionable unavailable message instead of an error.

#### Token effect

The envelope is bounded by the path and media type it names; created bytes never enter the conversation.

#### KV Cache effect

Tool results append after the cached request prefix and do not directly invalidate it.

### UI presentation

#### What the model sees

Nothing. The client renders a generic card — `{ card: 'generic', kind: 'other', title }` — titled `Create document: <file name>`; the document itself is rendered through the deliverables chain like `present` results.

#### Token effect

Zero direct token effect because rendering is client-side only.

#### KV Cache effect

None; UI presentation is outside the model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Provider-gated availability** — with no documents provider mounted the tool always returns the unavailable message; it never produces bytes itself, so a deployment must mount `dsh-office-create` (or another provider) for real documents.
- **New files only** — the tool creates artifacts and never edits an existing file; revising a document is a different capability with no route here.
- **One file per call** — a multi-document request is several calls; the result models a single workspace path.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
