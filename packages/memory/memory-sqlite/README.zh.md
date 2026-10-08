---
description: "ctx.memory 的 SQLite FTS5 长期记忆提供方：一个派生、仅属主可读的存储，把记忆记录为按 BM25 排序的 FTS5 行并应答词法召回；仅当部署自带嵌入端点时启用可选的融合向量路径，供组合本地 agent 记忆的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-sqlite

[English](README.md) | 中文

## 概述

使用 `dsh-memory-sqlite` 以 `node:sqlite` 上离线、零依赖的 FTS5 存储支撑 `ctx.memory`。`remember` 写入一条记录加一行 FTS5，`recall` 用 BM25 排序，`forget`／`list` 按最近时间删除与枚举。仅当部署在 `config.embedding` 中提供一个 HTTP 嵌入端点时，它才会额外存储一个向量并把 BM25 与 JS 内余弦相似度融合；任何嵌入失败都降级到词法路径，因此记忆在离线时始终可用。存储是受保护、仅属主文件中的派生数据，删除并重建安全。它不选定嵌入模型，也不存储凭证。

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

当部署希望在没有外部服务的情况下拥有模型可见的持久记忆时，挂载此提供方。它需要 `dsh-memory` seam，并且为让模型访问还需 `dsh-tool-memory`；它在宿主文件系统上拥有一个 SQLite 文件，除非部署配置了嵌入模型，否则不选定任何模型。

### 最小配置

`path` 是专用的派生存储文件（支持 `:memory:`）。提供方打开存储一次——当 `openAt` 为 `startup` 时在启动时，否则在首次操作时惰性执行。每个数值边界在加载时都验证为正整数。

```yaml
- name: '@deepseek-ai/dsh-memory'
- name: '@deepseek-ai/dsh-memory-sqlite'
  config:
    path: .dsh/memory.sqlite
    defaultLimit: 10
- name: '@deepseek-ai/dsh-tool-memory'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | 派生存储文件；缺失的文件系统路径以仅属主（`0o600`）方式创建；支持 `:memory:` |
| `openAt` | `startup` | 在启动时，或在首次操作时惰性打开 |
| `journalMode` | `wal` | SQLite 日志模式（经过验证的封闭联合，绝不是调用方可控的 SQL） |
| `defaultLimit` | `10` | 请求省略 `limit` 时的结果数量 |
| `maxLimit` | `100` | 可接受的最大页大小与列举池 |
| `maxTextBytes` | `8192` | 单条记忆文本的 UTF-8 字节上限 |
| `embedding` | 缺省 | 启用向量路径的可选外部嵌入端点；缺省即仅词法 |

### 启用可选向量路径

向量路径默认关闭。仅当部署自带一个 OpenAI 兼容端点时设置 `embedding`；届时 `remember` 也会存储一个向量，且 `recall` 在融合前先做词法预筛。若该块存在却不完整，提供方会在加载时以 `MEMORY_INVALID_REQUEST` 大声失败。

```yaml
  config:
    path: .dsh/memory.sqlite
    embedding:
      url: https://embeddings.example/v1/embeddings
      model: my-embedding-model
      authEnv: MY_EMBEDDING_TOKEN
      dimension: 1536
      timeoutMs: 15000
      maxBatch: 64
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `embedding.url` | 必填 | 完整的嵌入端点 URL（OpenAI 兼容的 `/v1/embeddings` 形态） |
| `embedding.model` | 必填 | 发送给端点的模型名 |
| `embedding.authEnv` | 必填 | 持有 bearer token 的环境变量名；绝非 token 本身 |
| `embedding.dimension` | 必填 | 所需的嵌入维度；维度不符的响应会被拒绝 |
| `embedding.timeoutMs` | `15000` | 每请求超时（毫秒） |
| `embedding.maxBatch` | `64` | 每请求最大输入数；更长的批次会被拆分 |

凭证在调用时从 `process.env[authEnv]` 读取且仅作为请求头发送——绝不进入配置文件、存储的记忆或日志。

### 一次召回做什么

