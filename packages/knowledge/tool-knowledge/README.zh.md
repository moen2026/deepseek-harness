---
description: "DeepSeek Harness 知识 seam（ctx.knowledge）之上的面向模型 knowledge_ingest、knowledge_search、knowledge_remove 与 knowledge_list 工具：带安全扫描的 ingest 路径、有界渲染结果与优雅的不可用应答，供调整模型知识库表面的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-knowledge

[English](README.md) | 中文

## Summary

使用 `dsh-tool-knowledge` 把共享知识库暴露给模型：`knowledge_ingest` 持久化一篇带标题的文档并返回其 id，`knowledge_search` 检索带摘录的排序命中，`knowledge_remove` 按 id 删除一篇，`knowledge_list` 按标签浏览。工具拥有模型可见的 schema、提示指导与渲染结果，而 `ctx.knowledge` 提供方拥有存储、排序与摘录 —— 因此更换提供方不会改变模型的提问方式。没有已注册提供方时，每个工具都以可操作的不可用应答回复，而不是让会话失败。

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

在提供 `ctx.knowledge`（seam 加上诸如 `dsh-knowledge-sqlite` 的提供方）的上下文上挂载本插件；工具会自行注册并贡献一个 system-prompt 段。

```yaml
- name: '@deepseek-ai/dsh-knowledge'
- name: '@deepseek-ai/dsh-knowledge-sqlite'
  config:
    path: .dsh/knowledge.sqlite
- name: '@deepseek-ai/dsh-tool-knowledge'
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxResultChars` | `8000` | 含截断元数据的完整渲染结果字符上限。 |
| `timeoutMs` | `30000` | 工具调用超时预算（ms）。 |

### The tools

`knowledge_ingest` 接收必填的 `title` 与 `text`、可选的 `tags` 与可选的 `source`；返回提供方分配的 id。已存储文档会在每次检索命中时重新进入模型上下文，因此 ingest 路径对不可信的标题与正文做安全扫描，对不安全候选返回带脱敏发现的 `rejected` 状态而不持久化。`knowledge_search` 接收必填的 `query` 加可选的 `tags` 与 `limit`，返回带 `snippet` 字段的排序命中。`knowledge_remove` 接收 `id` 并报告 `ok` 或 `not_found`。`knowledge_list` 接收可选的 `tags` 与 `limit`，返回按最近优先的文档摘要。未挂载提供方时，每个工具都返回带指导的 `unavailable` 状态。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现内部 —— 点击展开</summary>

本节解释工具背后的设计决策及代码实现位置；可观察行为见 [Use this package](#use-this-package)。

### Design philosophy

- **仅 Consumer 角色。** 本包拥有面向模型的名称、schema、提示指导与呈现；它不导入任何提供方，也不向存储或排序贡献内容。
- **安全扫描的 ingest。** 与 `dsh-tool-memory` 相同的扫描纪律：持久化文档会在每次检索命中时重新进入模型上下文，因此写入路径扫描并拒绝不安全候选。
- **有界渲染。** 结果渲染为带截断通知的有界文本，因此大语料无法通过一次调用淹没模型上下文。
- **优雅不可用。** 缺失提供方是正常部署状态而非错误：每个工具返回可操作的 `unavailable` 应答，会话继续。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：四个工具注册、提示段、配置 schema |
| [`src/render.ts`](src/render.ts) | 纯参数校验、结果渲染与 UI 呈现 |
| — | 未发布运行时 invariant 伴随物；工具是 seam 之上的无状态路由，可用性由 seam 自身的错误代码承载。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-knowledge](../knowledge/README.zh.md) —— 这些工具所投影的 seam 契约。
- [dsh-knowledge-sqlite](../knowledge-sqlite/README.zh.md) —— 默认部署背后的本地提供方。
- [knowledge 组地图](../README.zh.md) —— 三包家族及其相关文档。

-----

<a id="model-experience"></a>
## Model Experience

### Knowledge tools and prompt guidance

#### What the model sees

模型看到四个工具 —— `knowledge_ingest`、`knowledge_search`、`knowledge_remove`、`knowledge_list` —— 加上一个说明各自适用时机的提示段。search 返回有界文本行 `[score] id  title — snippet [tags] (source)` 形式的排序命中；list 返回 `id  title [tags] (source)` 行。所有渲染结果都受 `maxResultChars` 上界约束并附截断通知。被拒绝的 ingest 返回脱敏的扫描发现并请模型改写；未挂载提供方时返回可操作的不可用应答。

#### Token effect

四个工具 schema 与提示段在提供方挂载期间贡献固定的请求上下文 token；渲染结果落在工具结果中，不进入请求前缀。

#### KV Cache effect

提示段在给定配置下是静态的，因此请求前缀跨调用保持稳定；渲染结果落在工具结果中，不进入前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


这些限制定义工具当前的范围。它们是包约束，不是任务清单。

- **没有更新路由** —— 文档一经 ingest 即不可变；模型通过删除再重写来修订，与 seam 的四条路由一致。
- **工具层没有跨会话作用域** —— 语料是部署级的；按工作区或用户划分是提供方的事务，工具只暴露标签。
- **摘录用词归提供方所有** —— 摘录的长度与分隔符跨提供方不同，工具按原文渲染。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

None.

</details>
