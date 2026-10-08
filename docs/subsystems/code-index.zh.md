# 代码索引检索

[English](code-index.md) | 中文

code-index seam 是一个[能力 seam](../glossary.zh.md#capability-seam)：它在单一 `ctx.codeIndex` 服务上公开词法级代码库检索，并拆分到多个包：Service Definition（[dsh-code-index](../../packages/code-index/code-index)，`ctx.codeIndex` + 提供方注册表）、Service Provider（[dsh-code-index-sqlite](../../packages/code-index/code-index-sqlite)，基于本地 SQLite FTS5、融合本地哈希子词语义排序、索引受授权工作区文件的提供方）和 Consumer（[dsh-tool-code-index](../../packages/code-index/tool-code-index)，即 `search_codebase` 工具 schema）。代码索引是**一项可选能力**，不属于 agent loop（智能体循环）主干。更换提供方不会改变模型发起检索的方式；在未注册提供方时，`search` 抛出 `CodeIndexError` `CODE_INDEX_UNAVAILABLE`，工具则以可操作的"不可用"消息应答。

源文件：[`packages/code-index/code-index/src/types.ts`](../../packages/code-index/code-index/src/types.ts)

## 请求与结果

仅有一个操作 `search`，用于应答一次词法查询。`query` 必填且从不被默认填充；`glob`、`language` 与 `limit` 均为可选精化项，省略 `limit` 时由提供方套用自身的默认值与上限。一条命中是某个已索引文件中的一段有界行区间——工作区相对 `path`、从 1 开始的 `startLine`/`endLine`、可选 `language`、由提供方定义的相关性 `score`（越大越靠前），以及已在提供方侧定界的展示 `snippet`。结果相对请求是全量的（无游标）。语料布局、索引构建与排序均属提供方的私有实现；seam 不暴露任何索引构建或协议逃逸口。

提供方以一个对调用方不透明、在注册时被原子占位的身份字符串完成注册；`CodeIndexError` 在 `HarnessError` 之上扩展出稳定错误码 `CODE_INDEX_INVALID_PROVIDER`、`CODE_INDEX_CONFLICT`、`CODE_INDEX_UNAVAILABLE`、`CODE_INDEX_DISPOSED` 与 `CODE_INDEX_INVALID_REQUEST`，调用方据此分流，而非解析 `message`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcodeindex--codeindexservice"></a>

### `ctx.codeIndex` — `CodeIndexService`

The `ctx.codeIndex` surface: a single-provider reservation registry plus one read-only `search` that routes to the registered provider. The seam exposes exactly `search` and no index-building or protocol escape hatch — populating the corpus is the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: CodeIndexProvider): () => void

/**
 * Route one lexical search to the registered provider.
 * @param request - the normalized query.
 * @param signal - cancellation forwarded to the provider.
 * @returns a ranked, total page of hits.
 * @throws {@link CodeIndexError} with `CODE_INDEX_UNAVAILABLE` when no provider is registered.
 */
search(request: CodeSearchRequest, signal?: AbortSignal): Promise<CodeSearchPage>
```

Source: [`packages/code-index/code-index/src/types.ts`](../../packages/code-index/code-index/src/types.ts)
<!-- END GENERATED cordis-surface -->
