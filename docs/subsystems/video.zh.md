# 视频生成

[English](video.md) | 中文

video seam——在单一 `ctx.video` 服务上暴露文生视频能力的[能力 seam](../glossary.zh.md#capability-seam)，按包拆分：Service Definition（[dsh-video](../../packages/video/video)，`ctx.video` + 提供方注册表）、Service Provider（[dsh-video-wuyinkeji](../../packages/video/video-wuyinkeji) 与 [dsh-video-volc](../../packages/video/video-volc)——前者提交到配置 `model` 选择的速创视频任务端点（Google-Omni、MiniMax H3 或 Grok Imagine），后者以 chat-completions 形态向火山引擎 Ark 推理面提交任务并可把参考图登记为私域 Seedance 素材；一个提供方独占 seam，其端点、模型与凭据由部署持有）、Consumer（[dsh-tool-video](../../packages/video/tool-video)，面向模型的 `generate_video` 工具 schema）。视频生成是**一项可选能力**，不属于 agent-loop 主干。更换提供方不会改变调用方或模型使用 seam 的方式；未注册提供方时，每次生成都会抛出 `VideoError` `VIDEO_UNAVAILABLE`，工具以可操作的不可用应答回应。DSH 在运行时从不选择生成模型——由提供方的 `model` 配置决定。

Source: [`packages/video/video/src/types.ts`](../../packages/video/video/src/types.ts)

## 操作与生成视频

seam 只暴露一个操作：`generate` 接收 `VideoGenerateRequest`——必填的文本 `prompt`、可选的 `size`、`duration` 与 `aspectRatio` 精修，以及 `firstFrame`、`lastFrame`、`referenceImage`、`referenceVideo` 与 `referenceAudio` 参考 URL（公网可达；不接受某项精修的提供方忽略它）——返回 `VideoResult`，即原始视频 `data` 字节与其可解码的 `mediaType`。seam 不设定超时或大小上限；这些预算属于 consumer，端点超时属于提供方。consumer 在任何会话内容引用生成字节之前，先经 attachment 服务持久提交。

提供方以注册时原子保留的不透明身份字符串注册；`VideoError` 扩展 `HarnessError`，携带稳定代码 `VIDEO_INVALID_PROVIDER`、`VIDEO_CONFLICT`、`VIDEO_UNAVAILABLE`、`VIDEO_DISPOSED`、`VIDEO_INVALID_REQUEST` 与 `VIDEO_PROVIDER_FAILED`，调用方依据代码路由而不是解析 `message`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxvideo--videoservice"></a>

### `ctx.video` — `VideoService`

The `ctx.video` surface: a single-provider reservation registry plus the routed `generate` operation. The seam exposes no protocol escape hatch — endpoint shape, model, and credentials are the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: VideoProvider): () => void

/**
 * Route one generation to the registered provider.
 * @param request - the generation request.
 * @param signal - cancellation forwarded to the provider.
 * @returns the generated video.
 * @throws {@link VideoError} with `VIDEO_UNAVAILABLE` when no provider is registered.
 */
generate(request: VideoGenerateRequest, signal?: AbortSignal): Promise<VideoResult>
```

Source: [`packages/video/video/src/types.ts`](../../packages/video/video/src/types.ts)
<!-- END GENERATED cordis-surface -->
