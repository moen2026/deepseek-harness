# 文档生成

[English](documents.md) | 中文

document-creation seam——在单一 `ctx.documents` 服务上暴露 Office 文件生成能力的[能力 seam](../glossary.zh.md#capability-seam)，按包拆分：Service Definition（[dsh-documents](../../packages/document/documents)，`ctx.documents` + 提供方注册表）、Service Provider（[dsh-office-create](../../packages/document/office-create)，LibreOffice kit 驱动的引擎，把中立内容块渲染成 DOCX/XLSX/PPTX 字节）、Consumer（[dsh-tool-document](../../packages/document/tool-document)，面向模型的 `create_document` 工具）。文档生成是**一项可选能力**，不属于 agent-loop 主干。更换提供方不会改变调用方或模型使用 seam 的方式；未注册提供方时，每次生成都会抛出 `DocumentsError` `DOCUMENTS_UNAVAILABLE`，工具以可操作的不可用应答回应。DSH 从不选择文档引擎——引擎、中间格式与排版策略完全归提供方私有。

Source: [`packages/document/documents/src/types.ts`](../../packages/document/documents/src/types.ts)

## 操作与生成文档

seam 只暴露一个操作：`create` 接收 `DocumentCreateRequest`——必填的 `format`（`docx`、`xlsx` 或 `pptx`）、`title` 与有序 `blocks`——返回 `DocumentResult`，即原始文档 `data` 字节、其可解码的 `mediaType`。block 是 seam 的中立、模板无关词汇表：`heading`（1 基 `level`，默认 1）、`text`、`bullets`、`table`（首行为表头的矩形网格）与 `chartPlaceholder`（带标签的占位，永远不会是真实图表数据）。seam 不设定超时或字节上限；这些预算属于 consumer，引擎超时属于提供方。consumer 在把生成文档呈现为交付物之前，先经 filesystem 服务把字节持久写入 Session 工作区。

提供方以注册时原子保留的不透明身份字符串注册；`DocumentsError` 扩展 `HarnessError`，携带稳定代码 `DOCUMENTS_INVALID_PROVIDER`、`DOCUMENTS_CONFLICT`、`DOCUMENTS_UNAVAILABLE`、`DOCUMENTS_DISPOSED`、`DOCUMENTS_INVALID_REQUEST` 与 `DOCUMENTS_PROVIDER_FAILED`，调用方依据代码路由而不是解析 `message`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdocuments--documentsservice"></a>

### `ctx.documents` — `DocumentsService`

The `ctx.documents` surface: a single-provider reservation registry plus the routed `create` operation. The seam exposes no protocol escape hatch — engines and intermediate representations are the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: DocumentsProvider): () => void

/**
 * Route one creation to the registered provider.
 * @param request - the creation request.
 * @param signal - cancellation forwarded to the provider.
 * @returns the created document.
 * @throws {@link DocumentsError} with `DOCUMENTS_UNAVAILABLE` when no provider is registered.
 */
create(request: DocumentCreateRequest, signal?: AbortSignal): Promise<DocumentResult>
```

Source: [`packages/document/documents/src/types.ts`](../../packages/document/documents/src/types.ts)
<!-- END GENERATED cordis-surface -->
