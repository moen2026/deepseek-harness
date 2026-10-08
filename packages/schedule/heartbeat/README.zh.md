---
description: "每会话心跳巡逻：一条周期性 Schedule 提醒，读取工作区心跳文件并处理其待办项。"
kind: "package-reference"
---

# @deepseek-ai/dsh-heartbeat

[English](README.md) | 中文

## Summary

心跳巡逻把一条周期性 Schedule 提醒变成对工作区的定期检查。模型通过 `heartbeat_enable` 启用巡逻；每次到期投递读取工作区心跳文件（默认 `HEARTBEAT.md`），处理其待办项，并把已完成项记录回文件。文件缺失或没有待办项时，仅回答 `HEARTBEAT_OK`，不做其他动作。

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

发行的 Web bundle 把这两个工具与 Schedule 一起挂载。会话只有在模型调用 `heartbeat_enable` 后才拥有巡逻；每个会话至多一条巡逻，`heartbeat_disable` 负责移除。`Config` 声明 `defaultIntervalSeconds`（默认 1800）、`maxIntervalSeconds`（默认 86400）和 `heartbeatPath`（默认 `HEARTBEAT.md`）；路径必须是不含父级段或 Windows 盘符的工作区相对路径，且默认间隔不得超过上限。配置错误在加载时拒绝插件。

| Tool | Meaning |
|---|---|
| `heartbeat_enable` | 用部署默认间隔或传入的 `interval_seconds` 为调用会话创建周期提醒；再次启用回答 `heartbeat_already_enabled`。 |
| `heartbeat_disable` | 删除调用会话的心跳提醒；已投递的心跳不会被撤回。 |

投递复用 Schedule 服务：提醒以普通周期 Schedule 投递进入原会话，持久化、重启恢复与计时都归 Schedule 所有。

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

本插件是对宿主工具注册表的一次普通 `apply(ctx, config)` 工具注册；它不拥有服务，也不拥有存储。巡逻身份是文本性的：存储任务的 prompt 以 `[HEARTBEAT]` 开头即属于巡逻，该前缀正是 `heartbeat_enable` 写入的前缀，因此身份无需新事件类型即可在会话日志重放中存续。`heartbeat_enable` 以 `invalid_rule` 拒绝非整数间隔，以 `frequency_too_high` 拒绝低于 60 秒下限或超出部署上限的间隔；Schedule 输入失败映射到其错误码，存储失败以不暴露内部信息的固定文本回答 `internal_error`。`heartbeat_disable` 删除调用会话的每条心跳标记任务，只报告确认删除的数量。

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Tool registration](src/index.ts) 定义两个工具、配置校验与提醒 prompt。
- [Schedule 子系统](../../../docs/subsystems/schedule.zh.md) 描述巡逻所乘用的投递机制。

<a id="model-experience"></a>
## Model Experience

### Tool schemas on root Agents

#### What the model sees

[生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-heartbeat) 包含 `heartbeat_enable` 与 `heartbeat_disable` 的描述与 schema，插件加载期间注册在宿主工具注册表上。

#### Token effect

两个 schema 在可用期间贡献固定的请求上下文 token。巡逻未启用不增加 schema token。

#### KV Cache effect

schema 不变则保持重复前缀。加载或卸载插件会改变请求前缀 token；provider 缓存可用性不在本包范围内。

### Tool results after management calls

#### What the model sees

启用成功返回 `{ id, interval_seconds, path }`，失败返回 `{ code, message }`（`invalid_rule`、`frequency_too_high` 或 `heartbeat_already_enabled`）。停用返回 `{ deleted, ids }`，会话没有巡逻时返回 `heartbeat_not_enabled`。不适合暴露的失败回答 `internal_error`。

#### Token effect

结果 token 取决于返回字段；无论成败都是单行 JSON。

#### KV Cache effect

工具结果追加到会话历史，不改写更早的模型可见消息。

### Heartbeat deliveries in the original Session

#### What the model sees

每次到期心跳以 user 角色的 Schedule 周期批次投递进入原会话，其 `reminder_prompt` 携带完整巡逻语义：读取配置的心跳文件，处理其待办项，处理完成后更新文件，文件缺失或没有待办项时精确回答 `HEARTBEAT_OK`。

#### Token effect

每次投递增加固定的 Schedule 批次框架与固定的心跳 prompt；prompt 不包含文件内容，文件内容经模型自身的文件工具读取进入。

#### KV Cache effect

投递追加到原会话历史，保留更早的消息内容。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 巡逻只在 Host 运行期间工作；Schedule 的投递保证与重启恢复原样适用，包括 flush 与确认之间崩溃后可能的重复投递。
- 心跳文件由模型通过自己的文件工具读取；本包不监听文件、不强制其格式，也不创建它。
- 巡逻身份是存储 prompt 的前缀，因此用 `schedule_update` 修改提醒文本会把巡逻改名到 `heartbeat_disable` 的识别范围之外，而用户自建且以 `[HEARTBEAT]` 开头的提醒也会被视为巡逻。
- 每次启用调用强制每会话一条巡逻；同一轮内两次并发启用可能都观察到尚无任务。
- `heartbeat_disable` 不撤回已在投递中的心跳。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
