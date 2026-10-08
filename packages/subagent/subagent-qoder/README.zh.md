---
description: "面向用户与维护者的一次性 Qoder CLI subagent 提供方，用于选择产品后端、安装 Profile bundle 或配置无人值守的 Qoder 委派。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-subagent-qoder

[English](README.md) | 中文

## 概述

当委派工作需要在父会话工作区中的真实无人值守 Qoder 会话内运行时，把 `@deepseek-ai/dsh-subagent-qoder` 安装进 Profile。每次委派都会以 headless print 模式驱动锁定的包内 Qoder CLI，为一个自包含文本任务使用全新进程，并且只返回其最终答案或安全失败诊断。原生 Qoder 配置和身份验证继续作为权威来源，而 `permissionMode` 选择非交互式权限行为。Bundle 从锁定的包依赖解析自己的 CLI，但在配置委派工具之前不会向模型公开任何能力。

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

当委派应以父级工作区中的真实 Qoder 会话运行时，挂载本提供方。常用路径是显式的：把 Bundle 安装进 Profile，可选地配置提供方行，并通过委派工具行把它暴露给模型。

### 安装 Bundle

把包安装进目标 Profile，然后重启该 Profile。安装会把锁定的 `@qoder-ai/qodercli` 依赖带入 Profile 闭包；声明的 patch 层只注册休眠的提供方，不启动任何 Qoder 进程。

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-qoder
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-qoder
dsh --profile <name>
```

移除包后，下一次 Profile 启动会撤回提供方及其私有运行时闭包。安装决定 Host 可用性，而不是模型权限：模型只能通过你组合的委派工具行触达提供方。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `qoder` | `ctx.subagents` 上的非空注册名称；每个已挂载实例都需要唯一值 |
| `model` | Qoder 原生设置 | 为本提供方实例的每次运行固定的可选非空模型名称；省略时不发送 `--model` 覆盖 |
| `maxTurns` | Qoder 原生设置 | 可选的正整数轮次上限，应用于本提供方实例的每次运行 |
| `allowedTools` | Qoder 原生设置 | 为无人值守运行预先批准的可选工具名，作为单个 `--allowed-tools` 列表转发 |
| `disallowedTools` | Qoder 原生设置 | 为无人值守运行拒绝的可选工具名，作为单个 `--disallowed-tools` 列表转发 |
| `env` | `{}` | 叠加在已清理凭据的父环境之上的显式子进程环境 |
| `permissionMode` | `default` | 为本提供方实例的每次运行固定的原生非交互式权限行为 |
| `disposeGraceMs` | `3000` | 共享 managed-range owner 各终止层级之间的宽限 |

| `permissionMode` 值 | CLI 参数 | 原生行为 |
|---|---|---|
| `default` | 无 | headless 模式会自动拒绝交互式审批弹窗；必须写入的任务需要在 `allowedTools` 中列出其工具名 |
| `bypass` | `--yolo` | 跳过权限检查；必须显式选择该值 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-subagent-qoder)是每个受支持字段及其 JSDoc 的穷尽式真源。已配置的 `model` 会原样应用于每次运行；省略时保留原生模型选择。提供方不会发现模型、改写别名或设置 fallback。具有凭证特征的环境变量会在显式 `env` 覆盖生效前被移除，因此供子进程使用的个人访问令牌（`QODER_PERSONAL_ACCESS_TOKEN`）必须在该配置中显式提供。

### 暴露工具

每个委派工具行指名一个提供方，并需要独立的 `toolName`，因此模型看到的是静态工具，而不是动态提供方选择器。目前没有随附的 Agent Preset 暴露 `qoder`；在复制出的 preset 或你自己的组合中加入下面这样的行，即可暴露 `subagent_qoder`。

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'
- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'
- id: tool-subagent-qoder
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: qoder
    toolName: subagent_qoder
    backgroundMode: one-shot
    maxDepth: provider-managed
```

`one-shot` 策略会让省略 `run_in_background` 或传入 `false` 的调用继续在前台等待，而显式传入 `true` 会返回由父 agent 拥有的 Job id，供 `job_output` 或 `job_kill` 使用；base host（基础宿主）与完整 preset 已提供通用作业注册表和控制工具。

