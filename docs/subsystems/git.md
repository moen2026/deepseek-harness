# Git tracking

English | [中文](git.zh.md)

The durable git-artifact vocabulary owned by [`@deepseek-ai/dsh-tool-git-track`](../../packages/git/tool-git-track/README.md). The model-facing tools record one worktree or pull request per call into the package's storage domain. Tool behavior is on the [package README](../../packages/git/tool-git-track/README.md).

Source: [`packages/git/tool-git-track/src/types.ts`](../../packages/git/tool-git-track/src/types.ts)

## `TrackedWorktree` — one recorded worktree

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

## `TrackedPullRequest` — one recorded pull request

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

## Durable storage

Records live in the `session_git_track` storage domain, one table per record domain (`worktrees`, `pull_requests`). Each record's key is the owning session id, the key separator, and the record identity (`path` or `url`), so sessions never see each other's records; a re-record replaces the stored record in place and keeps first-record order, and removal is not modeled. The table schemas revalidate every stored record at the durable read boundary when the domain opens.
