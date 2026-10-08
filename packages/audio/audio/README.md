---
description: "The audio-transcription capability seam (ctx.audio): a single-provider reservation registry and one order-independent route — transcribe — over raw audio bytes, for users and maintainers composing or extending speech-to-text for agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-audio

English | [中文](README.zh.md)

## Summary

Use `dsh-audio` to give agents speech-to-text: one `transcribe` route takes raw audio bytes plus optional format and language refinements and returns the provider's transcript, so a backend's endpoint, model, and credentials never change the request or the result. A single provider reserves the seam exclusively, and registration is atomic: an invalid or conflicting claim publishes nothing. Combine it with a provider such as `dsh-audio-http` and the model-facing `dsh-tool-audio`; alone it answers no request and throws `AUDIO_UNAVAILABLE`. It selects no transcription model on the caller's behalf.

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

Mount an audio provider and the `transcribe_audio` tool to let the model turn workspace audio files into text. This package is the service those packages register against; it defines no UI, tool, or transcription backend of its own.

### When to choose it

Choose this service when a deployment wants model-visible transcription backed by an endpoint the model never builds or addresses. It covers one route — transcribe — with provider-owned protocol and credentials; request shape, media-type hints, and transcript metadata are fixed by the seam, so replacing the provider does not change what the model sees or how it asks.

### Composing an audio stack

The seam needs a provider and a consumer to do anything. A minimal composition mounts the service, an HTTP provider, and the tool:

```yaml
- name: '@deepseek-ai/dsh-audio'
- name: '@deepseek-ai/dsh-audio-http'
  config:
    url: https://example.invalid/v1/audio/transcriptions
    model: whisper-1
    authEnv: DSH_AUDIO_API_KEY
- name: '@deepseek-ai/dsh-tool-audio'
```

The endpoint, model, and credential variable are configured in the provider package; see [dsh-audio-http](../audio-http/README.md) and [dsh-tool-audio](../tool-audio/README.md).

### The operation

`transcribe(request, signal?)` takes an `AudioTranscribeRequest` — a required `data` byte payload plus optional `fileName`, `mediaType`, `language`, and `prompt` — and returns an `AudioTranscript` of recognized text with optional provider-reported `language` and `durationSec`. The seam applies no timeout, byte cap, or format filter, so there is no `resolve()` step; consumers own those bounds.

### Failures and recovery

A request fails with the structured error `AUDIO_UNAVAILABLE` when no provider is registered — mount a provider or continue without transcription. Invalid or conflicting registrations fail with `AUDIO_INVALID_PROVIDER` or `AUDIO_CONFLICT` before any route is published, an operation against a disposed provider fails with `AUDIO_DISPOSED`, a malformed request fails with `AUDIO_INVALID_REQUEST`, and a backend failure fails with `AUDIO_PROVIDER_FAILED`. Consumers catch `AudioError` and route on its stable `code`; through the tool, an unmounted seam surfaces as an actionable unavailable answer the model can read.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the seam and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design philosophy

- **Capability seam, Service Definition role.** The package owns `ctx.audio` and the provider registry; providers upload bytes and speak endpoint protocols, not tools, and `dsh-tool-audio` is the only owner of the model-facing surface.
- **Exclusive whole-corpus reservation.** One provider holds the seam at a time; a transcription backend claims the deployment's speech-to-text pipeline, so a second registration is a conflict rather than a co-existing route.
- **Atomic registration.** `registerProvider()` validates and conflict-checks everything before mutating: an invalid or conflicting registration publishes nothing, and its disposer releases the reservation.
- **Order-independent routing.** The route forwards to the single registered provider through `ctx.effect()`, so the reservation lives and dies with the registering fiber; registration and HMR order never change which provider answers.
- **Closed, provider-agnostic vocabulary.** The request and transcript shapes are fixed across backends — adding a refinement is a compile-enforced change across the seam, providers, and the tool. There is no protocol escape hatch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Audio` service, `registerProvider`/`transcribe`, `AudioError` codes |
| [`src/types.ts`](src/types.ts) | Seam vocabulary: request, transcript, provider, and service contracts |
| — | No runtime invariant companion is published; the provider reservation is private, atomically updated state; the seam exposes neither an enumerable snapshot nor lifecycle events to compare independently. |

### Registration and disposal lifecycle

Registration and disposal run through `ctx.effect()`, so the provider route lives and dies with the registering fiber. `registerProvider()` returns a synchronous disposer; the seam drops the always-resolved effect promise so its disposer API stays synchronous. `AudioError` extends `HarnessError` with stable codes (`AUDIO_INVALID_PROVIDER`, `AUDIO_CONFLICT`, `AUDIO_UNAVAILABLE`, `AUDIO_DISPOSED`, `AUDIO_INVALID_REQUEST`, `AUDIO_PROVIDER_FAILED`) that callers route on instead of parsing `message`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared transcription model to the provider and the tool.

- [dsh-audio-http](../audio-http/README.md) — the OpenAI-compatible HTTP provider that registers against this seam.
- [dsh-tool-audio](../tool-audio/README.md) — the model-facing tool over this seam.
- [audio group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-audio`, which owns the model-facing `transcribe_audio` schema, prompt guidance, and rendered results while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-audio` owns request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the seam's current scope. They are package constraints, not a task backlog.

- **Single provider per runtime** — one transcription backend is a whole-corpus claim, so a second registration conflicts instead of co-existing. A deployment-configured selector above registrations is the intended extension if multi-provider routing is ever needed.
- **One route, no synthesis** — the seam exposes only `transcribe`; text-to-speech is a different capability and has no route here.
- **No byte or duration bounds** — the seam applies no cap, so consumers own the audio-size budget and providers own the endpoint timeout.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
