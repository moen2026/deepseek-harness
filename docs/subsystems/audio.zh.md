# 语音转写

[English](audio.md) | 中文

音频接缝——把语音转文本暴露在一个 `ctx.audio` 服务上的[能力接缝](../glossary.zh.md#capability-seam)，按包拆分：Service Definition（[dsh-audio](../../packages/audio/audio)，`ctx.audio` + 提供者注册表）、Service Provider（[dsh-audio-http](../../packages/audio/audio-http)，端点、模型与凭据由部署持有的 OpenAI 兼容 `/audio/transcriptions` HTTP 客户端）、Consumer（[dsh-tool-audio](../../packages/audio/tool-audio)，面向模型的 `transcribe_audio` 工具模式）。语音转写是**一项可选能力**，不属于 agent-loop 主干。替换提供者不会改变调用者或模型使用接缝的方式；未注册提供者时，每次转写抛出 `AudioError` `AUDIO_UNAVAILABLE`，工具以可操作的不可用应答回应。DSH 从不选择转写模型——端点及其模型完全归提供者所有。

Source: [`packages/audio/audio/src/types.ts`](../../packages/audio/audio/src/types.ts)

## 操作与转写文本

一条操作共享接缝：`transcribe` 接收 `AudioTranscribeRequest`——必需的 `data` 字节载荷加上可选的 `fileName`、`mediaType`、`language`、`prompt` 修饰——并返回 `AudioTranscript`，即识别文本与可选的提供者报告的 `language`、`durationSec`。接缝不设超时、字节上限或格式过滤；这些预算归消费者持有，端点超时归提供者持有。

提供者以注册时原子保留的不透明身份字符串注册；`AudioError` 继承 `HarnessError` 并携带稳定错误码（`AUDIO_INVALID_PROVIDER`、`AUDIO_CONFLICT`、`AUDIO_UNAVAILABLE`、`AUDIO_DISPOSED`、`AUDIO_INVALID_REQUEST`、`AUDIO_PROVIDER_FAILED`），调用者按 `code` 路由而非解析 `message`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
