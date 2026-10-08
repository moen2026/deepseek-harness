---
description: "The audio group map: audio transcription through the audio seam, its OpenAI-compatible HTTP provider with deployment-owned credentials, and the model-facing transcribe_audio tool, for users and maintainers navigating the group."
kind: "package-group"
---

# audio/ — Audio transcription for agents

English | [中文](README.zh.md)

## Summary

The audio group lets agents convert workspace audio files into text: `transcribe_audio` resolves a file, reads it under a byte budget, and returns the provider's transcript. Use `audio-http` to back the seam with an OpenAI-compatible `/audio/transcriptions` endpoint whose URL, model, and credential stay deployment-owned, and `tool-audio` to expose transcription to the model. The shared `audio` package keeps the request and transcript vocabulary provider-neutral, so swapping a provider does not change model requests. This group ships no transcription engine, selects no model, and answers nothing when no provider is mounted.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`audio/`](audio/README.md) | Defines the audio service: an exclusive single-provider reservation and one order-independent route (transcribe) | `ctx.audio` |
| [`audio-http/`](audio-http/README.md) | Uploads raw audio bytes to a deployment-named OpenAI-compatible endpoint and maps the answer onto the seam's transcript | registers on `ctx.audio` |
| [`tool-audio/`](tool-audio/README.md) | Exposes transcription to the model through `transcribe_audio` over the filesystem | registers on `ctx.tools` |

Providers upload bytes and speak endpoint protocols, not tools: `tool-audio` is the only owner of the model-facing name, schema, prompt guidance, and presentation, so swapping a provider never changes how the model asks for transcription.

-----

<a id="related-documentation"></a>
## Related documentation

- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-audio) — the `transcribe_audio` schema the model receives.
- [Audio subsystem](../../docs/subsystems/audio.md) — the group's registration surface and how the three packages compose.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
