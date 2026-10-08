---
description: "git 组地图：面向模型的 worktree 与 PR 跟踪工具，供浏览该组的用户与维护者使用。"
kind: "package-group"
---

# packages/git

[English](README.md) | 中文

## Summary

git 组记录 agent 会话产出的 git 工件：它创建的 worktree 与它打开的 pull request。组内是一个产品包，提供 `worktree_track` 与 `pull_request_track` 两个工具；每条记录归属于做出它的 agent 会话，并在本包的持久存储域中跨轮次与重开会话持久化。本组不自带 UI，也绝不触碰 git 本身——记录仅是簿记。

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tool-git-track`](tool-git-track/README.zh.md) | 让 agent 按会话记录它创建的 worktree 与它打开的 pull request | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Git 跟踪子系统](../../docs/subsystems/git.zh.md) — `TrackedWorktree` 与 `TrackedPullRequest` 记录类型与存储布局。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-git-track) — 模型收到的两个工具 schema。

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