### 你会得到什么

前台调用会把选定的最终 Qoder 答案交给模型；运行失败时则返回带停止原因与可选安全诊断的错误。后台调用先返回 Job id；随后通用作业控制面会送达完成通知，并通过 `job_output` 公开同一最终答案或失败状态。Qoder 的中间轮次、工具活动、用量信息、原始 stderr 与原始 print 模式 JSON 绝不会进入父级会话。

### 失败与恢复

由非文本块组成的任务会在任何进程启动前失败，而没有工作目录的父会话会让启动以固定消息失败。缺失或损坏的锁定依赖会在 `spawn` 阶段以安全 `unknown` 类别失败；不存在宿主 CLI 回退。捕获结果中没有可用回复对象的运行会在干净退出后以 `invalid-result` 失败，在非零退出或收到信号时以 `process` 失败，而格式良好的产品错误回复（包括未登录会话）以 `product-error` 失败。每条诊断都会指明产品、阶段、类别以及任何已观测的退出码或信号，而不复制产品正文或 stderr；子级原始 stderr 只保留在 Host stderr。被取消的运行以 `aborted` 结算。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方如何以 headless print 模式驱动锁定的 Qoder CLI，以及可观察行为从何而来；完整约定见[使用本包](#use-this-package)。

### 设计理念

- **每个部署一个锁定的包内 CLI。** 命令通过 `@qoder-ai/qodercli` 自身清单的 `bin` 条目从其包依赖闭包解析，而绝不使用宿主 `PATH`，因此已安装的名称相近的 IDE 启动器永远不会被选中。
- **每次运行一个全新进程。** 每次运行都会 spawn 全新的 headless print 模式进程并恰好执行一个任务；没有续接、恢复或池化。
- **任务经由 stdin 传递。** 提示词作为 stdin 数据投递，因此没有任何任务文本进入命令行或进程列表。
- **原生配置与身份验证是权威。** 登录状态、模型选择及其余产品设置保持原生；提供方只覆盖可选模型、轮次上限、工具列表、权限行为和显式环境叠加。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：config schema、提供方注册 |
| [`src/run.ts`](src/run.ts) | 运行生命周期、spawn、回复结算与诊断 |
| [`src/cli.ts`](src/cli.ts) | 锁定命令解析、headless 参数构建、任务归一化与 JSON 回复解析 |
| [`cordis.patch.yml`](cordis.patch.yml) | 注册休眠提供方的 Profile patch 层 |

### 运行流程

一次启动只接受非空的文本块序列，并根据父会话确定子级 cwd。它经子进程 seam spawn 固定命令——`--print --output-format json` 加上任何已配置的模型、轮次上限、工具列表与 bypass 标志——并把任务放在 stdin 上，按 16 MiB 上限收集 stdout，然后解析捕获中最外层的 JSON 对象；边界扫描可以容忍 CLI 首次在 Windows 上运行时可能混入的一次性设置提示。解析出的回复会结算为携带答案文本的 `completed`、产品在 token 上限处停止时的 `max-tokens`，或失败：格式良好的 `is_error` 回复为 `product-error`，干净退出但没有可用答案为 `invalid-result`，非零退出、收到信号或进程结果被拒绝为 `process`。取消会终止子进程并以 `aborted` 结算；dispose 会终止并在共享宽限下等待整个范围静止。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从本提供方逐步进入它接入的 seam 与兄弟产品提供方。

- [Subagent 子系统](../../../docs/subsystems/subagent.zh.md)——服务约定、提供方约定与终态结果语义。
- [dsh-subagent seam](../subagent/README.zh.md)——本提供方注册于其上的注册表与启动 API。
- [Codex subagent 提供方](../subagent-codex/README.zh.md)——经官方 app-server 协议的兄弟产品后端。
- [Claude Code subagent 提供方](../subagent-claude-code/README.zh.md)——经官方 Agent SDK 的兄弟产品后端。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-subagent-qoder)——每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 子级请求

#### 模型看到什么

Qoder 子级会在一个全新进程中，以单个 headless print 模式任务接收这些独立文本块。它的工作区是父会话 cwd；所选提供方实例会固定已配置的模型、轮次上限、工具列表、环境与权限行为，而身份验证及其余产品设置来自 Qoder 原生配置与显式环境。可执行文件版本来自锁定的包内依赖。

