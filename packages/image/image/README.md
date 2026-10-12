---
description: "The image-generation capability seam (ctx.image): a single-provider reservation registry and one order-independent route — generate — over text prompts with optional reference-image URLs and raw image bytes, for users and maintainers composing or extending text-to-image for agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-image

English | [中文](README.zh.md)

## Summary

Use `dsh-image` to give agents text-to-image generation: one `generate` route takes a text prompt plus optional size, count, and reference-image refinements and returns the provider's image bytes with their media type, so a backend's endpoint, model, and credentials never change the request or the result. A single provider reserves the seam exclusively, and registration is atomic: an invalid or conflicting claim publishes nothing. Combine it with a provider such as `dsh-image-http` and the model-facing `dsh-tool-image`; alone it answers no request and throws `IMAGE_UNAVAILABLE`. It selects no generation model on the caller's behalf.

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

Mount an image provider and the `generate_image` tool to let the model create images from text prompts. This package is the service those packages register against; it defines no UI, tool, or generation backend of its own.

### When to choose it

Choose this service when a deployment wants model-visible image generation backed by an endpoint the model never builds or addresses. It covers one route — generate — with provider-owned protocol and credentials; request shape, size hints, and result metadata are fixed by the seam, so replacing the provider does not change what the model sees or how it asks.

### Composing an image stack

The seam needs a provider and a consumer to do anything. A minimal composition mounts the service, an HTTP provider, and the tool:

```yaml
- name: '@deepseek-ai/dsh-image'
- name: '@deepseek-ai/dsh-image-http'
  config:
    url: https://example.invalid/v1/images/generations
    model: image-1
    authEnv: DSH_IMAGE_API_KEY
- name: '@deepseek-ai/dsh-tool-image'
```

The endpoint, model, and credential variable are configured in the provider package; see [dsh-image-http](../image-http/README.md) and [dsh-tool-image](../tool-image/README.md).

### The operation

`generate(request, signal?)` takes an `ImageGenerateRequest` — a required text `prompt` plus optional `size`, `n`, and `referenceImages` (publicly reachable URLs of reference images that guide the generation) — and returns an `ImageResult` of raw image `data` bytes with the `mediaType` they decode as and an optional provider-reported `revisedPrompt`. The seam applies no timeout or size cap, so there is no `resolve()` step; consumers own those bounds and commit the bytes durably through the attachment service.

### Failures and recovery

A request fails with the structured error `IMAGE_UNAVAILABLE` when no provider is registered — mount a provider or continue without generation. Invalid or conflicting registrations fail with `IMAGE_INVALID_PROVIDER` or `IMAGE_CONFLICT` before any route is published, an operation against a disposed provider fails with `IMAGE_DISPOSED`, a malformed request fails with `IMAGE_INVALID_REQUEST`, and a backend failure fails with `IMAGE_PROVIDER_FAILED`. Consumers catch `ImageError` and route on its stable `code`; through the tool, an unmounted seam surfaces as an actionable unavailable answer the model can read.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Capability seam, Service Definition role.** The package owns `ctx.image` and the provider registry; providers post prompts and speak endpoint protocols, not tools, and `dsh-tool-image` is the only owner of the model-facing surface.
- **Exclusive whole-corpus reservation.** One provider holds the seam at a time; a generation backend claims the deployment's text-to-image pipeline, so a second registration is a conflict rather than a co-existing route.
- **Atomic registration.** `registerProvider()` validates and conflict-checks everything before mutating: an invalid or conflicting registration publishes nothing, and its disposer releases the reservation.
- **Order-independent routing.** The route forwards to the single registered provider through `ctx.effect()`, so the reservation lives and dies with the registering fiber; registration and HMR order never change which provider answers.
- **Closed, provider-agnostic vocabulary.** The request and result shapes are fixed across backends — adding a refinement is a compile-enforced change across the seam, providers, and the tool. There is no protocol escape hatch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Image` service, `registerProvider`/`generate`, `ImageError` codes |
| [`src/types.ts`](src/types.ts) | Seam vocabulary: request, result, provider, and service contracts |
| — | No runtime invariant companion is published; the provider reservation is private, atomically updated state; the seam exposes neither an enumerable snapshot nor lifecycle events to compare independently. |

### Registration and disposal lifecycle

Registration and disposal run through `ctx.effect()`, so the provider route lives and dies with the registering fiber. `registerProvider()` returns a synchronous disposer; the seam drops the always-resolved effect promise so its disposer API stays synchronous. `ImageError` extends `HarnessError` with stable codes (`IMAGE_INVALID_PROVIDER`, `IMAGE_CONFLICT`, `IMAGE_UNAVAILABLE`, `IMAGE_DISPOSED`, `IMAGE_INVALID_REQUEST`, `IMAGE_PROVIDER_FAILED`) that callers route on instead of parsing `message`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared generation model to the provider and the tool.

- [dsh-image-http](../image-http/README.md) — the OpenAI-compatible HTTP provider that registers against this seam.
- [dsh-image-wuyinkeji](../image-wuyinkeji/README.md) — the async-task provider that registers against this seam.
- [dsh-tool-image](../tool-image/README.md) — the model-facing tool over this seam.
- [image group map](../README.md) — the four-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-image`, which owns the model-facing `generate_image` schema, prompt guidance, and rendered results while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-image` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the seam's current scope. They are package constraints, not a task backlog.

- **Single provider per runtime** — one generation backend is a whole-corpus claim, so a second registration conflicts instead of co-existing. A deployment-configured selector above registrations is the intended extension if multi-provider routing is ever needed.
- **One route, no editing** — the seam exposes only `generate`; image editing or variation endpoints are different capabilities and have no route here.
- **No size or count bounds** — the seam applies no cap, so consumers own the byte and count budget and providers own the endpoint timeout.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
