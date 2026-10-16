---
description: "The video group map: video generation through the video seam, its Wuyinkeji and Volcengine Ark async providers with deployment-owned credentials, and the model-facing generate_video tool, for users and maintainers navigating the group."
kind: "package-group"
---

# video/ — Video generation for agents

English | [中文](README.zh.md)

## Summary

The video group lets agents create videos from prompts: `generate_video` sends the prompt to the provider, commits the bytes as a file attachment, and returns the file beside a bounded envelope. Back the seam with `video-wuyinkeji` (submit to the model-selected endpoint — Google-Omni, MiniMax H3, or Grok Imagine — poll, then download) or `video-volc` (Volcengine Ark Seedance task, poll, then download); base URL, model, and credential stay deployment-owned. `tool-video` exposes generation to the model. The shared `video` package keeps the vocabulary provider-neutral, so swapping providers never changes model requests. It ships no engine, answering nothing without a provider.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`video/`](video/README.md) | Defines the video service: an exclusive single-provider reservation and one order-independent route (generate) | `ctx.video` |
| [`video-wuyinkeji/`](video-wuyinkeji/README.md) | Submits text prompts to the Wuyinkeji video task endpoint the configured `model` selects (Google-Omni, MiniMax H3, or Grok Imagine), polls the task until settlement, and downloads the settled video URL into raw bytes | registers on `ctx.video` |
| [`video-volc/`](video-volc/README.md) | Posts a Seedance task to the Volcengine Ark inference plane — the chat-completions shape, or the content-generation family for Seedance 2.5 models — polls it until settlement, and downloads the settled video URL into raw bytes; optionally registers reference images as private Seedance assets | registers on `ctx.video` |
| [`tool-video/`](tool-video/README.md) | Exposes generation to the model through `generate_video` over the attachment store | registers on `ctx.tools` |

Providers post prompts and speak endpoint protocols, not tools: `tool-video` is the only owner of the model-facing name, schema, prompt guidance, and presentation, so swapping a provider never changes how the model asks for a video.

-----

<a id="related-documentation"></a>
## Related documentation

- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-video) — the `generate_video` schema the model receives.
- [Video subsystem](../../docs/subsystems/video.md) — the group's registration surface and how the packages compose.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
