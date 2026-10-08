---
description: "记忆 seam 上的轮次边界协作风格画像注入：读取已保存的 `style` 记忆并将其作为 system-prompt 区段贡献给运行时上下文，使持久的用户偏好跨轮次与跨会话生效；在加载时与每次轮次结束后重读，未挂载提供方时不贡献任何内容，供组合长期个性化能力的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-profile

[English](README.md) | 中文

## 概述

`dsh-memory-profile` 把记忆 seam 的 `style` 记录转化为常驻指引：它列举最新保存的风格记忆并把它们作为运行时上下文区段贡献出去，模型无需工具调用即可跨轮次与会话应用持久的协作偏好。提供方缺位或读取失败时不贡献任何内容并保留上一次成功的文本，模型可见性经由常规运行时上下文机制，因此每个注入的快照都在能影响请求之前记录进会话日志。该包运行时只注入 `memory` 与 `systemPrompt`，绝不写入存储。

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

在已保存的协作风格记忆应当塑造模型行为的地方挂载此插件。该插件只读取 `ctx.memory`：面向模型的写入路径是 `dsh-tool-memory` 的 `memory_write` 配 `namespace: 'style'`，而 `dsh-memory-reflection` 可能提出它们。

### 注入的区段

插件在加载时与每次轮次结束后刷新其快照，按提供方的列举顺序（最近优先）列举至多 `maxItems` 条风格记录，渲染一行固定表头加每条记录一个 `- ` 条目。空存储、提供方缺位或读取失败都不渲染任何内容；读取失败保留上一次成功的文本，而不是让区段抖动为空。区段文本在请求组装时求值，因此在一轮已运行期间落地的刷新从下一个请求起生效。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxItems` | `20` | 单个快照注入的风格记忆数量上限 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory-profile)是每个受支持字段的穷尽式真源。

### 失败与恢复

非正整数的 `maxItems` 在加载时失败，因此误配置会大声失败。读取失败——未挂载提供方、已释放的提供方、I/O 错误——会被吸收：插件保留上一次成功的文本并在下一个轮次结束时重试，因此瞬时的提供方故障绝不破坏一轮，也绝不排空前一个已注入的区段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释该插件背后的设计决策并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计说明

- **只做消费方。** 插件运行时只注入 `memory` 与 `systemPrompt`；它不写入任何内容，也不导入任何提供方。
- **带闩锁的轮次边界刷新。** 在一次刷新进行中启动的刷新会被跳过，因此一串轮次结束不会堆叠列举；最新完成的读取替换缓存文本。
- **读取失败保留上次成功结果。** 刷新捕获所有读取错误并不触碰缓存文本，因此瞬时的提供方故障不会让注入的区段抖动为空。
- **纯渲染。** `renderProfile` 对空列举返回 `''`，否则返回固定表头加每条记录一个条目，因此注入的文本是所列记录的纯函数。
- **先记录后可见。** 文本经由 `memory:profile` 下的常规运行时上下文机制提供，因此每个快照都在能影响请求之前记录进会话日志。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置验证、`renderProfile`、刷新闩锁与上下文注册 |
| — | 不发布运行时不变式伴生入口；该插件只拥有一个缓存字符串和一个读取闩锁，因此没有可独立比较的生命周期事件流或可枚举快照。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从注入的区段逐步进入 seam 与存储。

- [dsh-memory](../memory/README.zh.md)——该插件读取的 seam。
- [dsh-memory-sqlite](../memory-sqlite/README.zh.md)——应答列举的提供方。
- [dsh-tool-memory](../tool-memory/README.zh.md)——`style` 记忆的面向模型写入路径。
- [memory 组地图](../README.zh.md)——五个包的家族及其相关文档。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词上下文

#### 模型看到什么

一个运行时上下文区段（first-party 顺序 125，名称 `memory:profile`）承载已保存的协作风格记忆。至少有一条已存记录时，它渲染表头行加每条记录一个条目，最近优先：

##### 渲染的区段

```markdown
Saved collaboration style preferences for this user. Apply them unless the current task says otherwise:
- <style memory text>
```

#### Token 影响

一行表头加每条注入记录一个短条目，每个轮次结束至多重算一次；没有已存风格记忆时渲染文本为空。

#### KV Cache 影响

该区段位于系统提示词中靠前的位置（first-party 顺序 125），在两次刷新之间保持稳定；保存或遗忘一条 `style` 记忆会在下一个轮次边界改变它，从而使从该区段起的前缀复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义该插件何时不适合。它们是当前包约束，不是任务积压。

- **仅 `style` namespace**——画像只注入分类为 `style` 的记录；`preference` 与 `fact` 记录仍可经由 `memory_search` 触达，绝不自动注入。
- **轮次边界陈旧性**——刷新在加载时与每轮结束时落地，因此一轮中途写入的风格记忆先出现在下一个快照中，失败的读取要等到下一个轮次结束才重试。
- **受提供方门控**——未挂载记忆提供方时插件不贡献任何内容；它绝不回退到其他存储。
- **仅最新 `maxItems` 条**——快照在配置上限内列举提供方最新的记录，因此超出上限的风格记忆不会被注入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
