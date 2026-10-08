---
description: "The git group map: the model-facing worktree and pull-request tracking tools over the session log, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/git

English | [中文](README.zh.md)

## Summary

The git group records the git artifacts an agent session produces: the worktrees it creates and the pull requests it opens. It is one product package that provides the `worktree_track` and `pull_request_track` tools; each record belongs to the agent session that made it and persists across turns and reopened sessions in the package's durable storage domain. The group ships no UI of its own and never touches git itself — recording is bookkeeping only.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tool-git-track`](tool-git-track/README.md) | Lets the agent record the worktrees it creates and the pull requests it opens, per session | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Git tracking subsystem](../../docs/subsystems/git.md) — the `TrackedWorktree` and `TrackedPullRequest` record types and the storage layout.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-git-track) — the two tool schemas the model receives.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
