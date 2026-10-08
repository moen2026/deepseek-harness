# 仓库 Wiki

[English](repo-wiki.md) | 中文

repository-wiki seam——在单一 `ctx.repoWiki` 服务上暴露生成 Markdown 文档页的[能力 seam](../glossary.zh.md#capability-seam)，按包拆分：Service Definition（[dsh-repo-wiki](../../packages/wiki/repo-wiki)，`ctx.repoWiki` + 提供方注册表）、Service Provider（[dsh-repo-wiki-generator](../../packages/wiki/repo-wiki-generator)，LLM 驱动的生成器，把工作区源文档渲染成 `.dsh/wiki/` 下的页面并跟踪每页的源指纹）、Consumer（[dsh-tool-repo-wiki](../../packages/wiki/tool-repo-wiki)，面向模型的 `read_wiki` 工具）。wiki 是**一项可选能力**，不属于 agent-loop 主干。更换提供方不会改变调用方或模型使用 seam 的方式；未注册提供方时，每次读取都会抛出 `RepoWikiError` `REPO_WIKI_UNAVAILABLE`，工具以可操作的不可用应答回应。存储布局与生成流水线完全归提供方私有——seam 严格只读。

Source: [`packages/wiki/repo-wiki/src/types.ts`](../../packages/wiki/repo-wiki/src/types.ts)

## 页面与过期

seam 只共享一个读取词汇表：`WikiPageSummary` 携带 wiki 相对 `path`、由页面首个标题派生的人类可读 `title`，以及 `stale` 标志；`WikiPage` 额外携带页面完整的 Markdown `content`；`WikiOutlineEntry` 额外携带按文档顺序排列的标题行；`WikiListing` 是 `listPages` 背后的有序页面列表。页面是普通 Markdown 文件，因此生成的 wiki 可以直接阅读、diff，并提交进 Git 供团队共享。

过期是元数据，永远不会触发自动重写：提供方把每页生成时的源指纹记录在页面 front matter 中，读取时对活动源重新计算指纹。源已变化的页面——或记录的源已消失的页面——以 `stale: true` 读回，而内容保持生成时的原样，因此 wiki 永远不会在读者背后悄悄变化。

提供方以注册时原子保留的不透明身份字符串注册；`RepoWikiError` 扩展 `HarnessError`，携带稳定代码 `REPO_WIKI_INVALID_PROVIDER`、`REPO_WIKI_CONFLICT`、`REPO_WIKI_UNAVAILABLE`、`REPO_WIKI_INVALID_PATH` 与 `REPO_WIKI_NOT_FOUND`，调用方依据代码路由而不是解析 `message`。页面路径在调用提供方之前先归一化：必须是非空的、位于 wiki 根内部的相对 `.md` 路径。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxrepowiki--repowikiservice"></a>

### `ctx.repoWiki` — `RepoWikiService`

The `ctx.repoWiki` surface: a single-provider reservation registry plus the read-only routes (`getPage`, `listPages`, `outline`) that forward to the registered provider. The seam exposes exactly the read routes — populating, regenerating, and storing pages is the provider's private concern.

```ts cordis-catalog
/**
 * Reserve the seam for one provider. Validate and conflict-check everything before
 * mutating: an invalid or conflicting registration publishes nothing, and its
 * disposer releases the reservation.
 * @param provider - the backend claiming the seam.
 * @returns a synchronous disposer releasing this provider's reservation.
 */
registerProvider(provider: RepoWikiProvider): () => void

/**
 * Route one page read to the registered provider.
 * @param path - the wiki-relative `.md` path.
 * @returns the page's identity and body.
 * @throws {@link RepoWikiError} with `REPO_WIKI_UNAVAILABLE` when no provider is registered.
 */
getPage(path: string): Promise<WikiPage>

/**
 * List every page through the registered provider.
 * @returns the page summaries ordered by path.
 * @throws {@link RepoWikiError} with `REPO_WIKI_UNAVAILABLE` when no provider is registered.
 */
listPages(): Promise<WikiListing>

/**
 * Return every page's heading structure through the registered provider.
 * @returns the outline entries ordered by path.
 * @throws {@link RepoWikiError} with `REPO_WIKI_UNAVAILABLE` when no provider is registered.
 */
outline(): Promise<readonly WikiOutlineEntry[]>
```

Source: [`packages/wiki/repo-wiki/src/types.ts`](../../packages/wiki/repo-wiki/src/types.ts)
<!-- END GENERATED cordis-surface -->