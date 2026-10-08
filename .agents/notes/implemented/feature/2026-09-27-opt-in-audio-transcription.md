# Agent Note: Opt-in audio transcription seam

Status: implemented

English | [中文](2026-09-27-opt-in-audio-transcription.zh.md)

## Problem

Agents receive meeting notes, voice memos, and interview recordings as workspace files, but the harness had no first-party way to turn audio into text: the only speech capability was the experimental `voice-input` recognizers, which serve live dictation into the chat box and are not a model tool. A model that needed the content of an `.m4a` file could only report that it cannot listen. Deployments with a transcription endpoint had no way to hand that capability to the model, and the roadmap's voice-input work (D10) needs a transcription seam to build on.

## Decision

Audio transcription ships as the standard three-layer family: the [dsh-audio](../../../../packages/audio/audio) seam (`ctx.audio`: a single-provider reservation plus one `transcribe` route), the [dsh-audio-http](../../../../packages/audio/audio-http) provider (an OpenAI-compatible `/audio/transcriptions` client that multipart-uploads raw bytes and maps the JSON answer onto the seam's transcript), and the [dsh-tool-audio](../../../../packages/audio/tool-audio) consumer (the `transcribe_audio` tool: resolve a workspace file through `ctx.fs`, read it under a 25 MiB default byte budget, and return the transcript bounded by `maxResultChars`). The `full` preset mounts an isolated `audio` group in which the seam and the tool always load and the provider stays disabled until a deployment names an endpoint through `DSH_AUDIO_URL`; with no provider the tool returns an actionable unavailable answer instead of breaking the session.

The neutrality statement matches memory's embedding path: the endpoint URL, model name, and bearer-token *variable name* are deployment configuration (`DSH_AUDIO_URL`, `DSH_AUDIO_MODEL`, `DSH_AUDIO_AUTH_ENV`); the credential is read from the environment at call time and never written to YAML, logs, or the request body. DSH never selects a transcription model. Every endpoint-side failure is a typed `AudioError` `AUDIO_PROVIDER_FAILED`; nothing degrades to a fabricated transcript.

This is the infrastructure seam for the roadmap's voice work: D10's `voice` group will call `ctx.audio.transcribe` for STT rather than growing its own HTTP client.

## Alternatives considered

**A voice-input recognizer as the transcription path.** The `voice-input` package serves interactive dictation with revision-guarded draft insertion — a different contract from a model asking for the text of an existing file. Forcing both through one surface would couple chat-box UX to tool schemas.

**TTS in the same seam.** Speech synthesis is a different capability with different configuration (voices, formats); folding it into `transcribe` would grow the seam's vocabulary for no current consumer. The seam is one route and states the boundary in its limitations.

**Reading audio through `ctx.llm` multimodal input.** The primary provider path is text-only; making transcription conditional on a multimodal-capable route would tie an infrastructure capability to model selection. A deployment-owned HTTP endpoint keeps the capability independent of the agent's model.

## Consequences

- A deployment that sets no new environment variables sees no behavior change: `transcribe_audio` mounts and answers "unavailable" in a form the model can report and suggest from.
- The tool emits `fs/observed` events for absent targets and bounds both the read (bytes) and the answer (characters), so a large recording cannot flood the conversation.
- `docs/subsystems/audio.md` gains a generated Cordis API section; `transcribe_audio` is catalogued in `docs/tool-catalog.md` with its system-prompt section at first-party order 2455.
