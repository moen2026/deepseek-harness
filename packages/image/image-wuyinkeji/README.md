---
description: "Wuyinkeji-backed async image-generation provider for the DeepSeek Harness image seam (ctx.image) — JSON posts of text prompts (plus reference-image URLs on NanoBanana2Lite) to the public async image task endpoint (GPT-Image-2.5 or NanoBanana2Lite, selected by `model`), result-detail polling until task settlement, download of the settled image URL into raw bytes, call-time credentials, and typed provider-failure errors."
kind: "package-reference"
---

# @deepseek-ai/dsh-image-wuyinkeji

English | [中文](README.zh.md)

## Summary

Mount `dsh-image-wuyinkeji` to back `ctx.image` with Wuyinkeji's async task APIs: each request submits the text prompt as JSON to the endpoint `model` selects (`gpt-image-2.5` by default, or `nano-banana-2-lite`), the API key is read from the environment variable named by `authEnv` at call time, result-detail polls report the task's settlement, and the settled image URL is downloaded into raw bytes; `nano-banana-2-lite` forwards optional reference-image URLs, while `gpt-image-2.5` rejects them upstream. Base URL, model, aspect-ratio default, and credential stay deployment-owned. Failures surface as typed `IMAGE_PROVIDER_FAILED` errors — there is no local fallback generation. Registration is effect-scoped; disposal unregisters the provider.

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

Choose this provider when the deployment generates images through Wuyinkeji's async task API or a Wuyinkeji-compatible endpoint. `authEnv` is the required configuration; `baseURL` defaults to the public `https://api.wuyinkeji.com`, and `model` names the task endpoint (`gpt-image-2.5` by default, or `nano-banana-2-lite`) and its reference-image policy. The provider carries no key material.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-image-wuyinkeji'
  config:
    authEnv: DSH_WUYINKEJI_API_KEY
    model: gpt-image-2.5
    aspectRatio: 1024*1024
    pollIntervalMs: 3000
    timeoutMs: 120000
```

`authEnv` names the environment variable holding the API key — never the key itself. `model` selects the submission endpoint and its ratio vocabulary: `gpt-image-2.5` (default) takes pixel-pair ratios such as `1024*1024`, while `nano-banana-2-lite` takes colon ratios such as `16:9` and reduces a pixel-pair `size` like `1024x1536` to its lowest-terms ratio. A request's `referenceImages` URLs are sent as the endpoint's `urls` field by `nano-banana-2-lite` only; the `gpt-image-2.5` endpoint rejects a submission carrying `urls`, so that model never sends them. `aspectRatio` is the wire ratio sent when a request carries no `size`, expressed in the selected model's vocabulary; `pollIntervalMs` (default 3000) spaces result-detail polls; `timeoutMs` (default 120000) bounds submission, polling, and download together, elapsing inside the stock tool-call budget so a slow generation reports this typed timeout before a generic tool deadline preempts it. The key is read at call time, so rotating the environment variable takes effect on the next request without a restart.

### Failures and recovery

A missing credential variable, a transport failure, a non-2xx response, a non-JSON body, a rejected submission or result-detail call, an unknown task status, a failed task, or an elapsed overall timeout each throw `ImageError` `IMAGE_PROVIDER_FAILED` with a message naming what failed. Callers — including `dsh-tool-image` — report the failure; nothing degrades to a fabricated image.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Service Provider role.** The package registers one `ImageProvider` (`id: image-wuyinkeji`) on `ctx.image` and owns nothing else: no tool, no prompt, no storage.
- **Credential by reference.** Configuration stores the *name* of the API-key variable; the secret is read from the environment at call time and is never written to configuration, logs, or the request body.
- **Async task lifecycle.** One submission answers with a task id; result-detail polls report settlement; the settled image URL is downloaded into raw bytes, the one answer form the seam's byte-oriented result vocabulary can carry.
- **Model-selected endpoint.** `model` fixes the submission endpoint, its ratio vocabulary, and whether request reference-image URLs are forwarded; one instance serves one model, while the detail path, polling, and download stay shared across models.
- **Typed failures.** Every endpoint-side failure becomes `IMAGE_PROVIDER_FAILED`, so callers route on `code` instead of parsing transport errors.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema and provider registration |
| [`src/generate.ts`](src/generate.ts) | The async client: submission with model-gated reference-image forwarding, result-detail polling, image download, typed failures |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-image](../image/README.md) — the seam this provider registers on.
- [dsh-tool-image](../tool-image/README.md) — the model-facing tool that consumes generated images.
- [image group map](../README.md) — the four-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the provider answers generation requests without contributing anything to model requests; `dsh-tool-image` owns the model-facing schema and rendering.

#### KV Cache effect

No effect; this provider contributes nothing to model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the provider's current scope. They are package constraints, not a task backlog.

- **One endpoint per instance** — a deployment that needs several endpoints or models must mount several contexts; the seam's single-provider rule already forbids co-registration.
- **First image only** — a settled task's `result` array is mapped at its first entry; multi-image results are not modeled.
- **Pass-through ratio mapping** — a request's `size` becomes the wire ratio mechanically: `x`/`×` rewrite to `*` for `gpt-image-2.5`, while `nano-banana-2-lite` keeps a colon ratio and reduces a pixel pair to lowest terms. Neither vocabulary is validated locally, so an unsupported ratio fails remotely with `IMAGE_PROVIDER_FAILED`.
- **Reference images only on NanoBanana2Lite** — the seam's request vocabulary carries optional reference-image URLs, and `nano-banana-2-lite` forwards them as `urls`; the `gpt-image-2.5` endpoint rejects the field upstream, so that model never sends reference images.
- **No local engine** — generation requires the configured endpoint; offline deployments get an actionable `IMAGE_PROVIDER_FAILED` instead of a result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
