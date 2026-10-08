---
description: "记忆 seam 上的轮次结束反思：每个完成的轮次一次辅助模型调用，从该轮次的人与助手文本中抽取持久偏好、风格指引与项目事实，校验后的候选默认经用户批准（`write: 'ask'`）或直接（`write: 'auto'`）写回 `ctx.memory`，供组合长期个性化能力的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-reflection

[English](README.md) | 中文

## 概述

`dsh-memory-reflection` 从日常工作中收获持久记忆：每个完成的根会话轮次之后，一次辅助模型调用读取该轮次的人与助手文本并返回候选，插件校验后经 `ctx.memory` 写回，打上 `reflection` 标签并按 namespace 分类。未通过安全扫描（`scanUntrustedText`）的候选在审批前即被丢弃。写入路径默认先询问用户（`write: 'ask'`），也可直接写入（`write: 'auto'`）。模型可见的确切请求与记录的结果都是会话事件，因此每次反思都可从日志重建。提供方或路由缺位时反思静默停止，任何抽取失败都绝不使轮次失败。该包运行时注入 `llm` 与 `memory`。

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

在希望持久偏好、风格指引与项目事实无需用户开口即可积累的会话上挂载此插件。它观察每个根会话的 `turn/start`、`user/message`、`assistant/message` 与 `turn/end`：轮次中人类撰写与助手生成的文本被缓冲，并在 `turn/end` 时由插件在后台反思——已完成的轮次绝不被抽取延迟或致其失败。子会话共享根的轮次并被跳过。

### 反思调用

每个符合条件的轮次一次辅助请求，发送固定抽取指令加上以 JSON 数组框定的该轮次消息，通过保留最新消息钳制到 `maxInputBytes`（超大的最后一条消息被截断而非丢弃）。路由为配置的 `provider`/`model` 对（若存在），否则为会话已记录的 `request/header` 路由。应答被容错解析：容忍一个 JSON 对象周围的散文，至多接受十个候选，无法分类的 namespace 默认为 `fact`，缺失或无效的 confidence 默认为 `0.7`。空白或无法解析的应答不产生候选也不写入。

### 写入候选

`write: 'ask'`（默认）时，插件通过 user-questions 服务请用户选择 `Save` 或 `Discard`，并列出候选文本；`write: 'auto'` 时立即写入。写入的记忆携带候选的文本、namespace 与 confidence，外加 `reflection` 标签。抽取到候选时，写入路径在会话上记录 `memory/reflection`，结果为 `written`（带分配的 id）、`rejected` 或 `unavailable`；确切请求在派发前记录为 `memory/reflection-llm-request`。不产生候选的轮次不记录任何内容。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `write` | `ask` | 询问用户批准候选，或 `auto` 直接写入 |
| `provider` / `model` | 会话路由 | 辅助调用的显式路由；必须成对提供 |
| `timeoutMs` | `30000` | 端到端反思调用的截止时间（毫秒） |
| `maxOutputTokens` | `512` | 反思输出 token 上限 |
| `maxInputBytes` | `32768` | 最终 JSON 框定用户提示词的最大 UTF-8 字节数 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory-reflection)是每个受支持字段的穷尽式真源。

### 失败与恢复

抽取在轮次之外独立运行：模型错误、超时或写入错误记录为告警，绝不让会话失败；一次反思仍在运行时到来的第二次轮次结束被丢弃而非排队。轮次不含文本、没有记忆提供方持有 seam（先以一条记录的探活列举检查）或没有可解析的路由时，反思不发起模型调用即停止。无法发出批准询问时——未挂载 user-questions 服务——记录 `unavailable` 且不写入。配置问题在加载时大声失败：未知键、非正边界与不成对的 `provider`/`model` 都被拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释反思背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计说明

