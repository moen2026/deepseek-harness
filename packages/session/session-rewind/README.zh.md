---
description: "在文件工具即将改动每个路径之前，把其轮次开始前的内容以内容寻址方式捕获到 Session 的临时目录，并通过 workspace_rewind 工具或 sessionRewind 服务恢复某一轮的轮前状态；覆盖规则、上限与记录存活期。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-rewind

[English](README.md) | 中文

## 概述

每个顶层轮次都获得一个针对文件工具改动的还原点。在 `write`、`edit` 或有修改作用的 `str_replace_editor` 调用首次改动某路径之前，插件把文件内容复制到 Session 的临时目录，按其 SHA-1 命名，或记录该路径当时不存在。`workspace_rewind` 工具与 `sessionRewind` 服务重现某一轮的轮前状态：副本写回，轮前不存在的路径删除，超限捕获跳过并报告。Session 日志不追加任何内容；恢复本身就是它自己的工具调用与结果。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

正式提供的 Web bundle 挂载本插件。任何具备 `tools` 能力的组合都可以挂载它：

```yaml
- name: '@deepseek-ai/dsh-session-rewind'
  config:
    maxPaths: 200
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxFileBytes` | `2097152` | 单份轮前副本的字节上限（含边界值）；更大的文件没有副本，恢复时以 `oversized` 理由跳过 |
| `maxPaths` | `200` | 单轮检查点捕获的最大路径数；超出上限的轮次使捕获失败，进而使引发它的那次工具调用失败 |

有工作目录且不是子代理来源的 Session 都会被记录；子代理 Session 不记录，被委派的子作用域同样不记录。捕获只覆盖那三个文件工具点名的路径——通过 shell 命令做出的编辑永远不会被捕获，也永远不会被恢复。恢复重现的是捕获观察到的轮前状态：用户在本轮首次文件工具调用之前编辑过的路径，恢复到该调用时刻的状态，而不是更早的用户编辑。每个还原点按 `display` 顺序列出、恢复或删除路径——与 workspace-changes 摘要使用的相对或绝对标签规则相同。

任何一个边界值不是正整数时，插件加载失败。捕获与恢复都运行在 Session 打开的工作目录之内；调用不携带 session 上下文时 `workspace_rewind` 回答 `unavailable`，该轮没有记录时回答 `unknown_turn`。记录只在本 Host 进程内随其 Session 存活，每个 Session 至多保留最近 64 轮的记录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每个 Session 一个 `SessionRewindStore`，通过 promise 链串行化其捕获与恢复。`turn/start` 关闭上一轮的状态并开启新状态；下一轮开始时仍在捕获的轮次保留自己的状态，因此被中断的轮次保有自己的还原点。存储在挂载时只知道 Session 级状态，因此 scratch 目录（`dsh-session-rewind-*`）推迟到首次捕获时才在操作系统临时目录下惰性创建。每次 `tools/pre-execute` 从调用参数提取即将被改动的路径（`write` 与 `edit` 取其文件参数，`str_replace_editor` 取 `path`），沿 realpath 链规范化，使同一路径以两个名字被捕获两次时只存一份，并且每轮首次出现时打开文件、按 `maxFileBytes` 定长、把字节以内容 SHA-1 命名复制进 scratch 目录，创建时使用写排他标志，相同内容只存一份。该监听器在返回前等待存储的队列，因此没有修改能先于其捕获发生。

`restore(turn)` 在已关闭的记录或当前状态中查找该轮，然后按 `display` 顺序应用捕获：`absent` 捕获删除该路径（目标已不存在时的 unlink 失败视为成功，其余失败以 `unwritable` 跳过），`file` 捕获创建父目录并把存下的字节复制回去，`oversized` 捕获跳过并报告。写回失败以 `unwritable` 跳过该路径并记录警告，恢复继续进行。恢复被中止信号打断时，在下一个捕获边界停止。

记录保存在有界的环里：关闭一轮把它的捕获移入已关闭映射，关闭第 65 轮时淘汰最旧的一轮。Session 释放与插件释放会中止链、忘记存储并删除每个存储的 scratch 目录。因此 Host 重启会失去全部记录，重启后重新打开的对话对其先前轮次没有任何还原点。

**运行时不变式：** 不发布伴生入口。事件监听归 effect 所有，存储在其 Session 存活期间拥有这些捕获；没有独立观察会与它们分歧。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [工具 schema 目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-session-rewind)——模型收到的生成的 `workspace_rewind` schema。
- [工作区改动](../../deliverables/workspace-changes/README.zh.md)——同族的记录器：其逐轮改动文件摘要展示给用户，而 rewind 为模型恢复工作区。
- [工具执行管线](../../../docs/tool-execution-pipeline.zh.md)——`tools/pre-execute` 相对于守卫与执行的位置。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### What the model sees

模型在根上下文中看到[生成的 `workspace_rewind` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-session-rewind)：一个必填的 `turn` 数字。描述写明先覆盖的语义——被覆盖的路径即使后续轮次又编辑过也会写回——shell 命令的排除，以及回退过去轮次前先与用户确认的期望。

#### Token effect

插件活跃期间每次请求的固定 schema 开销；上限与 scratch 位置不会发送给模型。

#### KV Cache effect

可见工具定义与顺序不变时前缀稳定；注册生命周期可能从第一个变化的 schema token 起使复用失效。

### 结果

#### What the model sees

`ok` 的恢复返回一行，列出恢复、删除与跳过的路径；该轮没有记录时返回一行可操作的 `unknown_turn` 文本；调用不携带 session 上下文时返回 `unavailable` 一行。跳过按路径附带理由 `oversized` 或 `unwritable` 报告——某个路径写不回去不会使恢复的调用失败。

#### Token effect

与一次恢复报告的路径数量成正比；跳过的路径追加其理由短语。

#### KV Cache effect

无——结果只进入响应轮次，不进入请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 记录只在本 Host 进程内随其 Session 存活，且每个 Session 只保留最近 64 轮的记录；Host 重启会失去全部还原点。这是既定行为：Host 已经无法提供的恢复不再提供。
- 只捕获 `write`、`edit` 与有修改作用的 `str_replace_editor` 的路径；shell 命令、MCP 工具与任何其他修改对恢复不可见。
- 恢复重现的是捕获观察到的内容，即本轮首次文件工具调用时刻的状态——该调用之前用户做的编辑不属于还原点。
- 路径恢复到轮前内容会抹掉后续轮次对它的编辑；工具描述要求模型在回退过去的轮次前与用户确认。
- `oversized` 路径既不复制也不恢复；它在轮次之后的内容在回退中保留。
- 捕获与恢复在 Host 上以 Session 的工作目录权限运行；必须不把文件内容留在 Host 上的部署应把本插件组合出去。
- Windows 路径内部保留原生分隔符；报告的路径使用与 workspace-changes 摘要相同的 `display` 标签规则。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
