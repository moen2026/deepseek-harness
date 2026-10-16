---
description: "Wuyinkeji-backed async video-generation provider for the DeepSeek Harness video seam (ctx.video) — JSON posts of text prompts (plus optional size, duration, aspect-ratio, frame-conditioning, and reference-media hints) to the public video task endpoint the configured model selects (Google-Omni, MiniMax H3, or Grok Imagine), result-detail polling until task settlement, download of the settled video URL into raw bytes, call-time credentials, and typed provider-failure errors."
kind: "package-reference"
---

# @deepseek-ai/dsh-video-wuyinkeji

English | [中文](README.zh.md)

## Summary

Mount `dsh-video-wuyinkeji` to back `ctx.video` with Wuyinkeji's async video task API: each request submits the text prompt (plus optional size, duration, aspect-ratio, frame-conditioning, and reference-media URL hints) as JSON to the video task endpoint the configured `model` selects (Google-Omni, MiniMax H3, or Grok Imagine), the API key is read from the environment variable named by `authEnv` at call time, result-detail polls report settlement, and the settled video URL is downloaded into raw bytes. Base URL and credential stay deployment-owned. Failures surface as typed `VIDEO_PROVIDER_FAILED` errors — there is no local fallback generation. Registration is effect-scoped; disposal unregisters the provider.

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

Choose this provider when the deployment generates videos through Wuyinkeji's async video task API or a Wuyinkeji-compatible endpoint. `authEnv` is the required configuration; `baseURL` defaults to the public `https://api.wuyinkeji.com`, and `model` selects the submission path and request-field mapping (`google-omni`, the default, `minimax-h3`, or `grok-imagine`). The provider carries no key material.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-video-wuyinkeji'
  config:
    authEnv: DSH_WUYINKEJI_API_KEY
    model: minimax-h3
    pollIntervalMs: 10000
    timeoutMs: 600000
```

`authEnv` names the environment variable holding the API key — never the key itself. The configured `model` fixes how a request's optional refinements map onto the endpoint's fields. `google-omni` maps mechanically: `size` has its multiplication sign rewritten (`1280×720` becomes `1280x720`), `duration` is sent as a string, `referenceImage` becomes the endpoint's `images` field, and `referenceVideo` becomes its `video` field; none is validated locally, so an unsupported value fails remotely. `minimax-h3` forwards `firstFrame`, `lastFrame`, `referenceImage`, `referenceVideo`, and `referenceAudio` to `first_frame`, `last_frame`, `images`, `videos`, and `audios`, and interprets its hints locally: `duration` must be an integer of 4–15 seconds, `aspectRatio` must name an accepted ratio (`adaptive`, `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`), and `size` must be a pixel pair (its shorter side picks the `768P` or `2K` resolution tier, and a reducible ratio is derived when no explicit `aspectRatio` is set) or a resolution token (`768P`, `2K`) — first/last frame images and reference media are mutually exclusive, and violations or uninterpretable hints fail locally as `VIDEO_INVALID_REQUEST` before any I/O. `grok-imagine` forwards `referenceImage` as a one-entry `image_urls` array, and interprets its hints locally: `duration` must be an integer of 6–10 seconds and `aspectRatio` must name `16:9` or `9:16`; hints the endpoint has no fields for (frame conditioning, reference video, reference audio) are dropped, and violations fail locally as `VIDEO_INVALID_REQUEST` before any I/O. `pollIntervalMs` (default 10000) spaces result-detail polls; `timeoutMs` (default 600000) bounds submission, polling, and download together, elapsing inside the stock tool-call budget so a slow generation reports this typed timeout before a generic tool deadline preempts it — video generations take minutes, so the budget exceeds the image provider's. The key is read at call time, so rotating the environment variable takes effect on the next request without a restart.

### Failures and recovery

A missing credential variable, a transport failure, a non-2xx response, a non-JSON body, a rejected submission or result-detail call, an unknown task status, a failed task, or an elapsed overall timeout each throw `VideoError` `VIDEO_PROVIDER_FAILED` with a message naming what failed. Callers — including `dsh-tool-video` — report the failure; nothing degrades to a fabricated video.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Service Provider role.** The package registers one `VideoProvider` (`id: video-wuyinkeji`) on `ctx.video` and owns nothing else: no tool, no prompt, no storage.
- **Credential by reference.** Configuration stores the *name* of the API-key variable; the secret is read from the environment at call time and is never written to configuration, logs, or the request body — the endpoint's protocol carries it only in the request's credential slots, and transport diagnostics redact it.
- **Async task lifecycle.** One submission answers with a task id; result-detail polls report settlement; the settled video URL is downloaded into raw bytes, the one answer form the seam's byte-oriented result vocabulary can carry.
- **Model-selected endpoint.** One instance submits to the video task path the configured `model` selects, while the detail path, polling, and download stay shared across deployments.
- **Typed failures.** Every endpoint-side failure becomes `VIDEO_PROVIDER_FAILED`, so callers route on `code` instead of parsing transport errors.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema and provider registration |
| [`src/generate.ts`](src/generate.ts) | The async client: submission with refinement normalization, result-detail polling, video download, typed failures |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-video](../video/README.md) — the seam this provider registers on.
- [dsh-tool-video](../tool-video/README.md) — the model-facing tool that consumes generated videos.
- [video group map](../README.md) — the four-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the provider answers generation requests without contributing anything to model requests; `dsh-tool-video` owns the model-facing schema and rendering.

#### KV Cache effect

No effect; this provider contributes nothing to model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the provider's current scope. They are package constraints, not a task backlog.

- **One endpoint per instance** — a deployment that needs several endpoints must mount several contexts; the seam's single-provider rule already forbids co-registration.
- **First video only** — a settled task's `result` array is mapped at its first entry; multi-video results are not modeled.
- **Google-Omni passes hints through** — on `google-omni` a request's `size`, `duration`, and reference-media URLs become the wire fields mechanically, with only the multiplication sign rewritten to `x`. Nothing is validated locally, so an unsupported value fails remotely with `VIDEO_PROVIDER_FAILED`; `minimax-h3` and `grok-imagine` validate their hints locally as `VIDEO_INVALID_REQUEST`.
- **One reference each** — the seam's request vocabulary carries at most one reference-image URL and one reference-video URL; the Google-Omni endpoint accepts no more than one of each, and MiniMax H3 and Grok Imagine accept more reference images than the vocabulary can express.
- **No local engine** — generation requires the configured endpoint; offline deployments get an actionable `VIDEO_PROVIDER_FAILED` instead of a result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
