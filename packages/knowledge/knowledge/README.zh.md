---
description: "知识库能力 seam（ctx.knowledge）：单提供方预留注册表与四条顺序无关路由 —— ingest、search、remove、list —— 覆盖规范化的请求，供组合或扩展共享 Agent 知识库的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge

[English](README.md) | 中文

## Summary

使用 `dsh-knowledge` 为 Agent 提供持久、共享的知识库：ingest 存入一篇带标题的文档并返回其 id，规范化的 search 返回带提供方计算摘录的排序命中，remove 与 list 补全语料管理，因此提供方的存储与排序不会改变请求或模型可见的结果。单一提供方独占预留该 seam，且注册是原子的：无效或冲突的声明不会发布任何内容。将其与 `dsh-knowledge-sqlite` 提供方和面向模型的 `dsh-tool-knowledge` 组合使用；单独挂载时它不响应任何操作并抛出 `KNOWLEDGE_UNAVAILABLE`。它不会代替调用方选择嵌入模型。

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

挂载一个知识提供方与 `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list` 工具，即可为 Agent 提供跨会话、跨用户持久的文档语料。本包是这些包注册所对应的服务；它自身不定义 UI、工具或存储。

### When to choose it

当部署需要一个模型可扩展的、经策展的可搜索文档语料时选择本服务。它覆盖四条路由 —— ingest、search、remove、list —— 排序、摘录与结果上界由提供方负责；存储布局、分块与任何向量检索都是提供方的私有事务。该服务与提供方无关：本地 FTS5 存储与任何未来后端以同一方式注册，因此更换提供方不会改变模型看到的内容或提问方式。对于简短的每用户 Agent 记忆，请改用 `memory` seam；知识库是对带标题文档的整体语料声明。

### Composing a knowledge stack

该 seam 需要提供方与消费方才能工作。最小组合挂载服务、SQLite 提供方与工具：

```yaml
- name: '@deepseek-ai/dsh-knowledge'
- name: '@deepseek-ai/dsh-knowledge-sqlite'
  config:
    path: .dsh/knowledge.sqlite
- name: '@deepseek-ai/dsh-tool-knowledge'
```

存储路径、排序与结果上界在提供方包中配置；参见 [dsh-knowledge-sqlite](../knowledge-sqlite/README.zh.md) 与 [dsh-tool-knowledge](../tool-knowledge/README.zh.md)。

### The operations

`ingest(draft, signal?)` 接收 `KnowledgeDraft` —— 必填的 `title` 与 `text`，可选的 `tags` 与 `source` —— 并返回提供方分配的 id。`search(request, signal?)` 接收 `KnowledgeSearchRequest`（必填的 `query`，可选的 `tags` 与 `limit`），返回按相关度降序排列的 `KnowledgeSearchResult`，每个 `KnowledgeHit` 包装一条已存储的 `KnowledgeRecord` 及提供方计算的 `snippet`。`remove(id, signal?)` 在文档被删除时返回 `true`。`list(request?, signal?)` 返回最近的文档，可按标签过滤。除必填字段外一切可选，调用方只发送它真正想表达的内容；该 seam 不施加超时或上界，因此没有 `resolve()` 步骤。

### Failures and recovery

未注册提供方时，操作以结构化错误 `KNOWLEDGE_UNAVAILABLE` 失败 —— 挂载提供方，或不使用知识库继续。无效或冲突的注册在发布任何路由之前以 `KNOWLEDGE_INVALID_PROVIDER` 或 `KNOWLEDGE_CONFLICT` 失败，对已释放提供方的操作以 `KNOWLEDGE_DISPOSED` 失败，格式错误的请求以 `KNOWLEDGE_INVALID_REQUEST` 失败。消费方捕获 `KnowledgeError` 并按其稳定的 `code` 路由；经由工具时，它们表现为模型可读的错误或不可用结果。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现内部 —— 点击展开</summary>

