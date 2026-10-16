---
description: "The video-generation capability seam (ctx.video): a single-provider reservation registry and one order-independent route — generate — over text prompts with optional size, duration, aspect-ratio, frame-conditioning, and reference-media URLs, returning raw video bytes, for users and maintainers composing or extending text-to-video for agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-video

English | [中文](README.zh.md)

## Summary

Use `dsh-video` to give agents text-to-video generation: one `generate` route takes a text prompt plus optional size, duration, aspect-ratio, frame-conditioning, and reference-media URLs and returns the provider's video bytes with their media type, so a backend's endpoint, model, and credentials never change the request or the result. A single provider reserves the seam exclusively, and registration is atomic: an invalid or conflicting claim publishes nothing. Combine it with a provider such as `dsh-video-wuyinkeji` and the model-facing `dsh-tool-video`; alone it answers no request and throws `VIDEO_UNAVAILABLE`. It selects no generation model on the caller's behalf.

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

Mount a video provider and the `generate_video` tool to let the model create videos from text prompts. This package is the service those packages register against; it defines no UI, tool, or generation backend of its own.

### When to choose it

Choose this service when a deployment wants model-visible video generation backed by an endpoint the model never builds or addresses. It covers one route — generate — with provider-owned protocol and credentials; request fields, size and duration hints, and result metadata are fixed by the seam, so replacing the provider does not change what the model sees or how it asks.

### Composing a video stack

The seam needs a provider and a consumer to do anything. A minimal composition mounts the service, the Wuyinkeji provider, and the tool:

```yaml
- name: '@deepseek-ai/dsh-video'
- name: '@deepseek-ai/dsh-video-wuyinkeji'
  config:
    authEnv: DSH_WUYINKEJI_API_KEY
- name: '@deepseek-ai/dsh-tool-video'
```

The endpoint base and credential variable are configured in the provider package; see [dsh-video-wuyinkeji](../video-wuyinkeji/README.md) and [dsh-tool-video](../tool-video/README.md).

### The operation

`generate(request, signal?)` takes a `VideoGenerateRequest` — a required text `prompt` plus optional `size`, `duration`, and `aspectRatio` refinements and `firstFrame`, `lastFrame`, `referenceImage`, `referenceVideo`, and `referenceAudio` URLs (publicly reachable; providers that do not accept a refinement ignore it) — and returns a `VideoResult` of raw video `data` bytes with the `mediaType` they decode as. The seam applies no timeout or size cap, so there is no `resolve()` step; consumers own those bounds and commit the bytes durably through the attachment service.

### Failures and recovery

A request fails with the structured error `VIDEO_UNAVAILABLE` when no provider is registered — mount a provider or continue without generation. Invalid or conflicting registrations fail with `VIDEO_INVALID_PROVIDER` or `VIDEO_CONFLICT` before any route is published, an operation against a disposed provider fails with `VIDEO_DISPOSED`, a malformed request fails with `VIDEO_INVALID_REQUEST`, and a backend failure fails with `VIDEO_PROVIDER_FAILED`. Consumers catch `VideoError` and route on its stable `code`; through the tool, an unmounted seam surfaces as an actionable unavailable answer the model can read.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Capability seam, Service Definition role.** The package owns `ctx.video` and the provider registry; providers post prompts and speak endpoint protocols, not tools, and `dsh-tool-video` is the only owner of the model-facing surface.
- **Exclusive whole-corpus reservation.** One provider holds the seam at a time; a generation backend claims the deployment's text-to-video pipeline, so a second registration is a conflict rather than a co-existing route.
- **Atomic registration.** `registerProvider()` validates and conflict-checks everything before mutating: an invalid or conflicting registration publishes nothing, and its disposer releases the reservation.
- **Order-independent routing.** The route forwards to the single registered provider through `ctx.effect()`, so the reservation lives and dies with the registering fiber; registration and HMR order never change which provider answers.
- **Closed, provider-agnostic vocabulary.** The request and result fields are fixed across backends — adding a refinement is a compile-enforced change across the seam, providers, and the tool. There is no protocol escape hatch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Video` service, `registerProvider`/`generate`, `VideoError` codes |
| [`src/types.ts`](src/types.ts) | Seam vocabulary: request, result, provider, and service contracts |
| — | No runtime invariant companion is published; the provider reservation is private, atomically updated state; the seam exposes neither an enumerable snapshot nor lifecycle events to compare independently. |

### Registration and disposal lifecycle

Registration and disposal run through `ctx.effect()`, so the provider route lives and dies with the registering fiber. `registerProvider()` returns a synchronous disposer; the seam drops the always-resolved effect promise so its disposer API stays synchronous. `VideoError` extends `HarnessError` with stable codes (`VIDEO_INVALID_PROVIDER`, `VIDEO_CONFLICT`, `VIDEO_UNAVAILABLE`, `VIDEO_DISPOSED`, `VIDEO_INVALID_REQUEST`, `VIDEO_PROVIDER_FAILED`) that callers route on instead of parsing `message`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared generation model to the provider and the tool.

- [dsh-video-wuyinkeji](../video-wuyinkeji/README.md) — the async-task provider that registers against this seam.
- [dsh-tool-video](../tool-video/README.md) — the model-facing tool over this seam.
- [video group map](../README.md) — the four-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-video`, which owns the model-facing `generate_video` schema, prompt guidance, and rendered results while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-video` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the seam's current scope. They are package constraints, not a task backlog.

- **Single provider per runtime** — one generation backend is a whole-corpus claim, so a second registration conflicts instead of co-existing. A deployment-configured selector above registrations is the intended extension if multi-provider routing is ever needed.
- **One route, no editing** — the seam exposes only `generate`; extension, lip-sync, or upscaling endpoints are different capabilities and have no route here.
- **No size or duration bounds** — the seam applies no cap, so consumers own the byte and duration budget and providers own the endpoint timeout.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
