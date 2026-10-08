---
title: "@deepseek-ai/dsh-output-style"
description: "Deployment-wide output style section for the DeepSeek Harness"
kind: "package-reference"
---

# @deepseek-ai/dsh-output-style

[English](README.md) | 中文

## Summary

`dsh-output-style` 选择 agent 回答的呈现方式：部署或组合挂载这一行来注册 `deployment:output-style` 段落。内置风格分别是不追加行文（default）、要求简短的教学式补充说明（explanatory）、把小型实现步骤交还给用户（learning）；custom 风格则渲染该行自己的行文。agent 作用域可以遮蔽全局文本，修改该行配置会触发其重载，因此部署可以把输出风格暴露为用户可编辑的设置。人设描述 agent 是谁；这一行描述回答如何呈现。

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

在部署组合中挂载这一行为每个会话选择一个输出风格，或在 agent preset 内挂载为单个 agent 指定专属风格。这一行只依赖提示词注册表，凡是加载了 `dsh-system-prompt` 的地方都可以挂载。

### Configuration

```yaml
- name: '@deepseek-ai/dsh-output-style'
  config:
    style: explanatory
```

| Field | Default | Meaning |
|---|---|---|
| `style` | `default` | `default` 不追加行文；`explanatory` 追加简短的教学式补充说明；`learning` 把小型实现步骤交还给用户；`custom` 渲染 `customText` |
| `customText` | `''` | 自定义风格行文，`style` 为 `custom` 时必填且不能为空；严格的 `{{variable}}` 模板 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-output-style)是每个受支持字段及其 JSDoc 的穷尽式真源。

### Output style behavior

这一行为挂载作用域注册一个名为 `deployment:output-style` 的段落。agent 作用域遮蔽全局文本的方式与 `dsh-persona` 遮蔽人设行相同，卸载挂载 fiber 即恢复原状。`style: custom` 且 `customText` 为空在加载时明确报错——没有行文的风格是配置错误，而不是静默空操作。内置行文固定不变；`customText` 与其他段落一样严格插值提示词变量。

### When to use it

当用户或部署需要选择回答的呈现方式而又不必自己编写行文时，使用这一行。不属于可选风格的部署级语气指引应放进人设行或 agent 指令。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### How the row registers

这一行使用注册表共享的槽位名和 `DEPLOYMENT_OUTPUT_STYLE` 位置注册一个带作用域的段落。注册表拥有排序、插值、遮蔽与卸载；该行在注册时一次性解析内置或自定义行文。

### The deployment slot

与人设行不同，这个槽位没有注册表自有的默认值：该行在挂载处拥有 `deployment:output-style`。全局挂载承载部署的选择；带作用域的挂载为该 agent 遮蔽它；同一作用域内挂载两个会在段落名上相撞并明确报错。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` 模式、内置风格行文、输出风格段落注册 |
| — | 不发布运行时不变量伴生文件；该行不拥有事件流或可变运行时数据——它只注册一个提示词段落，排序、插值、遮蔽与卸载均由提示词注册表拥有。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

当包级契约不够用时阅读这些页面；它们从 preset 组合走向这一行所服务的提示词注册表。

- [agent-presets 包](../agent-preset-registry/README.zh.md)——这一行挂载进的 preset 组合。
- [System prompt 子系统](../../../docs/subsystems/system-prompt.zh.md)——段落、装配，以及带作用域段落如何遮蔽全局段落。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-output-style)——每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## Model Experience

### The output-style section

#### What the model sees

`deployment:output-style` 段落位于位置 `10150`，携带所选风格，处于第一方指引与本地界面段落之后、人设后缀之前。`default` 注册空文本，渲染时被丢弃。`explanatory` 与 `learning` 注册各自的固定行文；`custom` 注册 `customText`，提示词变量在渲染时解析。

#### Token effect

对给定风格固定：挂载作用域内每个请求都携带内置或自定义 token，`default` 则一个都没有。带作用域的挂载只为该 agent 追加其 token。

#### KV Cache effect

靠后位置：该段落位于工具指引与本地界面段落之后，风格变更只重写提示词尾部，先前的指引保持缓存稳定。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


这些限制定义了该行何时不再适用。它们是当前的包约束，不是任务清单。

- **每个作用域一个槽位**——段落名在作用域内唯一；同一作用域内两个输出风格行会相撞并明确报错。给第二个 agent 它自己的作用域，而不是第二个全局行。
- **不支持会话内切换**——风格在该行配置变更、其 fiber 重载时变化；没有工具或事件能在会话中途切换它。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
