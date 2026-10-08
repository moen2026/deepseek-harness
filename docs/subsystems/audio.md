# Audio transcription

English | [中文](audio.zh.md)

The audio seam — a [capability seam](../glossary.md#capability-seam) exposing speech-to-text on one `ctx.audio` service, split across packages: Service Definition ([dsh-audio](../../packages/audio/audio), `ctx.audio` + the provider registry), Service Provider ([dsh-audio-http](../../packages/audio/audio-http), an OpenAI-compatible `/audio/transcriptions` HTTP client whose endpoint, model, and credential are deployment-owned), and Consumer ([dsh-tool-audio](../../packages/audio/tool-audio), the model-facing `transcribe_audio` tool schema). Audio transcription is **one optional capability**, not part of the agent-loop spine. A provider swap does not change how callers or the model use the seam; with no provider registered, every transcription throws `AudioError` `AUDIO_UNAVAILABLE` and the tool answers with an actionable unavailable message. DSH never selects a transcription model — the provider owns the endpoint and its model outright.

Source: [`packages/audio/audio/src/types.ts`](../../packages/audio/audio/src/types.ts)

## Operations and transcripts

One operation shares the seam: `transcribe` receives an `AudioTranscribeRequest` — a required `data` byte payload plus optional `fileName`, `mediaType`, `language`, and `prompt` refinements — and returns an `AudioTranscript`, the recognized `text` with optional provider-reported `language` and `durationSec`. The seam sets no timeout, byte ceiling, or format filter; those budgets belong to the consumer, and the endpoint timeout belongs to the provider.

Providers register under an opaque identity string reserved atomically at registration; `AudioError` extends `HarnessError` with stable codes `AUDIO_INVALID_PROVIDER`, `AUDIO_CONFLICT`, `AUDIO_UNAVAILABLE`, `AUDIO_DISPOSED`, `AUDIO_INVALID_REQUEST`, and `AUDIO_PROVIDER_FAILED`, which callers route on instead of parsing `message`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaudio--audioservice"></a>

### `ctx.audio` — `AudioService`

The `ctx.audio` surface: a single-provider reservation registry plus the routed `transcribe` operation. The seam exposes no protocol escape hatch — endpoint shape, model, and credentials are the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: AudioProvider): () => void

/**
 * Route one transcription to the registered provider.
 * @param request - the transcription request.
 * @param signal - cancellation forwarded to the provider.
 * @returns the transcript.
 * @throws {@link AudioError} with `AUDIO_UNAVAILABLE` when no provider is registered.
 */
transcribe(request: AudioTranscribeRequest, signal?: AbortSignal): Promise<AudioTranscript>
```

Source: [`packages/audio/audio/src/types.ts`](../../packages/audio/audio/src/types.ts)
<!-- END GENERATED cordis-surface -->
