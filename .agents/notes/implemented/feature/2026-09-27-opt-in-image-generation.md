# Agent Note: Opt-in image generation seam

Status: implemented

English | [中文](2026-09-27-opt-in-image-generation.zh.md)

## Problem

Models frequently benefit from producing an illustration, diagram sketch, or preview image as part of a deliverable, but the harness had no first-party image-generation capability: the only image path was `read_image`, which lets a model *view* workspace images but never *create* one. A deployment with an image-generation endpoint (OpenAI-compatible `/images/generations`) had no way to hand that capability to the model, and QoderWork parity (roadmap A3) requires the model to generate images on request.

## Decision

Image generation ships as the standard three-layer family: the [dsh-image](../../../../packages/image/image) seam (`ctx.image`: a single-provider reservation plus one `generate` route taking a text prompt and an optional size hint), the [dsh-image-http](../../../../packages/image/image-http) provider (an OpenAI-compatible `/images/generations` client that requests `b64_json` responses and decodes them to raw bytes), and the [dsh-tool-image](../../../../packages/image/tool-image) consumer (the `generate_image` tool: generate, then persist the bytes through `attachments.saveImage` and return both a text envelope and the image content block, so the picture renders inline like `read_image` output). The `full` preset mounts an isolated `image` group in which the seam and the tool always load and the provider stays disabled until a deployment names an endpoint through `DSH_IMAGE_URL`; with no provider the tool returns an actionable unavailable answer instead of breaking the session.

Two refinements beyond the audio template:

- **Gate before spend.** The tool checks that an attachment store is mounted *before* calling the generation endpoint, so a refusal never spends the deployment's generation budget on bytes that cannot be durably committed.
- **Storable-media-type validation.** The attachment seam accepts only PNG/JPEG/WebP/GIF; a generation endpoint returning anything else produces an actionable error naming the constraint rather than a mid-write crash.

The neutrality statement matches audio and memory's embedding path: the endpoint URL, model name, and bearer-token *variable name* are deployment configuration (`DSH_IMAGE_URL`, `DSH_IMAGE_MODEL`, `DSH_IMAGE_AUTH_ENV`); the credential is read from the environment at call time and never written to YAML, logs, or the request body. DSH never selects a generation model. Every endpoint-side failure is a typed `ImageError` `IMAGE_PROVIDER_FAILED`; nothing degrades to a fabricated image.

## Alternatives considered

**Returning a file path instead of inline image content.** A path-only answer forces the user to open the file manually and loses the read-aloud context of what was generated. Reusing `read_image`'s persist-and-attach pattern keeps generated and pre-existing images visually identical in the conversation.

**Multipart/form-data uploads in the provider.** The OpenAI-compatible generation endpoint takes JSON only; adding form support would be speculative surface for no current consumer.

**Reusing `ctx.llm` multimodal output.** The primary provider path returns text and audio, not image bytes; image generation is a distinct deployment-owned capability, and tying it to model selection would make the tool unavailable on text-only routes.

## Consequences

- A deployment that sets no new environment variables sees no behavior change: `generate_image` mounts and answers "unavailable" in a form the model can report and suggest from.
- Generated images become ordinary attachments: they appear in the attachment store, can be re-read later, and participate in the same size/budget accounting as `read_image` output.
- `docs/subsystems/image.md` gains a generated Cordis API section; `generate_image` is catalogued in `docs/tool-catalog.md` with its system-prompt section at first-party order 2456.
