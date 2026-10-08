---
description: "面向模型的 search_codebase 工具：对工作区已索引源码的一次只读全文搜索，带可选的 glob 与 language 精化，返回按相关性排序的行范围与片段，并在未挂载提供方时给出可操作的不可用应答，供组合模型代码搜索的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-code-index

[English](README.md) | 中文

## 概述

`dsh-tool-code-index` 为模型提供一个只读的 `search_codebase` 工具：一个必填的 `query` 加上可选的 `glob` 与 `language` 精化，返回对工作区已索引源码按相关性排序的行范围与片段。在挂载代码索引提供方之前它不可用；届时工具应答 `ok`，否则它返回一个可操作的"索引不可用"消息而非让会话失败，从而模型回退到 grep/glob/read。结果由 `maxResultChars` 定界。本包运行时只注入 `tools`、`codeIndex` 与 `systemPrompt`，不导入任何提供方。当你已知名称或文本但不知其所在文件时选择它。

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

当智能体已知某个标识符或短语但不知其在哪个文件、且已配置代码索引提供方时使用 `search_codebase`；该工具的提示词指引告诉它在索引不可用时回退到 grep/glob/read。

### 该工具

`search_codebase` 接收一个必填的 `query`（要匹配的文本或 token），加上可选的 `glob`（如 `packages/**/*.ts`）、`language`（如 `typescript`）与 `limit`。该工具会折叠 `query` 中的空白，丢弃空白的精化项，并在查询前把非正整数的 `limit` 作为可操作的参数错误拒绝。提供方选择、索引路径、工作区根、分块与结果上限都留在模型输入之外；它们属于所挂载的提供方。

### 模型收到什么

该工具返回一个封闭结果：`status` 为 `ok` 并带一个 `hits` 数组，或在没有提供方持有 seam 时为 `unavailable` 且 `hits` 数组为空。每条命中携带一个工作区相对 `path`、从 1 开始的 `startLine`/`endLine`、可选的 `language`、一个提供方 `score` 以及一个有界 `snippet`。渲染按分数最优优先，为每条命中输出一行 `path:startLine-endLine [language]  snippet`；空页渲染 `No matching code found.`。完整文本由 `maxResultChars` 定界，截断通知计入该上限之内。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxResultChars` | `16000` | 完整渲染结果的最大长度，包括截断通知 |
| `timeoutMs` | `120000` | 覆盖首次搜索调和与查询的工具调用超时预算 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-code-index)是每个受支持字段的穷尽式真源。

### 失败与恢复

来自 seam 的 `CODE_INDEX_UNAVAILABLE` 会被捕获并以 `status: 'unavailable'` 返回，因此会话继续运行。空 `query` 或格式错误的 `limit` 会呈现为框架报告给模型的参数错误。任何其他 `CodeIndexError`（无效请求、已释放的提供方）都以结构化工具错误传播，供模型读取并路由。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计说明

- **只做消费方。** 工具运行时只注入 `tools`、`codeIndex` 与 `systemPrompt`，不导入任何提供方，并且只把 `exec.signal` 传给 seam。
- **过 seam 前的参数规范化。** `parseSearchArgs` 去除首尾空白并折叠 `query`，把可选精化 trim 为"空白即省略"，并验证 `limit`，因此提供方收到规范请求，格式错误的输入是可操作错误而非崩溃。
- **可用性是数据，不是崩溃。** `execute` 路径捕获 code 为 `CODE_INDEX_UNAVAILABLE` 的 `CodeIndexError` 并返回 `{ status: 'unavailable', hits: [] }`；其他错误一律重新抛出，因此真正损坏的提供方仍会被呈现。
- **渲染结果透传。** `output.render` 把封闭结果映射为单个文本分片——`unavailable` 消息或 `formatHits(...)` 输出——因此原生渲染器看到的规范值与模型读取的完全相同。
- **并发安全的读取。** `isConcurrencySafe` 返回 `true`；工具不改变任何状态，且提供方自行序列化其调和。
- **通用搜索卡片呈现。** `presentSearchCall` 渲染 `{ card: 'generic', kind: 'search', title }` 视图，其标题携带查询；没有单一目标文件，因此不附加任何位置。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、提示词区段、`search_codebase` 注册与执行 |
| [`src/render.ts`](src/render.ts) | 纯参数验证、带结果上限的命中渲染、UI 呈现 |
| — | 不发布运行时不变式伴生入口；该无状态适配器提供一个工具和一个提示词区段，而查询生命周期与结果关系仍由它所组合的工具 seam 和 code-index seam 负责。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从面向模型的表层逐步进入 seam 与提供方。

- [dsh-code-index](../code-index/README.zh.md)——本工具查询的 seam。
- [dsh-code-index-sqlite](../code-index-sqlite/README.zh.md)——应答这些查询的提供方。
- [code-index 组地图](../README.zh.md)——三个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

一个系统提示词区段（first-party 顺序 2250）将代码索引定位于各搜索工具之间，文本如下：

##### 逐字指引

```markdown
Use search_codebase for lexical full-text search over the workspace's indexed source when you know names or text but not their files; it returns ranked line ranges with snippets. It is unavailable until a code-index provider is configured — then fall back to grep/glob/read. Narrow with glob (e.g. packages/**/*.ts) or language (e.g. typescript) and raise limit only when the first page is not enough.
```

#### Token 影响

插件处于活跃状态时，每次请求承担固定指引成本。

#### KV Cache 影响

只要插件 scope 与指引文本不变，前缀就保持稳定；激活或 dispose（资源释放）可能使从该区段起的复用失效。

### 工具 schema

#### 模型看到什么

模型会看到生成的 [`search_codebase` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-code-index)。

#### Token 影响

启用期间，每次请求承担固定 schema 成本；`timeoutMs` 预算绝不会发给模型。

#### KV Cache 影响

只要可见工具定义与顺序不变，前缀就保持稳定；注册生命周期或 scope 限制可能使从第一个变化的 schema token 起的复用失效。

### 结果

#### 模型看到什么

按 `score` 降序、每条命中一行 `path:startLine-endLine [language]  snippet`，由 `maxResultChars` 定界；空页则是一个独立的 `No matching code found.` 行；当没有挂载提供方时，结果是可操作的不可用消息而非错误。截断通知计入字符上限之内。

#### Token 影响

每个工具结果由 `maxResultChars` 定界；命中数量还额外受请求的 `limit` 与提供方的 `maxLimit` 约束。

#### KV Cache 影响

工具结果追加在已缓存的请求前缀之后，不会直接使其失效。

### UI 呈现

#### 模型看到什么

什么都没有。客户端渲染一个通用搜索卡片——`{ card: 'generic', kind: 'search', title }`——其标题携带查询；没有单一目标文件，因此不附加任何位置。

#### Token 影响

零直接 token 影响，因为渲染仅在客户端进行。

#### KV Cache 影响

无；UI 呈现在模型请求之外。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义工具何时不适合。它们是当前包约束，不是任务积压。

- **提供方门控可用性**——没有挂载代码索引提供方时，该工具始终返回不可用消息；它绝不自行构建索引，因此部署必须挂载 `dsh-code-index-sqlite`（或另一个提供方）才能得到真实结果。
- **提供方定义的排序**——该工具只呈现其提供方排名的内容（SQLite 提供方目前是 BM25 与本地哈希子词语义的融合）；转述召回是子词形态的，不是模型语义，且模型被引导回退到 grep/glob/read。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
