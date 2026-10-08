/**
 * Pure record types of the session git-tracking tools: the one home of the
 * `TrackedWorktree` and `TrackedPullRequest` records, free of this package's
 * host-side value imports (dsh-tools, zod). Two namespace projections serve
 * it — `./types` for host consumers and the package root re-export — with
 * zero content duplication.
 *
 * @module @deepseek-ai/dsh-tool-git-track/types
 */

/**
 * One git worktree a session records as its own — the unit of a
 * `worktree_track` record. Deliberately minimal: the worktree path plus the
 * branch facts the model knows when it records. No id — records are keyed by
 * `path`, and re-recording a path replaces its earlier entry.
 */
export interface TrackedWorktree {
  /** Absolute path of the worktree directory, as the model supplied it. */
  path: string
  /** Branch checked out in the worktree, when known. */
  branch?: string
  /** Ref the worktree branched from, when known. */
  base?: string
}

/**
 * One pull request a session records as its own — the unit of a
 * `pull_request_track` record. The canonical URL is the key; re-recording a
 * URL replaces its earlier entry, so a retitled pull request updates in
 * place. The record is forge-agnostic: no platform field beyond what the URL
 * already identifies.
 */
export interface TrackedPullRequest {
  /** Canonical pull-request URL. */
  url: string
  /** Hosting-platform pull-request number, when known. */
  number?: number
  /** Pull-request title, when known. */
  title?: string
  /** Head branch of the pull request, when known. */
  branch?: string
}
