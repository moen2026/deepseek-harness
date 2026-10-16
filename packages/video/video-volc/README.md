---
description: "Volcengine Ark (Seedance) video-generation provider for the DeepSeek Harness video seam (ctx.video) — task submission to the Ark inference plane over Bearer ARK-key auth (chat-completions by default, the Seedance 2.5 content-generation task family by model), task polling until settlement, download of the settled video URL into raw bytes, optional registration of public reference images as private Seedance assets through the signed Volcengine OpenAPI control plane (HMAC-SHA256 AK/SK), call-time credentials, and typed provider-failure errors."
kind: "package-reference"
---

# @deepseek-ai/dsh-video-volc

English | [中文](README.zh.md)

## Summary

Mount `dsh-video-volc` to back `ctx.video` with Volcengine Ark's Seedance video generation: each request posts the prompt with its hints as a task to the Ark inference plane over Bearer ARK-key auth (chat-completions by default, the content-generation task family for Seedance 2.5 models), polls until settlement, and downloads the settled video URL into raw bytes. With a control-plane AK/SK pair also configured, every public reference image is first registered as a private Seedance asset and referenced as `asset://`. Credentials are read from environment variables named in the configuration at call time; failures surface as typed `VIDEO_PROVIDER_FAILED` errors; registration is effect-scoped.

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

Choose this provider when the deployment generates videos through Volcengine Ark's Seedance models or an Ark-compatible endpoint. `authEnv` is the required configuration; `arkBaseURL` defaults to the public inference plane, and the optional `assetAuthEnv`/`assetSecretEnv` pair switches on private-asset registration for reference images. The provider carries no key material.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-video-volc'
  config:
    authEnv: DSH_ARK_API_KEY
    assetAuthEnv: DSH_VOLC_ACCESS_KEY_ID
    assetSecretEnv: DSH_VOLC_SECRET_ACCESS_KEY
    project: default
    assetGroupId: my-seedance-group
    pollIntervalMs: 10000
    timeoutMs: 600000
```

`authEnv` names the environment variable holding the ARK API key — never the key itself. The configured `model` selects the task family: official Ark model ids (`doubao-seedance-*`, Seedance 1.0 and 2.5 alike) submit content-generation tasks, where the prompt becomes the `text` entry, each present reference image, video, or audio becomes one typed content entry with its role, `aspectRatio` maps onto `ratio`, and `size` maps onto the `480p`/`720p`/`1080p` resolution tiers, while every other model keeps the chat-completions submission, where the prompt becomes the user message, the one `referenceImage` becomes a leading `reference_image` message entry, and `size` picks the `720p` or `1080p` tier. In both families `duration` must be a positive integer of seconds, the content-generation `-1` sentinel aside; an uninterpretable hint or duration fails as `VIDEO_INVALID_REQUEST` before any I/O, and hints a family has no field for are dropped. For content-generation submissions, `generateAudio` submits `generate_audio` and `referenceTaskType` submits `extra_body.omni_reference_task_type` — `reference` for omni-reference generation, `edit` to edit the referenced video, or `extend` to continue the referenced video past its ending, the prompt addressing entries as `@视频N` — and a `duration` of `-1` passes the endpoint's automatic-duration sentinel through, letting the model decide the length; omitted values leave the fields out. With `assetAuthEnv` and `assetSecretEnv` configured together (either alone fails at mount), every public reference-image URL is first registered as a private Seedance asset — filed under `project` (default `default`), grouped under `assetGroupId` (created on first use when omitted), and polled through its review — and the generation references the reviewed asset as `asset://<id>`; the control-plane requests authenticate with the Volcengine HMAC-SHA256 request signature over that AK/SK pair. `pollIntervalMs` (default 10000) spaces task and asset polls; `timeoutMs` (default 600000) bounds submission, polling, and download together, elapsing inside the stock tool-call budget so a slow generation reports this typed timeout before a generic tool deadline preempts it. Every credential is read at call time, so rotating an environment variable takes effect on the next request without a restart.

### Failures and recovery

A missing credential variable, a transport failure, a non-2xx response, a non-JSON body, a rejected submission, task, or control-plane call, a task or asset that settles as failed, a missing task id or video URL, or an elapsed overall timeout each throw `VideoError` `VIDEO_PROVIDER_FAILED` with a message naming what failed and with the credentials redacted out of transport diagnostics. Callers — including `dsh-tool-video` — report the failure; nothing degrades to a fabricated video.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Service Provider role.** The package registers one `VideoProvider` (`id: video-volc`) on `ctx.video` and owns nothing else: no tool, no prompt, no storage.
- **Two planes, two credential kinds.** Generation speaks to the Ark inference plane with a Bearer ARK API key; private-asset registration speaks to the Volcengine OpenAPI control plane with an HMAC-SHA256-signed AK/SK pair. Each credential stays on its own plane, is read from an environment variable named in the configuration at call time, and is redacted from transport diagnostics.
- **Async task lifecycle, two task families.** The configured model selects the family: a chat-completions-shaped POST or a content-generation task POST answers with a task id, task polls report settlement, and the settled video URL is downloaded into raw bytes, the one answer form the seam's byte-oriented result vocabulary can carry.
- **Assetize before generate.** When the control plane is configured, a public reference image is registered, reviewed, and addressed as `asset://` before submission, so generations reference reviewed private material instead of raw public URLs.
- **Typed failures.** Every endpoint-side failure becomes `VIDEO_PROVIDER_FAILED`, so callers route on `code` instead of parsing transport errors; request hints the endpoint cannot express fail locally as `VIDEO_INVALID_REQUEST` before any I/O.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, asset-client wiring, provider registration |
| [`src/generate.ts`](src/generate.ts) | The inference client: task submission with hint normalization, task polling, video download, typed failures |
| [`src/asset.ts`](src/asset.ts) | The control-plane client: signed OpenAPI calls, group and asset creation, review polling |
| [`src/internal.ts`](src/internal.ts) | Shared failure mapping, credential redaction, and abort-aware polling sleep |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-video](../video/README.md) — the seam this provider registers on.
- [dsh-tool-video](../tool-video/README.md) — the model-facing tool that consumes generated videos.
- [video group map](../README.md) — the package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the provider answers generation requests without contributing anything to model requests; `dsh-tool-video` owns the model-facing schema and rendering.

#### KV Cache effect

No effect; this provider contributes nothing to model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the provider's current scope. They are package constraints, not a task backlog.

- **One endpoint pair per instance** — a deployment that needs several inference or control planes must mount several contexts; the seam's single-provider rule already forbids co-registration.
- **Local hint interpretation only for duration and size** — `duration` and `size` are validated locally as `VIDEO_INVALID_REQUEST`; every other refinement the endpoint has no field for is dropped silently rather than reported.
- **One reference per kind** — the seam's request vocabulary carries at most one reference image, video, and audio URL; the Seedance 2.5 content-generation family accepts tens of each, and multi-reference prompts that index several entries stay beyond the vocabulary.
- **No local engine** — generation requires the configured endpoint; offline deployments get an actionable `VIDEO_PROVIDER_FAILED` instead of a result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
