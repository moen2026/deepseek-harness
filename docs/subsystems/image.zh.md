# 图像生成

[English](image.md) | 中文

image seam——在单一 `ctx.image` 服务上暴露文生图能力的[能力 seam](../glossary.zh.md#capability-seam)，按包拆分：Service Definition（[dsh-image](../../packages/image/image)，`ctx.image` + 提供方注册表）、Service Provider（[dsh-image-http](../../packages/image/image-http)，OpenAI 兼容的 `/images/generations` HTTP 客户端；或 [dsh-image-wuyinkeji](../../packages/image/image-wuyinkeji)，轮询速创 GPT-Image-2.5 端点直至结算并下载已结算图像的异步任务客户端；两者之一持有 seam，端点、模型与凭据由部署持有）、Consumer（[dsh-tool-image](../../packages/image/tool-image)，面向模型的 `generate_image` 工具 schema）。图像生成是**一项可选能力**，不属于 agent-loop 主干。更换提供方不会改变调用方或模型使用 seam 的方式；未注册提供方时，每次生成都会抛出 `ImageError` `IMAGE_UNAVAILABLE`，工具以可操作的不可用应答回应。DSH 从不选择生成模型——端点及其模型完全归提供方持有。

Source: [`packages/image/image/src/types.ts`](../../packages/image/image/src/types.ts)

## 操作与生成图像

seam 只暴露一个操作：`generate` 接收 `ImageGenerateRequest`——必填的文本 `prompt`、可选的 `size` 与 `n` 精修、以及可选的 `referenceImages`（引导生成的公网可达参考图 URL）——返回 `ImageResult`，即原始图像 `data` 字节、其可解码的 `mediaType`，以及可选的提供方报告 `revisedPrompt`。seam 不设定超时或大小上限；这些预算属于 consumer，端点超时属于提供方。consumer 在任何会话内容引用生成字节之前，先经 attachment 服务持久提交。

提供方以注册时原子保留的不透明身份字符串注册；`ImageError` 扩展 `HarnessError`，携带稳定代码 `IMAGE_INVALID_PROVIDER`、`IMAGE_CONFLICT`、`IMAGE_UNAVAILABLE`、`IMAGE_DISPOSED`、`IMAGE_INVALID_REQUEST` 与 `IMAGE_PROVIDER_FAILED`，调用方依据代码路由而不是解析 `message`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctximage--imageservice"></a>

### `ctx.image` — `ImageService`

The `ctx.image` surface: a single-provider reservation registry plus the routed `generate` operation. The seam exposes no protocol escape hatch — endpoint shape, model, and credentials are the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: ImageProvider): () => void

/**
 * Route one generation to the registered provider.
 * @param request - the generation request.
 * @param signal - cancellation forwarded to the provider.
 * @returns the generated image.
 * @throws {@link ImageError} with `IMAGE_UNAVAILABLE` when no provider is registered.
 */
generate(request: ImageGenerateRequest, signal?: AbortSignal): Promise<ImageResult>
```

Source: [`packages/image/image/src/types.ts`](../../packages/image/image/src/types.ts)
<!-- END GENERATED cordis-surface -->
