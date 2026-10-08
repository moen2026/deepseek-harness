---
description: "The model-facing transcribe_audio tool over the ctx.audio seam and ctx.fs: resolve a workspace audio file, read it bounded, and return the provider's transcript as text, with an actionable unavailable answer when no provider is mounted, for users and maintainers composing audio transcription."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-audio

English | [中文](README.zh.md)

## Summary

`dsh-tool-audio` gives a model one tool over `ctx.audio`: `transcribe_audio` resolves a workspace audio file through `ctx.fs`, reads it under a byte budget, and returns the provider's transcript as text with optional language and duration metadata. The tool is unavailable until an audio provider is mounted; without one it returns an actionable "audio unavailable" message instead of failing the session. A missing file, a non-regular file, or an oversized file surfaces as a structured filesystem error; the transcript is bounded by `maxResultChars`. The package runtime-injects only `tools`, `audio`, `fs`, and `systemPrompt` and imports no provider.

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

A model calls `transcribe_audio` when it needs the content of an audio file the user mentioned or that it discovered in the workspace; the tool's prompt guidance tells it to continue without transcription when the capability is not configured.

### The tool

`transcribe_audio` takes a required `file_path` plus optional `language` (an ISO 639-1 hint) and `prompt` (free-text steering, for example known terms). Each trims its inputs, drops blank refinements, and rejects a blank `file_path` or a non-string refinement as an actionable argument error before touching the seam or the filesystem. Provider choice, endpoint, credential, and audio format support stay outside model input; they belong to the mounted provider.

### What the model gets back

The tool returns a closed result: `status` `ok` with `path`, `text`, and optional provider-reported `language` and `durationSec`, or `unavailable` with `path`. Rendering emits a `<path>`/`<type>transcript</type>` envelope with an optional `<meta>` line (`language xx, Ns`) and the transcript inside `<content>`, bounded by `maxResultChars` with a truncation notice counted inside the cap. When no provider is mounted, the render is the actionable unavailable message instead of an error.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxResultChars` | `8000` | Largest complete rendered transcript, including the truncation notice |
| `maxAudioBytes` | `26214400` | Inclusive byte ceiling on one transcribed audio file (25 MiB) |
| `timeoutMs` | `120000` | Tool-call timeout budget, covering one transcription round trip |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-audio) is the exhaustive source for every accepted field.

### Failures and recovery

A nonexistent path emits an `fs/observed` absent event and throws `FS_NOT_FOUND`; a directory or other non-regular file throws `FS_NOT_REGULAR_FILE`; a file over the byte budget throws the filesystem backend's oversized-read error. An `AUDIO_UNAVAILABLE` from the seam is caught and returned as `status: 'unavailable'` so the session keeps running. Any other `AudioError` (a provider failure, an invalid request) propagates as a structured tool error the model can read and route on.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design notes

- **Consumer-only.** The tool runtime-injects only `tools`, `audio`, `fs`, and `systemPrompt`, imports no provider, and passes only `exec.signal` to the seam and filesystem.
- **Argument normalization before the seam.** `parseTranscribeArgs` trims and collapses inputs, so the provider receives a canonical request and malformed input is an actionable error rather than a crash.
- **Availability is data, not a crash.** `execute` catches `AudioError` with code `AUDIO_UNAVAILABLE` and returns an `unavailable` status; every other error rethrows, so a genuinely broken provider is still surfaced.
- **Bounded read, bounded render.** The byte budget caps what leaves the workspace; `formatTranscript` caps what enters the conversation, with the truncation notice counted inside the cap.
- **Concurrency-safe read.** `transcribe_audio` returns `isConcurrencySafe: () => true` — one file per call and no shared mutable state.
- **Generic card presentation.** `presentTranscribeCall` renders `{ card: 'generic', kind: 'other', title }` titled with the file name; there is no rendered target, so no locations are attached.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, prompt section, `transcribe_audio` registration and execution |
| [`src/render.ts`](src/render.ts) | Pure argument validation, transcript envelope with result caps, UI presentation |
| — | No runtime invariant companion is published; this stateless adapter contributes one tool and one prompt section, while provider lifecycle stays owned by the audio seam it composes. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the model-facing surface to the seam and the provider.

- [dsh-audio](../audio/README.md) — the seam this tool queries.
- [dsh-audio-http](../audio-http/README.md) — the provider that answers transcriptions.
- [audio group map](../README.md) — the three-package family and its related documentation.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One system-prompt section (first-party order 2455) positions the transcription tool and its optionality with the following text:

##### Verbatim guidance

```markdown
Use transcribe_audio to convert an audio file (MP3, WAV, M4A, AAC, OGG, Opus, FLAC, or WebM) in the workspace into text. It is unavailable until an audio provider is configured — then continue without transcription, for example by suggesting the user configure one.
```

#### Token effect

Fixed guidance cost on every request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged; activation or disposal may invalidate reuse from this section.

### Tool schema

#### What the model sees

The model sees the generated [`transcribe_audio` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-audio).

#### Token effect

Fixed schema cost on every request while enabled; the `timeoutMs` budget is never sent to the model.

#### KV Cache effect

Prefix-stable while the visible tool definition and order are unchanged; registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

An ok result renders a `<path>`/`<type>transcript</type>` envelope with optional `<meta>` metadata and the transcript inside `<content>`, bounded by `maxResultChars`. When no provider is mounted, the result is the actionable unavailable message instead of an error. A truncation notice is included inside the character cap.

#### Token effect

The transcript is capped by `maxResultChars` regardless of the provider's answer length.

#### KV Cache effect

Tool results append after the cached request prefix and do not directly invalidate it.

### UI presentation

#### What the model sees

Nothing. The client renders a generic card — `{ card: 'generic', kind: 'other', title }` — titled `Transcribe: <file name>`; there is no rendered target, so no locations are attached.

#### Token effect

Zero direct token effect because rendering is client-side only.

#### KV Cache effect

None; UI presentation is outside the model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Provider-gated availability** — with no audio provider mounted the tool always returns the unavailable message; it never transcribes anything itself, so a deployment must mount `dsh-audio-http` (or another provider) for real transcripts.
- **Workspace files only** — the tool reads through `ctx.fs`, so audio must exist as a workspace file; it does not accept raw bytes or remote URLs from the model.
- **One file per call** — a batch of audio files is several calls; there is no multi-file parameter.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
