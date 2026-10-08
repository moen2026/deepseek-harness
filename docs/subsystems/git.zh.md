# Git 跟踪

[English](git.md) | 中文

[`@deepseek-ai/dsh-tool-git-track`](../../packages/git/tool-git-track/README.zh.md) 拥有的持久 git 工件词汇。面向模型的工具每次调用把一个 worktree 或 pull request 记录进本包的存储域。工具行为见[包 README](../../packages/git/tool-git-track/README.zh.md)。

Source: [`packages/git/tool-git-track/src/types.ts`](../../packages/git/tool-git-track/src/types.ts)

## `TrackedWorktree` — 一条记录的 worktree

```ts type-equiv
/**
 * One git worktree a session records as its own — the unit of a
 * `worktree_track` record. Deliberately minimal: the worktree path plus the
 * branch facts the model knows when it records. No id — records are keyed by
 * `path`, and re-recording a path replaces its earlier entry.
 */
interface TrackedWorktree {
  /** Absolute path of the worktree directory, as the model supplied it. */
  path: string
  /** Branch checked out in the worktree, when known. */
  branch?: string
  /** Ref the worktree branched from, when known. */
  base?: string
}
```

## `TrackedPullRequest` — 一条记录的 pull request

```ts type-equiv
/**
 * One pull request a session records as its own — the unit of a
 * `pull_request_track` record. The canonical URL is the key; re-recording a
 * URL replaces its earlier entry, so a retitled pull request updates in
 * place. The record is forge-agnostic: no platform field beyond what the URL
 * already identifies.
 */
interface TrackedPullRequest {
  /** Canonical pull-request URL. */
  url: string
  /** Hosting-platform pull-request number, when known. */
  number?: number
  /** Pull-request title, when known. */
  title?: string
  /** Head branch of the pull request, when known. */
  branch?: string
}
```

## 持久存储

记录存放在 `session_git_track` 存储域中，每类记录一张表（`worktrees`、`pull_requests`）。每条记录的键是属主会话 id、键分隔符与记录身份（`path` 或 `url`），因此会话之间互不可见；再次记录会原地替换存储的记录并保持首次记录顺序，且不建模删除。打开域时，表 schema 会在持久读边界重新校验每条存储记录。