本节解释 seam 背后的设计决策及代码实现位置；可观察行为见 [Use this package](#use-this-package)。

### Design philosophy

- **能力 seam 的 Service Definition 角色。** 本包拥有 `ctx.knowledge` 与提供方注册表；提供方存储文档并排序检索，而不是工具，`dsh-tool-knowledge` 是面向模型表面的唯一所有者。
- **独占的整体语料预留。** 同一时刻只有一个提供方持有该 seam；与按调用方的路由不同，知识库声明整个语料，因此第二次注册是冲突而不是并存的第二条路由。
- **原子注册。** `registerProvider()` 在变更前完成全部校验与冲突检查：无效或冲突的注册不发布任何内容，其 disposer 释放预留。
- **顺序无关路由。** 四条路由各自经由 `ctx.effect()` 转发到唯一已注册的提供方，因此预留与路由随注册它的 fiber 存亡；注册与 HMR 顺序永远不会改变应答的提供方。
- **封闭且提供方无关的词汇。** draft、record、hit 与请求形状在各后端之间固定 —— 增加一个可选细化是横跨 seam、提供方与工具的编译期强制修改。没有分块、嵌入或协议逃生舱。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Knowledge` 服务、`registerProvider`/`ingest`/`search`/`remove`/`list`、`KnowledgeError` 代码 |
| [`src/types.ts`](src/types.ts) | Seam 词汇：draft、record、request、hit、page、provider 与 service 契约 |
| — | 未发布运行时 invariant 伴随物；提供方预留是私有的、原子更新的状态；该 seam 既不暴露可枚举快照，也不暴露可独立比对的生命周期事件。 |

### Registration and disposal lifecycle

注册与释放经由 `ctx.effect()` 运行，因此提供方路由随注册它的 fiber 存亡。`registerProvider()` 返回同步 disposer；该 seam 丢弃恒为 resolved 的 effect promise，使 disposer API 保持同步。`KnowledgeError` 继承 `HarnessError` 并携带稳定代码（`KNOWLEDGE_INVALID_PROVIDER`、`KNOWLEDGE_CONFLICT`、`KNOWLEDGE_UNAVAILABLE`、`KNOWLEDGE_DISPOSED`、`KNOWLEDGE_INVALID_REQUEST`），调用方按代码路由而不是解析 `message`。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

当包级契约不够用时阅读这些页面。它们从共享知识模型过渡到提供方与工具。

- [dsh-knowledge-sqlite](../knowledge-sqlite/README.zh.md) —— 注册到本 seam 的 SQLite FTS5 提供方。
- [dsh-tool-knowledge](../tool-knowledge/README.zh.md) —— 本 seam 之上的面向模型工具。
- [knowledge 组地图](../README.zh.md) —— 三包家族及其相关文档。

-----

<a id="model-experience"></a>
## Model Experience

间接体验，经由 `dsh-tool-knowledge`：它拥有面向模型的 `knowledge_ingest`/`knowledge_search`/`knowledge_remove`/`knowledge_list` schema、提示指导与渲染结果，而本注册表自身不贡献任何提示或 schema。

#### KV Cache effect

无直接失效；`dsh-tool-knowledge` 拥有请求前缀变更。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


这些限制定义该 seam 当前的范围。它们是包约束，不是任务清单。

- **每运行时单一提供方** —— 一个知识库是整体语料声明，因此第二次注册是冲突而非并存。若确需多提供方路由，部署方配置的选择器是预期扩展。
- **四条路由，无观测 API** —— 该 seam 只暴露 `ingest`、`search`、`remove` 与 `list`；没有语料状态查询或提供方变更事件，可用性只能通过执行路由并路由抛出的 `KnowledgeError` 代码来观察。
- **提供方定义的分数单位与摘录** —— 命中的 `score` 只在单一提供方内部排序，`snippet` 的长度与分隔符由提供方决定；该 seam 不做跨提供方可比性承诺，且请求不携带超时或上界，因此消费方拥有这些边界。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

None.

</details>
