---
description: "LibreOffice-kit-backed document-creation provider for the DeepSeek Harness documents seam (ctx.documents): renders neutral content blocks into minimal OpenDocument intermediates and converts them to DOCX, XLSX, or PPTX with the local engine, with typed provider-failure errors and per-call scratch cleanup."
kind: "package-reference"
---

# @deepseek-ai/dsh-office-create

English | [中文](README.zh.md)

## Summary

Mount `dsh-office-create` to back `ctx.documents` with a local creation engine: each request is rendered into the smallest valid zipped OpenDocument intermediate for its family (odt, ods, or odp), which the LibreOffice kit then converts to the requested Office format. One converter is created lazily and shared, scratch directories never outlive a call, and every engine-side failure surfaces as a typed `DOCUMENTS_PROVIDER_FAILED` error — there is no fabricated fallback document. Registration is effect-scoped; disposal aborts active work and disposes the shared converter.

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

Choose this provider when the deployment wants Office document creation without operating a remote generation endpoint. The engine ships with the application and starts lazily, so a mounted-but-unused provider never pays the startup; the trade is a local LibreOffice dependency and native-engine throughput.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-office-create'
  config:
    timeoutMs: 60000
    maxOutputBytes: 104857600
```

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120000` | Conversion deadline in milliseconds after a queued conversion starts |
| `maxOutputBytes` | `104857600` | Maximum complete document bytes the creator accepts from the engine |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-office-create) is the exhaustive source for every accepted field.

### Failures and recovery

An invalid request (blank title, empty text, a non-rectangular table, a blank bullet or label) throws `DOCUMENTS_INVALID_REQUEST` before any engine work, so a bad request never starts a conversion. A failed engine start is retried on the next call — a broken converter never poisons the creator. A conversion failure or oversized output throws `DocumentsError` `DOCUMENTS_PROVIDER_FAILED` naming what failed, and the scratch directory is removed in every path. Caller cancellation surfaces unwrapped, aborting before the engine runs when already signalled.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Service Provider role.** The package registers one `DocumentsProvider` (`id: office-create`) on `ctx.documents` and owns nothing else: no tool, no prompt, no storage.
- **Neutral blocks in, Office bytes out.** The request is translated into a minimal zipped ODF package (mimetype entry first and stored, manifest, content.xml) — a format LibreOffice converts from, in either direction — so the seam's vocabulary never leaks engine details.
- **Deterministic intermediates.** Identical requests produce identical intermediate bytes, so provider tests can snapshot the XML.
- **One lazy converter.** `createConverter` runs on first use and its promise is shared; a failed factory resets the slot so the next call retries cleanly.
- **Typed failures.** Engine-side failures become `DOCUMENTS_PROVIDER_FAILED` with the engine's diagnostic in the message; validation failures stay `DOCUMENTS_INVALID_REQUEST`.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema and provider registration |
| [`src/odf.ts`](src/odf.ts) | The OpenDocument intermediate builders: validation, block rendering, packaging |
| [`src/create.ts`](src/create.ts) | The kit-backed creator: scratch I/O, conversion, output cap, error mapping |
| — | No runtime invariant companion is published; the lazy converter slot and scratch directories are private implementation state, and this provider publishes no independent lifecycle event stream or enumerable snapshot. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-documents](../documents/README.md) — the seam this provider registers on.
- [dsh-tool-document](../tool-document/README.md) — the model-facing tool that consumes created documents.
- [dsh-office-to-pdf](../office-to-pdf/README.md) — the sibling conversion direction, sharing the same LibreOffice kit.
- [document group map](../README.md) — the package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the provider answers creation requests without contributing anything to model requests; `dsh-tool-document` owns the model-facing schema and rendering.

#### KV Cache effect

No effect; this provider contributes nothing to model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the provider's current scope. They are package constraints, not a task backlog.

- **Placeholder charts only** — a `chartPlaceholder` block renders as a labeled placeholder frame, never as real chart data; data-driven charts are a different capability.
- **No template files** — creation starts from the neutral blocks alone; filling a caller-supplied DOCX/XLSX/PPTX template is deferred work.
- **Local engine dependency** — creation requires the bundled LibreOffice engine; a failed engine start surfaces as `DOCUMENTS_PROVIDER_FAILED` on the call rather than degrading to another backend.
- **One format family per call** — each request targets exactly one of DOCX, XLSX, or PPTX; multi-format export is several calls.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
