---
description: "面向模型的记忆工具：基于 ctx.memory seam 的 memory_write、memory_search 与 memory_forget，在未挂载提供方时给出可操作的不可用应答，召回默认按词法排序，且仅当部署自带嵌入端点时启用可选的语义排序，供组合模型长期记忆的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

[English](README.md) | 中文

## 概述

`dsh-tool-memory` 为模型提供三个基于 `ctx.memory` 的工具：`memory_write` 持久一条持久事实并返回其 id——先用 `scanUntrustedText` 拒绝不安全文本并返回脱敏发现，因为持久记忆会在每次召回时重新进入模型上下文——`memory_search` 返回排序命中，`memory_forget` 按 id 删除一条。在挂载记忆提供方之前三者均不可用；无提供方时它们返回一个可操作的"记忆不可用"消息而非让会话失败。召回默认按词法排序；语义排序仅在部署配置其自身嵌入端点时激活，且 DSH 绝不替模型选定模型或嵌入提供方。搜索结果由 `maxResultChars` 定界。本包运行时只注入 `tools`、`memory` 与 `systemPrompt`，不导入任何提供方。

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

当用户要求记住某事时智能体写入一条记忆，当过往上下文可能相关时搜索，当被要求丢弃某条先前的记忆时遗忘；该工具的提示词指引告诉它三者皆为可选，不可用时在无记忆的情况下继续。

### 这些工具

`memory_write` 接收一个必填的 `text`，加上可选的 `tags`、`scope`、`namespace`、`confidence` 与 `ttl_ms`。`memory_search` 接收一个必填的 `query`，加上可选的 `tags`、`scope`、`namespace`、`min_confidence` 与 `limit`。`memory_forget` 接收一个必填的 `id`。每个工具都 trim 其输入，丢弃空白的精化项，规范化 `tags`（trim、去重、保序），校验所提供的 `namespace` 属于封闭的 `preference`／`fact`／`style` 词汇、所提供的 `confidence` 或 `min_confidence` 落在 0 到 1 之间、所提供的 `ttl_ms` 为正整数，并在触及 seam 前把空白的必填字段或非正整数的 `limit` 作为可操作的参数错误拒绝。提供方选择、存储路径、排名与结果边界都留在模型输入之外；它们属于所挂载的提供方。

### 模型收到什么