#### Token 影响

子级需为独立的 Qoder 上下文和轮次承担 token 成本。子级 token 不会进入父级上下文。

#### KV Cache 影响

与父级请求缓存相互独立。能否复用只取决于 Qoder 自身的提供方、模型、指令、工具和 print 模式请求。

### 父级调度与结果（间接）

#### 模型看到什么

通过 `dsh-tool-subagent`，前台调用会让父级模型看到选定的 Qoder 最终答案；若结果未完成，错误中会包含终止原因和可选的安全诊断。该诊断可以区分粗粒度阶段、类别以及任何已观测的退出码或信号，而不复制产品正文或 stderr。后台调用会先返回 Job id；随后通用作业控制面会送达完成通知，通过 `job_output` 公开同一最终答案或失败状态详情，并允许 `job_kill` 请求取消。Qoder 的中间轮次、工具活动、原始 stderr、用量信息、产品标识符和协议载荷均不会复制到父会话。

#### Token 影响

前台输入会增加工具结果中保留的最终答案或错误内容。后台输入还会包含启动确认、完成通知，以及 `job_output`、`job_kill` 或后续状态结果；子任务 token 仍不会进入父级上下文。本提供方自身不添加父级工具 schema。

#### KV Cache 影响

仅追加：前台会在可复用的父请求前缀后增加一个结果，后台则会继续追加 Job 启动确认、通知以及后续控制或收集结果。后台调度可能增加一个由通知唤醒的轮次，但这些消息都不会改写更早的前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本提供方何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是通用 Qoder 对比或任务积压。

- **每次运行均新建一个进程**——不支持续接、恢复、池化、进度流或产品会话持久化。print 模式回复携带一个 `session_id`，未来可能的续接可以消费它，但目前没有任何代码读取它。
- **静态选择实例**——Profile 配置项固定提供方名称、可选模型与工具绑定；调用无法动态选择或修改提供方与模型，而且每个公开工具都需要唯一的 `toolName`。
- **身份验证仍由原生机制管理**——Bundle 会提供 CLI，但不会创建账户、登录或刷新令牌；未登录的子级会以 `product-error` 公开，供子进程使用的令牌必须通过显式 `env` 叠加送达，因为具有凭证特征的环境变量会被清理。
- **headless 审批会被自动拒绝**——print 模式拒绝交互式审批弹窗，因此必须写入的任务需要把其工具名经 `allowedTools` 预先批准，或显式选择 `bypass` 模式。
- **Windows 首次运行可能把设置提示混入 stdout**——一次性 Git Bash 设置提示会先于回复对象出现；边界扫描可以容忍它，这反映的是产品设置步骤而不是提供方状态。
- **兼容性由开发证据锁定**——已验证基线为 `@qoder-ai/qodercli@1.1.65`；升级需要重新录制 CLI 回复 fixture 并重新运行无密钥解析测试。
- **assistant 载荷仅包含最终文本**——失败运行可以额外公开独立的安全诊断；中间轮次、工具通信、用量信息、原始 stderr 和原始 print 模式 JSON 不会进入父会话。
- **没有可选的共享能力**——对于本提供方，共享服务会拒绝 `agentOptions`、输出 schema、子任务角色设定、工具筛选和 harness 深度强制约束。
- **没有按实际经过时间触发的超时或副作用回滚**——长时间运行的工作由调用方取消，且取消前已更改的文件或外部系统不会恢复原状。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为与限制以上文和包代码为准。

- **载荷体积披露**——锁定依赖解包后约 68 MB，共 30 个文件；这些是披露数字，不是安装阈值。
- **版本锁定的回复 schema**——回复 fixture 录制自 `@qoder-ai/qodercli@1.1.65` 的 print 模式输出；超出有界键余量的上游回复变化需要重新录制它们。
- **Profile loader 端到端覆盖暂缓**——解析层由无密钥 fixture 覆盖，接线由针对真实服务的单元测试覆盖；尚未添加 Profile loader 端到端运行。

</details>

**运行时不变式：** 不发布伴生入口。生命周期配对属于共享 subagent service，受管范围的所有权属于 subprocess service。
