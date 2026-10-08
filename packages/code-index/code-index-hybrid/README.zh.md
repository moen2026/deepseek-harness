---
description: "ctx.codeIndex 的可选混合代码索引提供方：块感知分块、node:sqlite FTS5 上的 BM25，以及来自部署自备 OpenAI 兼容嵌入端点的向量，以倒数排名融合，供组合语义代码搜索的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-code-index-hybrid

[English](README.md) | 中文

## 概述

使用 `dsh-code-index-hybrid` 在部署自备嵌入端点时以块感知代码搜索支撑 `ctx.codeIndex`。在首次搜索时（或在启动时急切执行），它遍历工作区根，把每个有界文本文件打包为绝不切穿空行分隔块的块，在 `node:sqlite` 上写入 FTS5 表，并在端点已配置时为每块存储一个 float32 向量。一次规范化查询对 BM25 与端点嵌入分别排序，以倒数排名融合为片段渲染的命中；端点失败退化为词法路径，且每提供方至多警告一次。索引是受保护、仅属主文件中的派生数据，因此删除并重建始终安全。DSH 从不选择模型或嵌入提供方；被索引工作区的源码文本会发送到所配置端点，因此只将其指向可信处理该源码的服务。

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

当部署希望对其自身工作区进行语义代码搜索且已运行 OpenAI 兼容嵌入端点（例如 Ollama 服务 `qwen3-embedding`）时挂载此提供方。它需要 `dsh-code-index` seam，并且为让模型访问还需 `dsh-tool-code-index`；它通过宿主文件系统直接从 `config.root` 读取源码。未配置 `config.embedding` 时，提供方仍可挂载并对块感知分块提供纯 BM25 服务。

### 最小配置

`path` 是专用的派生索引文件（支持 `:memory:`），`root` 是要遍历并索引的绝对工作区。`embedding` 命名端点：`url`（OpenAI 兼容的 `/v1/embeddings` 形态）、`model`、`authEnv`（持有 bearer 令牌的环境变量，绝不是令牌本身）与 `dimension`。无鉴权端点仍需 `authEnv` 指向一个已设置的变量——例如一个占位值——因为凭据在调用时从该变量读取。