- **轮次结束，而非每步。** 抽取每个完成的轮次运行一次，基于缓冲的人与助手文本，因此成本与延迟按轮次定界，部分交换绝不被抽取。
- **仅根会话。** `turn/start` 为没有父级的会话播种缓冲区；子会话共享根的轮次并被跳过。
- **每会话同时至多一次反思。** 有在途反思的会话丢弃新的轮次结束，因此重叠调用不会重复写入。
- **先探活再付费。** 在任何模型调用之前以一条记录的列举确认提供方持有 seam；没有提供方时反思零成本停止。
- **容错解析，封闭词汇。** `parseReflectionCandidates` 容忍一个 JSON 对象周围的散文，对空白或不合规应答不产生候选，无法分类的 namespace 默认为 `fact`，无效 confidence 默认为 `0.7`。
- **显式路由解析。** 配置的对优先；否则由会话已记录的请求路由应答；两者皆无时反思停止。
- **先记录后可见。** 确切请求在派发前追加为 `memory/reflection-llm-request`，每个写入路径结果追加为 `memory/reflection`。
- **分离的失败。** 整个反思被包裹：任何错误经插件 logger 告警一次，会话的在途标记在 `finally` 中释放。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置验证、会话事件缓冲、反思调用、批准、写回与事件 |
| [`src/extract.ts`](src/extract.ts) | 纯抽取策略：系统指令、框定与钳制、候选解析、路由解析、结束原因转换 |
| — | 不发布运行时不变式伴生入口；缓冲的轮次文本与在途标记是私有的按会话状态，两个会话事件构成可观察事件流。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从反思调用逐步进入 seam 与面向模型的表层。

- [dsh-memory](../memory/README.zh.md)——候选写入所经由的 seam。
- [dsh-memory-profile](../memory-profile/README.zh.md)——已存 `style` 记录的模型可见侧。
- [dsh-tool-memory](../tool-memory/README.zh.md)——同一存储上的面向模型工具。
- [memory 组地图](../README.zh.md)——五个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

### 辅助反思请求

#### 模型看到什么

一个完成的轮次之后，一次辅助请求携带固定抽取指令加上以 JSON 数组框定的该轮次人与助手文本；确切请求在派发前记录为 `memory/reflection-llm-request`，因此可从会话日志重建。指令如下：

##### 抽取指令

```markdown
You extract durable memories from one coding-assistant conversation turn.
Return only a JSON object of the form {"memories":[{"text":"...","namespace":"preference|fact|style","confidence":0.0}]} and no other prose.
Extract only durable user preferences, collaboration-style guidance, or project facts worth carrying into future sessions; skip transient details.
Return {"memories":[]} when nothing qualifies.
```

#### Token 影响

每个符合条件的轮次一次额外模型调用：输入由 `maxInputBytes` 定界，输出由 `maxOutputTokens`（默认 512）定界，整个调用由 `timeoutMs` 截止时间定界；辅助调用的 token 与主对话分离。

#### KV Cache 影响

抽取指令在每次反思中完全相同，因此其前缀可跨轮次复用；只有框定的 JSON 载荷变化，且主对话已缓存的前缀不受这个独立请求影响。

### 写回批准

#### 模型看到什么

没有本包自身的提示词或 schema 文本。`write` 为 `ask` 时，问题——`Save this extracted memory?` 或 `Save these N extracted memories?`，并列出候选文本——通过 user-questions 服务面向人类提出，候选仅在 `Save` 时写入。写入的记忆之后只能经由读取存储的表层触达模型，例如记忆画像注入的区段或 `memory_search`。

#### Token 影响

对辅助请求零 token 影响；批准门控的是存储写入而非增加生成。

#### KV Cache 影响

无；批准交换在本包所发模型请求之外。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义反思何时不适合。它们是当前包约束，不是任务积压。

- **仅轮次边界**——抽取在轮次完成后基于缓冲文本运行；永不完成的轮次绝不被反思，在反思在途时被丢弃的轮次结束会丢失而非排队。
- **默认门控写入**——`write: 'ask'` 让每个带候选的轮次停在人类应答上；无人值守的积累需要选择 `auto`。未挂载问题应答方时，候选以 `unavailable` 被丢弃。
- **受提供方与路由门控**——没有记忆提供方时反思在探活处停止；既无配置对也无已记录会话路由时它在调用前停止；两种情况都不使轮次失败也不记录结果。
- **每个符合条件的轮次一次辅助生成**——由 `maxInputBytes`、`maxOutputTokens` 与 `timeoutMs` 截止时间定界，但仍是主对话之上的真实成本。
- **单次抽取**——无法解析的应答直接不产生候选，每轮至多接受十个候选；没有重试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
