---
description: "OpenAI-compatible HTTP transcription provider for the DeepSeek Harness audio seam (ctx.audio) — multipart upload of raw audio bytes to a deployment-named /audio/transcriptions endpoint with call-time bearer credentials and typed provider-failure errors."
kind: "package-reference"
---

# @deepseek-ai/dsh-audio-http

English | [中文](README.zh.md)

## Summary

Mount `dsh-audio-http` to back `ctx.audio` with an OpenAI-compatible transcription endpoint: each request uploads the raw audio bytes as `multipart/form-data` to the configured URL, reads the bearer token from the environment variable named by `authEnv` at call time, and maps the JSON answer onto the seam's transcript. Endpoint, model, and credential stay deployment-owned, so DSH never selects a transcription model. Failures surface as typed `AUDIO_PROVIDER_FAILED` errors — there is no local fallback transcription. Registration is effect-scoped; disposal unregisters the provider.

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

Choose this provider when the deployment already operates (or buys) an OpenAI-compatible speech-to-text endpoint. The endpoint URL, model name, and credential variable are required configuration; the provider carries no key material, ships no model, and reaches only the configured URL.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-audio-http'
  config:
    url: https://example.invalid/v1/audio/transcriptions
    model: whisper-1
    authEnv: DSH_AUDIO_API_KEY
    timeoutMs: 60000
```

`authEnv` names the environment variable holding the bearer token — never the token itself. The token is read at call time, so rotating the environment variable takes effect on the next request without a restart.

### Failures and recovery

A missing credential variable, a transport failure, a non-2xx response, a non-JSON body, or an unexpected response shape each throw `AudioError` `AUDIO_PROVIDER_FAILED` with a message naming what failed. Callers — including `dsh-tool-audio` — report the failure; nothing degrades to a fabricated transcript.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Service Provider role.** The package registers one `AudioProvider` (`id: audio-http`) on `ctx.audio` and owns nothing else: no tool, no prompt, no storage.
- **Credential by reference.** Configuration stores the *name* of the bearer-token variable; the secret is read from the environment at call time and is never written to configuration, logs, or the request body.
- **Typed failures.** Every endpoint-side failure becomes `AUDIO_PROVIDER_FAILED`, so callers route on `code` instead of parsing transport errors.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema and provider registration |
| [`src/transcribe.ts`](src/transcribe.ts) | The HTTP client: multipart upload, media-type resolution, response mapping, typed failures |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-audio](../audio/README.md) — the seam this provider registers on.
- [dsh-tool-audio](../tool-audio/README.md) — the model-facing tool that consumes transcripts.
- [audio group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

None, as the provider answers transcription requests without contributing anything to model requests; `dsh-tool-audio` owns the model-facing schema and rendering.

#### KV Cache effect

No effect; this provider contributes nothing to model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the provider's current scope. They are package constraints, not a task backlog.

- **One endpoint per instance** — a deployment needs several endpoints must mount several contexts; the seam's single-provider rule already forbids co-registration.
- **No streaming or diarization** — the provider answers one complete transcript per request; segment-level or speaker-attributed results are not modeled.
- **No local engine** — transcription requires the configured endpoint; offline deployments get an actionable `AUDIO_PROVIDER_FAILED` instead of a result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
