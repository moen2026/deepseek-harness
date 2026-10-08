# 知识库

[English](knowledge.md) | 中文

知识库 seam —— 在单一 `ctx.knowledge` 服务上暴露一个共享、持久的文档语料[能力 seam](../glossary.zh.md#capability-seam)，按包拆分：Service Definition（[dsh-knowledge](../../packages/knowledge/knowledge)，`ctx.knowledge` + 提供方注册表）、Service Provider（[dsh-knowledge-sqlite](../../packages/knowledge/knowledge-sqlite)，`node:sqlite` 上的零依赖 FTS5/BM25 存储）与 Consumer（[dsh-tool-knowledge](../../packages/knowledge/tool-knowledge)，面向模型的 `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list` 工具）。知识库是**一个可选能力**，不是 agent-loop 主干的一部分。更换提供方不会改变调用方或模型使用该 seam 的方式；未注册提供方时，每条路由抛出 `KnowledgeError` `KNOWLEDGE_UNAVAILABLE`，工具以可操作的不可用应答回复。存储布局、分块与排序是提供方的私有事务 —— 该 seam 不暴露嵌入或协议逃生舱，DSH 也绝不选择嵌入提供方。

Source: [`packages/knowledge/knowledge/src/types.ts`](../../packages/knowledge/knowledge/src/types.ts)

## 文档与命中

一套读取词汇共享该 seam：`KnowledgeRecord` 携带提供方分配的 `id`、人类标题 `title`、正文 `text`、分类 `tags`、可选的 `source` 出处与提供方标注的 `createdAt`；`KnowledgeHit` 增加提供方定义的相关度 `score` 与首个命中周围的 `snippet` 摘录。`ingest` 接收必填的 `title` 与 `text` 加可选的 `tags` 与 `source`，返回分配的 id。文档一经 ingest 即不可变；修订即删除后重新摄取。search 与 list 按标签过滤，请求的 `limit` 限定页大小 —— 该 seam 自身不施加超时或上界，这些边界由消费方拥有。

## 相对 memory 与 repo wiki 的定位

知识库是跨会话与用户共享的、带标题的策展文档语料，面向段落检索 —— 既不是短记录、每用户的 `ctx.memory` seam，也不是对仓库自身源码生成、只读的 `ctx.repoWiki`。三个检索 seam 并存：memory 回答"这个用户偏好什么"，repo wiki 回答"这个代码库如何被文档化"，知识库回答"这里记录与决定了什么"。

## 存储与排序

`dsh-knowledge-sqlite` 维护一个受守卫的派生存储：规范化的 `knowledge_records` 表加覆盖标题与正文的 FTS5 `knowledge_docs` 索引。打开守卫写入 application id 并拒绝外来数据库；不兼容的派生 schema 就地重置。search 以 BM25 排序，先预过滤为有界候选池，在 JavaScript 中应用标签过滤，并返回 `snippet()` 摘录；所有工作经由单一连接串行执行。调用方文本永远是惰性 FTS5 数据，因此用户输入中不成对的引号无法破坏匹配表达式。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledge--knowledgeservice"></a>

### `ctx.knowledge` — `KnowledgeService`

The `ctx.knowledge` surface: a single-provider reservation registry plus the four routed operations (`ingest`, `search`, `remove`, `list`). The seam exposes no chunking, embedding, or protocol escape hatch — storage layout and any vector retrieval are the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: KnowledgeProvider): () => void

/**
 * Route one ingest to the registered provider.
 * @param draft - the ingest payload.
 * @param signal - cancellation forwarded to the provider.
 * @returns the provider-assigned document identity.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
 */
ingest(draft: KnowledgeDraft, signal?: AbortSignal): Promise<string>

/**
 * Route one search to the registered provider.
 * @param request - the normalized query.
 * @param signal - cancellation forwarded to the provider.
 * @returns a ranked, total result of hits with snippets.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
 */
search(request: KnowledgeSearchRequest, signal?: AbortSignal): Promise<KnowledgeSearchResult>

/**
 * Route one deletion to the registered provider.
 * @param id - the document identity to remove.
 * @param signal - cancellation forwarded to the provider.
 * @returns `true` when a document was removed, `false` when none matched.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
 */
remove(id: string, signal?: AbortSignal): Promise<boolean>

/**
 * Route one listing to the registered provider.
 * @param request - the listing filter; all fields optional.
 * @param signal - cancellation forwarded to the provider.
 * @returns a total page of documents.
 * @throws {@link KnowledgeError} with `KNOWLEDGE_UNAVAILABLE` when no provider is registered.
 */
list(request?: KnowledgeListRequest, signal?: AbortSignal): Promise<KnowledgePage>
```

Source: [`packages/knowledge/knowledge/src/types.ts`](../../packages/knowledge/knowledge/src/types.ts)

<a id="ctxknowledgebrowser--knowledgebrowserservice"></a>

### `ctx.knowledgeBrowser` — `KnowledgeBrowserService`

`ctx.knowledgeBrowser`. A read-and-remove face: ingest and search stay model-side operations, so the browser cannot write corpus content.

```ts cordis-catalog
/**
 * Probe whether a provider holds the seam.
 * @returns the availability answer; never rejects for an unheld seam.
 */
@Remote('status') status(): Promise<KnowledgeBrowserStatus>

/**
 * List stored documents by recency.
 * @param request - the listing filter; all fields optional.
 * @param signal - cancellation forwarded to the provider.
 * @returns a total page of documents.
 */
@Remote('list') async list(request?: KnowledgeListRequest, signal?: AbortSignal): Promise<KnowledgePage>

/**
 * Remove one document.
 * @param id - the document identity to remove.
 * @param signal - cancellation forwarded to the provider.
 * @returns `true` when a document was removed, `false` when none matched.
 */
@Remote('remove') async remove(id: string, signal?: AbortSignal): Promise<boolean>
```

Source: [`packages/knowledge/knowledge/src/browser.ts`](../../packages/knowledge/knowledge/src/browser.ts)
<!-- END GENERATED cordis-surface -->
