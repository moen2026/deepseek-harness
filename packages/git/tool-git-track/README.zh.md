---
description: "面向模型的 worktree_track 与 pull_request_track 工具：面向 DeepSeek Harness agent 会话的按会话 git 工件记录、持久存储域中的自然键 upsert 与逐调用列表结果，供选择、配置或调试这些工具的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-git-track

[English](README.md) | 中文

## Summary

`dsh-tool-git-track` 让 agent 记录它的工作产出的 git 工件：它创建的 worktree 与它打开的 pull request。每次 `worktree_track` 或 `pull_request_track` 调用把一条记录 upsert 进本包的持久存储域，记录跨轮次、上下文压缩与重开会话持久——因此即使早期对话已被压缩，agent 仍能说明哪个 checkout、哪个 pull request 属于本会话。记录仅是簿记：工具绝不运行 git，也绝不联系托管平台。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

当 agent 会创建 git worktree（并行任务 checkout、评审分支）或打开 pull request，且这些事实必须附着在产出它们的会话上时，使用本包。挂载插件是唯一的设置；agent 在事实发生时逐条记录。

### When to choose it

当一个 agent 会话拥有自己的工件、且自报记录已足够时选择它。需要经过验证的 git 或托管平台状态时避免使用：记录断言的是模型所说的内容，不是仓库或平台确认的内容。工具必须有 agent 会话才能存在；从不运行 agent 的纯自动化面无法使用它们。

### Minimal configuration

插件不接受配置。按普通插件行组合：

```yaml
- name: '@deepseek-ai/dsh-tool-git-track'
```

### What each call does

`worktree_track` 记录一个 worktree：绝对 `path`，加可选 `branch` 与 `base`。`pull_request_track` 记录一个 pull request：规范 `url`，加可选 `number`、`title` 与 `branch`。对同一路径或 URL 的再次记录会原地替换较早的记录，因此分支变更或标题更新不会改变列表顺序。成功调用返回其领域的当前记录列表——`Now tracking 2 worktree(s); latest: <path>.`——且被日志记录的工具调用与其结果就是该记录在会话日志中的痕迹。必需值为空、worktree 路径为相对路径、或 pull request 编号不是正整数时，调用会可见地失败。

### Single owner

记录归属于创建它们的那个 agent 会话——subagent 与其他 agent 各自保留自己的记录，且无法跨 agent 共享。来自 agent 会话之外的调用会被拒绝，因此 agent 能得知记录失败，而不是静默写入无处。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现内部 — 点击展开</summary>

