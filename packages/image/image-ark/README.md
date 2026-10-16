---
description: "Volcengine Ark (Seedream)-backed image-generation provider for the DeepSeek Harness image seam (ctx.image) — one synchronous JSON post of the prompt to the Ark /images/generations endpoint with optional reference-image conditioning and layer decomposition, download of every answered image URL into raw bytes, call-time credentials, and typed provider-failure errors."
kind: "package-reference"
---

# @deepseek-ai/dsh-image-ark

English | [中文](README.zh.md)

## Summary

Mount `dsh-image-ark` to back `ctx.image` with Volcengine Ark's Seedream image generation: each request posts the text prompt to the synchronous `/api/v3/images/generations` endpoint, the API key is read from the environment variable named by `authEnv` at call time, and every image URL the answer carries is downloaded into raw bytes. A plain generation answers one image; `layerDecomposition: true` asks Seedream to separate the answer into stacked layers, and the provider maps each layer's `z_index`, cropped extent, bounding box, name, and description onto the seam's layer vocabulary. Base URL, model, and credential stay deployment-owned. Failures surface as typed `IMAGE_PROVIDER_FAILED` errors — there is no local fallback generation. Registration is effect-scoped; disposal unregisters the provider.

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

Choose this provider when the deployment generates images through Volcengine Ark's Seedream models or an Ark-compatible endpoint. `authEnv` is the required configuration; `arkBaseURL` defaults to the public `https://ark.cn-beijing.volces.com` and `model` to Seedream 5.0 Pro. The provider carries no key material.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-image-ark'
  config:
    authEnv: DSH_ARK_API_KEY
    layerDecomposition: true
    outputFormat: png
    timeoutMs: 120000
```

`authEnv` names the environment variable holding the ARK API key — never the key itself. `arkBaseURL` is the Ark inference base URL the submission path is appended to; `model` selects the Seedream model (`doubao-seedream-5-0-pro-260628` by default). `layerDecomposition` (default false) submits `layer_decomposition`, asking the endpoint to return the answer as stacked layers. `outputFormat` submits `output_format` (`png` or `jpeg`); omitted values leave the field out. `timeoutMs` (default 120000) bounds submission and every download together, elapsing inside the stock tool-call budget so a slow generation reports this typed timeout before a generic tool deadline preempts it. The key is read at call time, so rotating the environment variable takes effect on the next request without a restart.

### Failures and recovery

A missing credential variable, a transport failure, a non-2xx response, a non-JSON body, an answer without images, a decomposed layer without a usable `z_index` or size, or a failed download each throw `ImageError` `IMAGE_PROVIDER_FAILED` with a message naming what failed. Callers — including `dsh-tool-image` — report the failure; nothing degrades to a fabricated image.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Service Provider role.** The package registers one `ImageProvider` (`id: image-ark`) on `ctx.image` and owns nothing else: no tool, no prompt, no storage.
- **Credential by reference.** Configuration stores the *name* of the API-key variable; the secret is read from the environment at call time and is never written to configuration, logs, or the request body.
- **Synchronous submission.** The endpoint answers in one round trip with one URL per produced image, which the provider downloads into raw bytes, the one answer form the seam's byte-oriented result vocabulary can carry.
- **Layer vocabulary mapping.** With decomposition on, each answered entry becomes an `ImageLayer` — `z_index`, its own cropped pixel extent, the absolute bounding box within the composed image, and the endpoint-assigned name and description — while the result's bytes carry the lowest layer, the composed background.
- **Typed failures.** Every endpoint-side failure becomes `IMAGE_PROVIDER_FAILED`, so callers route on `code` instead of parsing transport errors.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema and provider registration |
| [`src/generate.ts`](src/generate.ts) | The synchronous client: submission, parallel download of every answered URL, layer mapping, typed failures |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-image](../image/README.md) — the seam this provider registers on.
- [dsh-tool-image](../tool-image/README.md) — the model-facing tool that consumes generated images.
- [image group map](../README.md) — the package family and its related documentation.

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
- **First reference only** — of the request's `referenceImages`, only the first URL is submitted as the endpoint's `image` field; the Ark image endpoint takes one conditioning image.
- **Pass-through size hint** — a request's `size` is submitted unchanged as the endpoint's `size`; the vocabulary is not validated locally, so an unsupported hint fails remotely with `IMAGE_PROVIDER_FAILED`.
- **Layer extents are endpoint-reported** — layer sizes come from each entry's `size` field and are not verified against the downloaded bytes.
- **No local engine** — generation requires the configured endpoint; offline deployments get an actionable `IMAGE_PROVIDER_FAILED` instead of a result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