`recall` 规范化请求，运行一次由 `bm25()` 排序的 FTS5 `MATCH` 构建候选池，剔除被 `tags`／`scope`／`namespace`／`minConfidence` 过滤掉的记录与每一条过期记录，并返回排序后的命中。列举路径套用同样的过滤。配置了 embedder 时，它嵌入查询，对每个候选的已存向量计算 JS 内余弦相似度，并以倒数排名融合把词法序与向量序融合，再切片到 `limit`。空查询、超出范围的 `limit`、或超过 `maxTextBytes` 的文本会以 `MEMORY_INVALID_REQUEST` 失败。当端点不可达或出错时，提供方告警一次并以已算好的词法排序应答，因此召回绝不会因嵌入而失败。

### 可观察的成功与失败

成功的召回按相关性降序返回命中，每条命中包裹一条已存储的 `MemoryRecord`（`id`、`text`、`tags`、可选 `scope`、`namespace`、`confidence`、`createdAt`、`expiresAt`）加一个 `score`；空结果是一次成功的无匹配响应。打开属于另一个应用、或含有无法识别表的文件时会大声失败而非重置它；版本不符会就地重置派生模式。释放之后，操作以 `MEMORY_DISPOSED` 失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **派生数据，绝不权威。** 存储是受保护文件中一个可重建的缓存；删除它始终安全，且 `application_id` 加 `user_version` 在打开时调和模式。
- **独占归属保护。** `PRAGMA application_id` 保护一个无关数据库免受就地重置；只有本提供方识别的（或全新的）文件才会被修改。
- **词法优先，向量可选。** 默认路径不需要网络、模型或密钥；向量路径仅在部署自带端点时激活，且每次嵌入失败都降级到词法排序而非让操作失败。
- **融合而非原始分数。** 由于 BM25 与余弦处于不可比的量纲，`reciprocalRankFusion` 按排名位置而非分数值合并两个序，因此不假设任何跨后端校准。
- **序列化的单一连接。** 所有工作经由一个打开的连接通过内部 promise 尾列执行，因此写入、召回与关闭绝不会交错出半成品状态。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、提供方、`remember`／`recall`／`forget`／`list`、嵌入断言、生命周期 |
| [`src/schema.ts`](src/schema.ts) | 受保护的仅属主打开、application-id 与版本重置、FTS5 与向量表创建 |
| [`src/query.ts`](src/query.ts) | draft／查询规范化、FTS5 文本净化、余弦相似度、倒数排名融合、向量编解码 |
| [`src/embedding.ts`](src/embedding.ts) | 可选的 OpenAI 兼容 HTTP embedder，在调用时读取 `authEnv` |
| — | 不发布运行时不变式伴生入口；打开的连接与 promise 尾列是私有实现状态，且该提供方不发布独立的生命周期事件流或可枚举快照。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享的记忆模型逐步进入 seam 与工具。

- [dsh-memory](../memory/README.zh.md)——该提供方注册到的 seam。
- [dsh-tool-memory](../tool-memory/README.zh.md)——基于该 seam 的面向模型工具。
- [memory 组地图](../README.zh.md)——五个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-memory` 间接影响；该工具呈现本提供方排名后的命中，而后端自身不贡献提示词或 schema。

#### KV Cache 影响

不会直接失效；请求前缀变更由 `dsh-tool-memory` 负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义提供方何时不适合或需要特别的运维照护。它们是当前包约束，不是任务积压。

- **默认词法**——没有 `config.embedding` 时，存储仅以 BM25 匹配文本与 token；概念性改述召回需要可选端点，且 DSH 绝不替部署选定嵌入提供方。
- **整个语料单一提供方**——该方称为一个存储文件声明整个 seam；没有多存储或部分语料路由，且一次只能有一个提供方持有 `ctx.memory`。
- **尽力而为的向量**——向量在记录提交之后写入，且任何嵌入失败仅告警，因此一条记忆可能在无向量的情况下存在；召回仍可词法工作，但融合覆盖对每条记录并无保证。
- **宿主文件系统写入，无沙箱**——该提供方用 `node:sqlite` 直接读写 `config.path` 并信任所挂载的执行世界；受限部署必须提供一个范围恰当的路径或一个受沙箱保护的宿主。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