本节解释工具背后的设计决策并指向实现它们的代码；可观察行为已完全覆盖在 [Use this package](#use-this-package) 中。

### Design philosophy

工具建立在三项承诺之上：

- **持久存储域记录。** 每次调用把一条记录 upsert 进 `session_git_track` 存储域，因此持久性与重开重建来自共享的 `storageDomain` 设施，而非本包自己的服务。
- **按自然键 upsert。** worktree 的 `path` 与 pull request 的 `url` 是会话内的键；再次记录会原地替换存储的记录并保持首次记录顺序，因此再次记录是唯一的更新方式，且不建模删除。
- **簿记，不是执行。** 工具只校验记录形态，绝不探测文件系统或网络；记录的事实是模型的陈述，通过 schema 层拒绝未知键与 `execute` 层拒绝空白或非规范值，保持与其认知一致。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`session_git_track` 域声明与两个工具注册 |
| [`src/types.ts`](src/types.ts) | `TrackedWorktree` 与 `TrackedPullRequest` 记录类型的唯一归属地 |

### Export shape

插件是函数/命名空间插件：导出 `name` / `inject` / `apply`，没有默认导出。多余的 `export default` 会让 Loader 的 `unwrapExports` 折叠模块并丢弃 `inject`（见 [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

### 存储域

本包声明 `session_git_track` 域（每类记录一张表），并在插件加载时打开它，因此损坏的介质或域名冲突在启动时即失败。每条记录的键是属主会话 id、键分隔符与记录身份（`path` 或 `url`）；打开域时表 schema 会在持久读边界重新校验每条存储记录。设施语义见 [`@deepseek-ai/dsh-storage-domain`](../../storage/storage-domain/README.zh.md)，声明见 [src/index.ts](src/index.ts)。

### Call mechanics

每次调用先按 schema 校验记录、拒绝不连贯输入，再把它 upsert 进调用会话的表，并返回该会话的当前列表。校验与 upsert 的确切步骤见 [src/index.ts](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

当包级契约不够时阅读这些页面。它们从 git 子系统走向生成的目录。

- [Git 跟踪子系统](../../../docs/subsystems/git.zh.md) — `TrackedWorktree` 与 `TrackedPullRequest` 记录类型与存储布局。
- [git 组地图](../README.zh.md) — 相邻组页面及其包表。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-git-track) — 模型收到的两个工具 schema。

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

模型看到[生成的 `worktree_track` 与 `pull_request_track` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-git-track)：`worktree_track` 接收必需的绝对路径字符串 `path`，加可选字符串 `branch` 与 `base`；`pull_request_track` 接收必需的 `url` 字符串，加可选 `number`（数值）、`title` 与 `branch`。描述说明记录仅是簿记，且对同一键的再次记录会替换较早记录。

#### Token effect

工具可见的每个请求有固定的 schema 成本；因为本包没有配置，描述与 schema 跨部署保持稳定。

#### KV Cache effect

定义与可见性不变时前缀稳定。插件生命周期或 scope 限制可能使这些 schema 的复用失效。

### Tool-call history and result

#### What the model sees

每次 assistant 工具调用在参数中保留其记录。成功返回当前领域列表加固定文案 `Now tracking <n> worktree(s); latest: <path>.` 或 `Now tracking <n> pull request(s); latest: <url>.` 稳定失败为 ``Error: invalid worktree `path`: must be a non-empty string``、``Error: invalid worktree `path`: must be an absolute path``、``Error: invalid pull request `url`: must be a non-empty string``、``Error: invalid pull request `number`: must be a positive integer``、`Error: worktree_track requires an owning agent session` 与 `Error: pull_request_track requires an owning agent session`。存储的记录是工具的私有状态；被日志记录的工具结果是其在会话日志中的唯一痕迹。

#### Token effect

Token 增长随模型提交的每条记录扩展，这些调用参数保留到压缩为止。结果本身很小，并随会话中记录数线性增长。

#### KV Cache effect

只追加；新可见内容跟随可复用的请求前缀，不会使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

这些限制定义工具何时是糟糕选择。它们是当前包约束，不是任务清单。

- **仅自报记录** — 记录断言的是模型的陈述；工具绝不验证 worktree 目录存在或 pull request 处于打开状态，也不与 git 或托管平台状态对账。
- **无删除、无只读工具** — 对同一键再次记录会替换其记录，但没有 `forget` 操作，也没有只列出记录的工具；当前列表随每次 track 调用返回。
- **仅单属主 scope** — 记录归属于调用它的那一个 agent 会话；共享或跨会话 scope 是有意裁剪，非 agent 调用者会被拒绝。
- **会话结束不清理** — 删除或归档会话不会移除其在 `session_git_track` 域中的行；没有保留清理流程。
- **仅通用 UI 卡片** — 待发调用卡片是通用的（`worktree_track` 附带 worktree 路径作为可跳转位置）；没有专用 Web 卡片从存储记录派生。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

本 Dev Note 是维护者的工作上下文：未决问题与未定方向。它明确是非权威的——已交付行为、限制与已接受的依据见上文章节与包代码。

#### 无 ./invariant 伴随包

本包不发布 `./invariant` 入口：两个工具是其两张表的唯一写入方，且每次写入都在该唯一写入路径通过记录校验，不存在可独立分叉的观察关系。

</details>
