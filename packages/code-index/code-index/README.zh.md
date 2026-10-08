---
description: "代码库索引能力 seam（ctx.codeIndex）：单提供方独占注册表，以及一条对规范化请求进行顺序无关词法代码检索的路由，供组合或扩展工作区代码搜索的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-code-index

[English](README.md) | 中文

## 概述

使用 `dsh-code-index` 为 agent（智能体）提供对工作区已索引源码的词法全文搜索：一次规范化查询返回带匹配片段、按相关性排序的行范围，因此提供方的排序与语料绝不改变请求或模型可见结果。单个提供方以独占方式保留 seam——代码索引是对整个语料的声明，而非按扩展名的路由——且注册是原子的：无效或冲突的声明不会发布任何内容。本包必须与 `dsh-code-index-sqlite` 等提供方及面向模型的 `dsh-tool-code-index` 组合；单独使用时不响应任何查询，并抛出 `CODE_INDEX_UNAVAILABLE`。

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

挂载代码索引提供方与 `search_codebase` 工具，即可为 agent 提供一项在更换后端时依然稳定的、对源码的排名文本搜索。本包就是这些包所注册的服务；它自身不定义任何 UI、工具或索引。

### 何时选择

当部署希望模型可见的代码搜索由一个 agent 从不构建的索引支撑时，选择此服务。它覆盖一次返回带分数命中的只读词法搜索；语料构建、分块、排序与结果上限都是提供方的私有事务。该服务提供方无关：本地 FTS5 索引与任何未来后端都以相同方式注册，因此更换提供方不会改变模型看到的内容或请求方式。

### 组合搜索栈

seam 需要提供方与消费方才能发挥作用。最小组合挂载服务、SQLite 提供方与工具：

```yaml
- name: '@deepseek-ai/dsh-code-index'
- name: '@deepseek-ai/dsh-code-index-sqlite'
  config:
    path: .dsh/code-index.sqlite
    root: .
- name: '@deepseek-ai/dsh-tool-code-index'
```

索引路径、工作区根、分块与结果上限在提供方包中配置；见 [dsh-code-index-sqlite](../code-index-sqlite/README.zh.md) 与 [dsh-tool-code-index](../tool-code-index/README.zh.md)。

### 操作

`search(request, signal?)` 接受一个规范化的 `CodeSearchRequest`——一个必填的 `query`，加上可选的 `glob`、`language` 与 `limit` 细化项——并按相关性降序返回一个由 `CodeSearchHit` 组成的 `CodeSearchPage`。除 `query` 外每个字段都可选，因此调用方只发送它所表达的意思；seam 不施加超时或上限，因此不存在 `resolve()` 步骤。每条命中携带一个工作区相对的 `path`、一个从 1 开始的行范围、一个可选的 `language`、一个提供方定义的 `score`，以及一个有界的 `snippet`。

### 失败与恢复

当没有注册提供方时，查询会以结构化错误 `CODE_INDEX_UNAVAILABLE` 失败——挂载一个提供方，或回退到 grep/glob/read。无效或冲突的注册会在任何路由发布前以 `CODE_INDEX_INVALID_PROVIDER` 或 `CODE_INDEX_CONFLICT` 失败，对已释放提供方的查询以 `CODE_INDEX_DISPOSED` 失败，畸形请求以 `CODE_INDEX_INVALID_REQUEST` 失败。消费方捕获 `CodeIndexError` 并按其稳定的 `code` 路由；经由工具，这些会呈现为模型可读的错误结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释 seam 背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **能力 seam，Service Definition 角色。** 本包拥有 `ctx.codeIndex` 与提供方注册表；提供方注册的是语料与排名器而非工具，`dsh-tool-code-index` 是面向模型表层的唯一 owner。
- **对整个语料的独占保留。** 一次只有一个提供方持有 seam；与按扩展名的路由不同，代码索引声明整个工作区，因此第二次注册是冲突而非共存的路由。
- **原子注册。** `registerProvider()` 在变更前验证并检查全部冲突：无效或冲突的注册不会发布任何内容，其 disposer 会释放该保留。
- **与顺序无关的路由。** `search()` 通过 `ctx.effect()` 转发给唯一注册的提供方，因此保留与路由随注册 fiber 一同存活与消亡；注册与 HMR（热模块替换）顺序绝不会改变由哪个提供方响应。
- **封闭、提供方无关的词汇。** 请求与命中的结构在各后端间固定——新增细化项是跨 seam、提供方与工具的编译期强制变更。没有构建索引或协议逃生口。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`CodeIndex` 服务、`registerProvider`／`search`、`CodeIndexError` code |
| [`src/types.ts`](src/types.ts) | seam 词汇：请求、命中、页面、提供方与服务约定 |
| — | 不发布运行时不变式伴生入口；提供方保留属于以原子方式更新的私有状态；该 seam 既不公开可枚举快照，也不公开可供独立比较的生命周期事件。 |

### 注册与释放生命周期

注册与释放通过 `ctx.effect()` 执行，因此提供方路由随注册 fiber 一同存活与消亡。`registerProvider()` 返回一个同步的 disposer；seam 丢弃那个总是已 resolve 的 effect promise，使其 disposer API 保持同步。`CodeIndexError` 扩展 `HarnessError`，携带稳定的 code（`CODE_INDEX_INVALID_PROVIDER`、`CODE_INDEX_CONFLICT`、`CODE_INDEX_UNAVAILABLE`、`CODE_INDEX_DISPOSED`、`CODE_INDEX_INVALID_REQUEST`），调用方据此路由，而不是解析 `message`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享的搜索模型逐步进入提供方与工具。

- [dsh-code-index-sqlite](../code-index-sqlite/README.zh.md)——注册到该 seam 的 SQLite FTS5 提供方。
- [dsh-tool-code-index](../tool-code-index/README.zh.md)——基于该 seam 的面向模型工具。
- [code-index 组地图](../README.zh.md)——三个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-code-index` 间接影响；该工具拥有面向模型的 `search_codebase` schema、提示词指引与渲染结果，本注册表自身不贡献提示词或 schema。

#### KV Cache 影响

不会直接失效；请求前缀变更由 `dsh-tool-code-index` 负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义 seam 当前的范围。它们是包约束，不是任务积压。

- **每个运行时仅一个提供方**——一份代码索引是对整个语料的声明，因此第二次注册是冲突而非共存。若将来需要多提供方路由，预期扩展是在注册之上增加部署配置的 selector。
- **仅一次词法搜索，没有观测表层**——seam 只暴露 `search`；没有索引状态查询或提供方变更事件，可用性只能通过运行 `search()` 并按抛出的 `CodeIndexError` code 路由来观测。
- **分数单位由提供方定义**——`score` 只在一个提供方内部为命中排序；seam 不做跨提供方可比性的承诺，且请求不携带超时或上限，这些边界由消费方负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