```yaml
- name: '@deepseek-ai/dsh-code-index'
- name: '@deepseek-ai/dsh-code-index-hybrid'
  config:
    path: .dsh/code-index-hybrid.sqlite
    root: .
    embedding:
      url: http://127.0.0.1:11434/v1/embeddings
      model: qwen3-embedding:0.6b
      authEnv: DSH_EMBEDDING_KEY
      dimension: 1024
- name: '@deepseek-ai/dsh-tool-code-index'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | 派生索引文件；缺失的文件系统路径以仅属主（`0o600`）方式创建；支持 `:memory:` |
| `root` | 必填 | 要遍历并索引的绝对工作区根 |
| `openAt` | `startup` | 在启动时，或在首次搜索时打开并调和 |
| `journalMode` | `wal` | SQLite 日志模式（经过验证的封闭联合，绝不是调用方可控的 SQL） |
| `defaultLimit` | `20` | 请求省略 `limit` 时的结果数量 |
| `maxLimit` | `200` | 可接受的最大页大小 |
| `snippetChars` | `240` | 片段最大长度（以 Unicode 码点计） |
| `chunkLines` | `40` | 每个索引块目标行数；超过此值的单个块被硬切 |
| `chunkOverlap` | `4` | 下一块重开的尾部行数；`0` 禁用重叠 |
| `maxFileBytes` | `1000000` | 单文件大小上限；更大的文件被跳过 |
| `maxFiles` | `20000` | 每次索引构建的文件总数上限 |
| `skipDirs` | `[]` | 在内建集合（`node_modules`、`.git` 等）之外额外跳过的目录名 |
| `includeGlobs` | `[]` | 非空时限定哪些相对路径被索引的 `*`/`?` glob |
| `excludeGlobs` | `[]` | 将相对路径排除出索引的 `*`/`?` glob |
| `embedding` | 缺省 | 部署自备的嵌入端点，启用向量路径；缺省即纯词法 |

每个数值边界在加载时都验证为正整数；`embedding` 块的 `url`、`model` 或 `authEnv` 为空白时在挂载时大声失败。二进制扩展名与含 NUL 的文件在遍历期间被跳过。

### 一次搜索做什么

在首次查询时，提供方打开受保护的数据库，遍历 `root`，把每个文件切分为块感知块（块边界绝不落在块内，除非该块自身超过 `chunkLines`，且下一块重开尾部 `chunkOverlap` 行），每块存储一行 FTS5，并在端点已配置时按块存储一个 float32 向量。一张指纹表只对大小或 mtime 变化的文件重新分块，并删除已消失的文件。`search()` 把查询规范化为单个惰性 FTS5 短语，用 `bm25()` 排序，嵌入查询文本，按余弦相似度为配置维度的每个已存向量打分，并以倒数排名融合两个次序——因此一个间隔开的转述也能召回它从未逐字拼出的复合标识符。索引或查询期间任何端点失败都退化为词法路径；失败期间索引的块只是不带向量。

### 可观察的成功与失败

成功的查询按相关性降序返回命中，携带 `path`、从 1 开始的 `startLine`/`endLine`、可选的 `language`、`score` 以及一个无标记的有界 `snippet`；空结果页是一次成功的无匹配响应。空或含 NUL 的查询、或超出范围的 `limit`，会以 `CODE_INDEX_INVALID_REQUEST` 失败。打开属于另一个应用、或含有无法识别表的文件时会大声失败而非重置它；版本不符会就地重置派生模式。释放之后，查询以 `CODE_INDEX_DISPOSED` 失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **块感知分块，绝不切穿块。** `chunkFile` 把空行分隔块打包到 `chunkLines`，并把重叠重开折叠进下一块的新内容，因此函数或段落保持完整，跨越边界的符号在两侧都被索引。
- **嵌入是部署能力，不是 DSH 选择。** 向量路径仅在 `config.embedding` 命名端点时存在；嵌入器与 `dsh-memory-sqlite` 导出的是同一个 HTTP 客户端，且 DSH 从不选择模型或提供方。
- **退化优于不可用。** 每次端点失败——索引或查询时——都退化为词法路径并每提供方警告一次，因此搜索离线仍可用。
- **派生数据，绝不权威。** 索引是受保护文件中一个可重建的缓存；指纹表让语料以增量方式调和，删除文件始终安全。
- **有界遍历。** 大小上限、文件总数上限、内建跳过目录集与二进制扩展表共同约束语料，因此一个无界工作区不会让索引失控。
- **惰性的查询文本。** 来自 `dsh-code-index-sqlite` 的共享 `normalizeSearch` 把调用方文本引为单个 FTS5 短语，因此查询语法保持为数据。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、提供方注册、遍历、调和、融合的 `search()` |
| [`src/schema.ts`](src/schema.ts) | 受保护的仅属主打开、application-id 与版本重置、FTS5 与向量表创建 |
| [`src/chunk.ts`](src/chunk.ts) | 带重叠的块感知分块 |
| — | 不发布运行时不变式伴生入口；打开的连接与调和尾列是私有实现状态，且该提供方不发布独立的生命周期事件流或可枚举快照。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享的搜索模型逐步进入 seam 与工具。

- [dsh-code-index](../code-index/README.zh.md)——该提供方注册到的 seam。
- [dsh-code-index-sqlite](../code-index-sqlite/README.zh.md)——离线姊妹提供方及本包复用的共享查询助手。
- [dsh-tool-code-index](../tool-code-index/README.zh.md)——基于该 seam 的面向模型工具。
- [code-index 组地图](../README.zh.md)——四个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-code-index` 间接影响；该工具呈现本提供方排名后的命中，而后端自身不贡献提示词或 schema。

#### KV Cache 影响

不会直接失效；请求前缀变更由 `dsh-tool-code-index` 负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义提供方何时不适合或需要特别的运维照护。它们是当前包约束，不是任务积压。

- **源码文本离开进程**——配置 `config.embedding` 后，被索引的源码文本与查询会发送到所配置端点；只将其指向可信处理该源码的服务，专有代码优先使用回环或私网部署。
- **全语料暴力向量**——每次查询在 JS 中为每个已存向量打分；大语料应调低 `maxFiles` 或嵌入维度。ANN 索引被推迟。
- **无鉴权端点需要占位变量**——共享嵌入器在调用时从 `authEnv` 读取 bearer 令牌，因此无鉴权的本地端点仍需 `authEnv` 指向一个已设置的变量；该头发送后被忽略。
- **全语料单一提供方**——该提供方为一个 `root` 声明整个 seam；一次只能有一个提供方持有 `ctx.codeIndex`。
- **调和粒度为单文件 mtime/size**——变更的文件会整块重新分块并重新嵌入；内容定义分块与增量子文件差异被推迟。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
