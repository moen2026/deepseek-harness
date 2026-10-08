# 长期记忆

[English](memory.md) | 中文

memory seam 是一个[能力 seam](../glossary.zh.md#capability-seam)：它在单一 `ctx.memory` 服务上公开可持久的长期记忆，并拆分到多个包：Service Definition（[dsh-memory](../../packages/memory/memory)，`ctx.memory` + 提供方注册表）、Service Provider（[dsh-memory-sqlite](../../packages/memory/memory-sqlite)，本地 SQLite FTS5 存储，词法召回为主、可选语义排序融合）与 Consumers（[dsh-tool-memory](../../packages/memory/tool-memory)，即 `memory_write`／`memory_search`／`memory_forget` 工具 schema；[dsh-memory-reflection](../../packages/memory/memory-reflection)，轮次结束抽取并写回 seam；以及 [dsh-memory-profile](../../packages/memory/memory-profile)，将已保存的 `style` 记录作为运行时上下文区段注入）。记忆是**一项可选能力**，不属于 agent loop（智能体循环）主干。更换提供方不会改变调用方或模型使用 seam 的方式；在未注册提供方时，每个操作都抛出 `MemoryError` `MEMORY_UNAVAILABLE`，工具则以可操作的"不可用"消息应答。DSH 绝不替使用者选定模型或嵌入提供方——语义排序仅在部署自带嵌入端点时激活。

源文件：[`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

## 操作与记录

四个操作共享同一 seam：`remember` 持久一份写入负载并返回提供方分配的 id，`recall` 应答一次带排序的查询，`forget` 按 id 删除一条记录（无此记录时返回 `false`），`list` 按最近写入顺序返回已存记录。写入负载仅要求 `text`；`tags`、`scope`、类型化 `namespace`（`preference`、`fact` 或 `style`）、0 到 1 之间的 `confidence` 与 `ttlMs` 过期时间均为可选精化项。已存记录额外带有分配的 `id`、由提供方盖章的 ISO 8601 `createdAt`，以及提供 `ttlMs` 时计算出的 `expiresAt`。召回与列举接受可选的 `tags`／`scope`／`namespace` 过滤器、可选 `minConfidence` 阈值与可选 `limit`（省略时由提供方套用自身的默认值与上限），且两者都绝不返回过期记录；两类结果相对请求都是全量的（无游标）。存储布局、排序与任何向量检索均属提供方的私有实现；seam 不暴露任何嵌入或协议逃逸口。

提供方以一个对调用方不透明、在注册时被原子占位的身份字符串完成注册；`MemoryError` 在 `HarnessError` 之上扩展出稳定错误码 `MEMORY_INVALID_PROVIDER`、`MEMORY_CONFLICT`、`MEMORY_UNAVAILABLE`、`MEMORY_DISPOSED` 与 `MEMORY_INVALID_REQUEST`，调用方据此分流，而非解析 `message`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryservice"></a>

### `ctx.memory` — `MemoryService`

The `ctx.memory` surface: a single-provider reservation registry plus the four routed operations (`remember`, `recall`, `forget`, `list`). The seam exposes no embedding or protocol escape hatch — storage layout and any vector retrieval are the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: MemoryProvider): () => void

/**
 * Route one write to the registered provider.
 * @param draft - the write payload.
 * @param signal - cancellation forwarded to the provider.
 * @returns the provider-assigned record identity.
 * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
 */
remember(draft: MemoryDraft, signal?: AbortSignal): Promise<string>

/**
 * Route one recall to the registered provider.
 * @param request - the normalized query.
 * @param signal - cancellation forwarded to the provider.
 * @returns a ranked, total result of hits.
 * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
 */
recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>

/**
 * Route one deletion to the registered provider.
 * @param id - the record identity to forget.
 * @param signal - cancellation forwarded to the provider.
 * @returns `true` when a record was removed, `false` when none matched.
 * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
 */
forget(id: string, signal?: AbortSignal): Promise<boolean>

/**
 * Route one listing to the registered provider.
 * @param request - the listing filter; all fields optional.
 * @param signal - cancellation forwarded to the provider.
 * @returns a total page of records.
 * @throws {@link MemoryError} with `MEMORY_UNAVAILABLE` when no provider is registered.
 */
list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryPage>
```

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

<a id="ctxmemorybrowser--memorybrowserservice"></a>

### `ctx.memoryBrowser` — `MemoryBrowserService`

`ctx.memoryBrowser`. A read-and-remove face: remembering and recall stay model-side operations, so the browser cannot write memory content.

```ts cordis-catalog
/**
 * Probe whether a provider holds the seam.
 * @returns the availability answer; never rejects for an unheld seam.
 */
@Remote('status') status(): Promise<MemoryBrowserStatus>

/**
 * List stored memories by recency.
 * @param request - the listing filter; all fields optional.
 * @param signal - cancellation forwarded to the provider.
 * @returns a total page of memories.
 */
@Remote('list') async list(request?: MemoryListRequest, signal?: AbortSignal): Promise<MemoryPage>

/**
 * Remove one memory.
 * @param id - the memory identity to remove.
 * @param signal - cancellation forwarded to the provider.
 * @returns `true` when a memory was removed, `false` when none matched.
 */
@Remote('forget') async forget(id: string, signal?: AbortSignal): Promise<boolean>
```

Source: [`packages/memory/memory/src/browser.ts`](../../packages/memory/memory/src/browser.ts)
<!-- END GENERATED cordis-surface -->
