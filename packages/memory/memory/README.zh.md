---
description: "长期记忆能力 seam（ctx.memory）：单提供方独占注册表，以及四条对规范化请求进行顺序无关路由的操作——remember、recall、forget 与 list，供组合或扩展持久 agent 记忆的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

[English](README.md) | 中文

## 概述

使用 `dsh-memory` 为 agent（智能体）提供持久的长期记忆：一次写入返回分配的 id，一次规范化召回返回排序后的命中，forget 与 list 补全整个存储，因此提供方的存储与排序绝不改变请求或模型可见结果。单个提供方以独占方式保留 seam，且注册是原子的：无效或冲突的声明不会发布任何内容。将其与 `dsh-memory-sqlite` 等提供方及面向模型的 `dsh-tool-memory` 组合；单独使用时不响应任何操作，并抛出 `MEMORY_UNAVAILABLE`。它不替调用方选定嵌入模型。

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

挂载记忆提供方与 `memory_write`／`memory_search`／`memory_forget` 工具，即可为 agent 提供一个跨轮次持久化的存储。本包就是这些包所注册的服务；它自身不定义任何 UI、工具或存储。

### 何时选择

当部署希望模型可见的持久记忆由一个 agent 从不构建的存储支撑时，选择此服务。它覆盖四条操作——写入、召回、遗忘、列举——排名与边界由提供方拥有；存储布局、时间戳与任何向量检索都是提供方的私有事务。该服务提供方无关：本地 FTS5 存储与任何未来后端都以相同方式注册，因此更换提供方不会改变模型看到的内容或请求方式。

### 组合记忆栈

seam 需要提供方与消费方才能发挥作用。最小组合挂载服务、SQLite 提供方与工具：

```yaml
- name: '@deepseek-ai/dsh-memory'
- name: '@deepseek-ai/dsh-memory-sqlite'
  config:
    path: .dsh/memory.sqlite
- name: '@deepseek-ai/dsh-tool-memory'
```

存储路径、排名与结果上限在提供方包中配置；见 [dsh-memory-sqlite](../memory-sqlite/README.zh.md) 与 [dsh-tool-memory](../tool-memory/README.zh.md)。

### 这些操作

`remember(draft, signal?)` 接受一个 `MemoryDraft`——一个必填的 `text`，加上可选的 `tags`、`scope`、`namespace`、`confidence` 与 `ttlMs`——并返回提供方分配的 id。`recall(request, signal?)` 接受一个 `MemoryRecallRequest`（一个必填的 `query`，可选的 `tags`、`scope`、`namespace`、`minConfidence` 与 `limit`），并按相关性降序返回一个由 `MemoryHit` 组成的 `MemoryRecallResult`，每条命中包裹一条已存储的 `MemoryRecord`。`forget(id, signal?)` 在移除某条记录时返回 `true`。`list(request?, signal?)` 返回最近的记录，可按同样的细化项过滤。记录在草稿提供时携带其 `namespace`、`confidence` 与计算出的 `expiresAt`，召回与列举按这三者过滤：过期记录绝不返回。除必填项外每个字段都可选，因此调用方只发送它所表达的意思；seam 不施加超时或上限，因此不存在 `resolve()` 步骤。

### 失败与恢复

当没有注册提供方时，操作会以结构化错误 `MEMORY_UNAVAILABLE` 失败——挂载一个提供方，或在无记忆的情况下继续。无效或冲突的注册会在任何路由发布前以 `MEMORY_INVALID_PROVIDER` 或 `MEMORY_CONFLICT` 失败，对已释放提供方的操作以 `MEMORY_DISPOSED` 失败，畸形请求以 `MEMORY_INVALID_REQUEST` 失败。消费方捕获 `MemoryError` 并按其稳定的 `code` 路由；经由工具，这些会呈现为模型可读的错误或不可用结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释 seam 背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **能力 seam，Service Definition 角色。** 本包拥有 `ctx.memory` 与提供方注册表；提供方存储记录并为召回排名，而非注册工具，`dsh-tool-memory` 是面向模型表层的唯一 owner。
- **对整个语料的独占保留。** 一次只有一个提供方持有 seam；与按调用方的路由不同，记忆存储声明整个语料，因此第二次注册是冲突而非共存的路由。
- **原子注册。** `registerProvider()` 在变更前验证并检查全部冲突：无效或冲突的注册不会发布任何内容，其 disposer 会释放该保留。
- **与顺序无关的路由。** 四条操作中的每一条都通过 `ctx.effect()` 转发给唯一注册的提供方，因此保留与这些路由随注册 fiber 一同存活与消亡；注册与 HMR（热模块替换）顺序绝不会改变由哪个提供方响应。
- **封闭、提供方无关的词汇。** draft、record、hit 与 request 的结构在各后端间固定——新增细化项是跨 seam、提供方与工具的编译期强制变更。没有嵌入或协议逃生口。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Memory` 服务、`registerProvider`／`remember`／`recall`／`forget`／`list`、`MemoryError` code |
| [`src/types.ts`](src/types.ts) | seam 词汇：draft、record、request、hit、page、提供方与服务约定 |
| — | 不发布运行时不变式伴生入口；提供方保留属于以原子方式更新的私有状态；该 seam 既不公开可枚举快照，也不公开可供独立比较的生命周期事件。 |

### 注册与释放生命周期

注册与释放通过 `ctx.effect()` 执行，因此提供方路由随注册 fiber 一同存活与消亡。`registerProvider()` 返回一个同步的 disposer；seam 丢弃那个总是已 resolve 的 effect promise，使其 disposer API 保持同步。`MemoryError` 扩展 `HarnessError`，携带稳定的 code（`MEMORY_INVALID_PROVIDER`、`MEMORY_CONFLICT`、`MEMORY_UNAVAILABLE`、`MEMORY_DISPOSED`、`MEMORY_INVALID_REQUEST`），调用方据此路由，而不是解析 `message`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享的记忆模型逐步进入提供方与工具。

- [dsh-memory-sqlite](../memory-sqlite/README.zh.md)——注册到该 seam 的 SQLite FTS5 提供方。
- [dsh-tool-memory](../tool-memory/README.zh.md)——基于该 seam 的面向模型工具。
- [memory 组地图](../README.zh.md)——五个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-memory` 间接影响；该工具拥有面向模型的 `memory_write`／`memory_search`／`memory_forget` schema、提示词指引与渲染结果，本注册表自身不贡献提示词或 schema。

#### KV Cache 影响

不会直接失效；请求前缀变更由 `dsh-tool-memory` 负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义 seam 当前的范围。它们是包约束，不是任务积压。

- **每个运行时仅一个提供方**——一份记忆存储是对整个语料的声明，因此第二次注册是冲突而非共存。若将来需要多提供方路由，预期扩展是在注册之上增加部署配置的 selector。
- **四条操作，没有观测表层**——seam 只暴露 `remember`、`recall`、`forget` 与 `list`；没有存储状态查询或提供方变更事件，可用性只能通过运行某条操作并按抛出的 `MemoryError` code 路由来观测。
- **分数单位由提供方定义**——命中的 `score` 只在一个提供方内部为结果排序；seam 不做跨提供方可比性的承诺，且没有请求携带超时或上限，这些边界由消费方负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