每个工具返回一个封闭结果。`memory_write` 返回 `status` 为 `ok` 并带一个 `id`，或 `unavailable`。`memory_search` 返回 `status` 为 `ok` 并带一个排序的 `hits` 数组（每项含 `id`、`text`、`tags`、可选 `scope`、`namespace`、`confidence`、`createdAt`、`expiresAt`、`score`），或 `unavailable` 且 `hits` 为空；过期记忆绝不返回。`memory_forget` 返回 `status` 为 `ok`、`not_found` 或 `unavailable`。渲染为写入输出 `Remembered (id: …).`，为搜索按分数最优优先、每条命中一行 `[score] id  text [tags] (scope)`，记录携带时附加 ` namespace=` 与 ` conf=` 后缀（空页为 `No matching memories found.`），为遗忘输出 `Memory forgotten.` 或 `That memory id was not found.`。完整搜索文本由 `maxResultChars` 定界，截断通知计入该上限之内。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxResultChars` | `8000` | 完整渲染搜索结果的最大长度，包括截断通知 |
| `timeoutMs` | `30000` | 工具调用超时预算，覆盖一次可能的嵌入往返 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-memory)是每个受支持字段的穷尽式真源。

### 失败与恢复

来自 seam 的 `MEMORY_UNAVAILABLE` 会被捕获并以 `status: 'unavailable'` 返回，因此会话继续运行。空白的必填字段或格式错误的 `limit` 会呈现为框架报告给模型的参数错误。任何其他 `MemoryError`（无效请求、已释放的提供方）都以结构化工具错误传播，供模型读取并路由。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释这些工具背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计说明

- **只做消费方。** 这些工具运行时只注入 `tools`、`memory` 与 `systemPrompt`，不导入任何提供方，并且只把 `exec.signal` 传给 seam。
- **过 seam 前的参数规范化。** `parseWriteArgs`、`parseSearchArgs` 与 `parseForgetArgs` 去除首尾空白并折叠输入、规范化 tags、校验 `namespace`／`confidence`／`min_confidence`／`ttl_ms`、验证 `limit`，因此提供方收到规范请求，格式错误的输入是可操作错误而非崩溃。
- **可用性是数据，不是崩溃。** 每个 `execute` 捕获 code 为 `MEMORY_UNAVAILABLE` 的 `MemoryError` 并返回 `unavailable` 状态；其他错误一律重新抛出，因此真正损坏的提供方仍会被呈现。
- **默认词法，语义可选。** 这些工具从不自行嵌入或排名；它们呈现所挂载提供方排名的结果，且提示词声明语义排序仅在部署自带端点时存在。
- **并发性反映写入。** `memory_search` 返回 `isConcurrencySafe: true`（纯读取）；`memory_write` 与 `memory_forget` 返回 `false`，因为它们改变存储。
- **通用卡片呈现。** `presentWriteCall`／`presentSearchCall`／`presentForgetCall` 渲染 `{ card: 'generic', kind, title }` 视图，其标题携带摘录、查询或 id；没有目标文件，因此不附加任何位置。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、提示词区段、`memory_write`／`memory_search`／`memory_forget` 注册与执行 |
| [`src/render.ts`](src/render.ts) | 纯参数验证、带结果上限的命中渲染、UI 呈现 |
| — | 不发布运行时不变式伴生入口；这些无状态适配器提供三个工具和一个提示词区段，而存储生命周期与结果关系仍由它们所组合的工具 seam 和 memory seam 负责。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从面向模型的表层逐步进入 seam 与提供方。

- [dsh-memory](../memory/README.zh.md)——这些工具查询的 seam。
- [dsh-memory-sqlite](../memory-sqlite/README.zh.md)——应答这些操作的提供方。
- [memory 组地图](../README.zh.md)——五个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

一个系统提示词区段（first-party 顺序 2450）将记忆工具及其可选性定位如下文本：

##### 逐字指引

```markdown
Use memory_write to persist a durable fact or preference when the user asks you to remember something, memory_search to recall stored memories when past context may be relevant, and memory_forget to remove a memory by its id. A written memory may carry a namespace (preference, fact, or style), a confidence, and a ttl_ms expiry after which it stops being recalled. All three are unavailable until a memory provider is configured — then continue normally without memory. Recall ranks lexically by default; an optional semantic ranking is active only when the deployment supplies its own embedding endpoint, and DSH never selects a model or embedding provider on your behalf.
```

#### Token 影响

插件处于活跃状态时，每次请求承担固定指引成本。

#### KV Cache 影响

只要插件 scope 与指引文本不变，前缀就保持稳定；激活或 dispose（资源释放）可能使从该区段起的复用失效。

### 工具 schema

#### 模型看到什么

模型会看到生成的 [`memory_write`、`memory_search` 与 `memory_forget` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory)。

#### Token 影响

启用期间，每次请求承担固定 schema 成本；`timeoutMs` 预算绝不会发给模型。

#### KV Cache 影响

只要可见工具定义与顺序不变，前缀就保持稳定；注册生命周期或 scope 限制可能使从第一个变化的 schema token 起的复用失效。

### 结果

#### 模型看到什么

写入返回 `Remembered (id: …).`；搜索按 `score` 降序、每条命中一行 `[score] id  text [tags] (scope)`，记录携带时附加 ` namespace=` 与 ` conf=` 后缀，由 `maxResultChars` 定界，空页则是一个独立的 `No matching memories found.` 行；遗忘返回 `Memory forgotten.` 或 `That memory id was not found.`。当没有挂载提供方时，每个结果都是可操作的不可用消息而非错误。截断通知计入字符上限之内。

#### Token 影响

搜索结果由 `maxResultChars` 定界；命中数量还额外受请求的 `limit` 与提供方的 `maxLimit` 约束。写入与遗忘结果都是单条短行。

#### KV Cache 影响

工具结果追加在已缓存的请求前缀之后，不会直接使其失效。

### UI 呈现

#### 模型看到什么

什么都没有。客户端渲染通用卡片——`{ card: 'generic', kind, title }`——其标题携带写入摘录（`other`）、搜索查询（`search`）或遗忘 id（`other`）；没有目标文件，因此不附加任何位置。

#### Token 影响

零直接 token 影响，因为渲染仅在客户端进行。

#### KV Cache 影响

无；UI 呈现在模型请求之外。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义这些工具何时不适合。它们是当前包约束，不是任务积压。

- **提供方门控可用性**——没有挂载记忆提供方时，这些工具始终返回不可用消息；它们绝不自行存储任何内容，因此部署必须挂载 `dsh-memory-sqlite`（或另一个提供方）才能得到真实的写入与召回。
- **不选定嵌入**——这些工具仅经由其提供方暴露排名；除非部署配置其自身的嵌入端点，否则召回为词法，且 DSH 绝不为模型挑选模型或嵌入提供方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
