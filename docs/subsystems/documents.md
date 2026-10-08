# Document creation

English | [中文](documents.zh.md)

The document-creation seam — a [capability seam](../glossary.md#capability-seam) exposing Office file creation on one `ctx.documents` service, split across packages: Service Definition ([dsh-documents](../../packages/document/documents), `ctx.documents` + the provider registry), Service Provider ([dsh-office-create](../../packages/document/office-create), the LibreOffice-kit-backed engine that renders neutral content blocks into DOCX/XLSX/PPTX bytes), and Consumer ([dsh-tool-document](../../packages/document/tool-document), the model-facing `create_document` tool). Document creation is **one optional capability**, not part of the agent-loop spine. A provider swap does not change how callers or the model use the seam; with no provider registered, every creation throws `DocumentsError` `DOCUMENTS_UNAVAILABLE` and the tool answers with an actionable unavailable message. DSH never selects a document engine — engines, intermediate formats, and layout policy are the provider's private concern.

Source: [`packages/document/documents/src/types.ts`](../../packages/document/documents/src/types.ts)

## Operations and created documents

One operation shares the seam: `create` receives a `DocumentCreateRequest` — a required `format` (`docx`, `xlsx`, or `pptx`), a `title`, and ordered `blocks` — and returns a `DocumentResult`, the raw document `data` bytes with the `mediaType` they decode as. Blocks are the seam's neutral, template-agnostic vocabulary: `heading` (1-based `level`, default 1), `text`, `bullets`, `table` (a rectangular grid whose first row is the header), and `chartPlaceholder` (a labeled reservation, never real chart data). The seam sets no timeout or byte cap; those budgets belong to the consumer, and the engine timeout belongs to the provider. Consumers durably commit the created bytes into the Session workspace through the filesystem service before presenting them as deliverables.

Providers register under an opaque identity string reserved atomically at registration; `DocumentsError` extends `HarnessError` with stable codes `DOCUMENTS_INVALID_PROVIDER`, `DOCUMENTS_CONFLICT`, `DOCUMENTS_UNAVAILABLE`, `DOCUMENTS_DISPOSED`, `DOCUMENTS_INVALID_REQUEST`, and `DOCUMENTS_PROVIDER_FAILED`, which callers route on instead of parsing `message`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
