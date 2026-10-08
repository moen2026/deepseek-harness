---
description: "OpenAI-compatible HTTP image-generation provider for the DeepSeek Harness image seam (ctx.image) — JSON posts of text prompts to a deployment-named /images/generations endpoint with call-time bearer credentials and typed provider-failure errors."
kind: "package-reference"
---

# @deepseek-ai/dsh-image-http

English | [中文](README.zh.md)

## Summary

Mount `dsh-image-http` to back `ctx.image` with an OpenAI-compatible generation endpoint: each request posts the text prompt as JSON to the configured URL requesting base64 answers, reads the bearer token from the environment variable named by `authEnv` at call time, and maps the JSON answer onto the seam's image result. Endpoint, model, and credential stay deployment-owned, so DSH never selects a generation model. Failures surface as typed `IMAGE_PROVIDER_FAILED` errors — there is no local fallback generation. Registration is effect-scoped; disposal unregisters the provider.

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

Choose this provider when the deployment already operates (or buys) an OpenAI-compatible text-to-image endpoint. The endpoint URL, model name, and credential variable are required configuration; the provider carries no key material, ships no model, and reaches only the configured URL.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-image-http'
  config:
    url: https://example.invalid/v1/images/generations
    model: image-1
    authEnv: DSH_IMAGE_API_KEY
    timeoutMs: 120000
```

`authEnv` names the environment variable holding the bearer token — never the token itself. The token is read at call time, so rotating the environment variable takes effect on the next request without a restart.

### Failures and recovery

A missing credential variable, a transport failure, a non-2xx response, a non-JSON body, or an unexpected response shape each throw `ImageError` `IMAGE_PROVIDER_FAILED` with a message naming what failed. Callers — including `dsh-tool-image` — report the failure; nothing degrades to a fabricated image.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Service Provider role.** The package registers one `ImageProvider` (`id: image-http`) on `ctx.image` and owns nothing else: no tool, no prompt, no storage.
- **Credential by reference.** Configuration stores the *name* of the bearer-token variable; the secret is read from the environment at call time and is never written to configuration, logs, or the request body.
- **Base64 answers only.** The provider always requests `response_format: b64_json`, the one answer form the seam's byte-oriented result vocabulary can carry; image bytes never arrive as URLs the caller would have to fetch.
- **Typed failures.** Every endpoint-side failure becomes `IMAGE_PROVIDER_FAILED`, so callers route on `code` instead of parsing transport errors.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema and provider registration |
| [`src/generate.ts`](src/generate.ts) | The HTTP client: JSON request, base64 decode, response mapping, typed failures |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-image](../image/README.md) — the seam this provider registers on.
- [dsh-tool-image](../tool-image/README.md) — the model-facing tool that consumes generated images.
- [image group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the provider answers generation requests without contributing anything to model requests; `dsh-tool-image` owns the model-facing schema and rendering.

#### KV Cache effect

No effect; this provider contributes nothing to model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the provider's current scope. They are package constraints, not a task backlog.

- **One endpoint per instance** — a deployment that needs several endpoints must mount several contexts; the seam's single-provider rule already forbids co-registration.
- **First image only** — when an endpoint returns several images per request, the provider maps the first; the `n` request refinement is passed through but multi-image results are not modeled.
- **No URL-fetch fallback** — the provider requests base64 answers and does not fetch URL-shaped answers; endpoints that cannot return `b64_json` fail with `IMAGE_PROVIDER_FAILED`.
- **No local engine** — generation requires the configured endpoint; offline deployments get an actionable `IMAGE_PROVIDER_FAILED` instead of a result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
