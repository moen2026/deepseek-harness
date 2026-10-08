# Agent Note: VM execution world

Status: proposed

[English](2026-10-02-vm-execution-world.md) | 中文

## Problem

[沙箱 seam](../../implemented/feature/2026-07-06-sandbox.zh.md) 只约束与宿主共享文件系统和内核的子进程，[SSH 家族](../../implemented/architecture/2026-09-11-posix-ssh-runtime.zh.md)能交付远程 POSIX 世界——但只面向部署方已经拥有的主机，需要手工安装的 helper 与摘要钉住。没有任何东西能为一个任务开通一台隔离机器：创建、快照、恢复、暂停、销毁。agent 完全不应触碰任何宿主的工作负载——不可信代码评估、一次性演示环境、多租户服务——没有路径，而对标产品恰恰为这些场景提供 VM 后端的执行。

## Proposal

VM 世界遵循沙箱笔记已经写明的替换规则：它**不是** `ctx.sandbox` 的后端。它提供一个环境一致的提供方组，替换一个活跃世界内 `ctx.shell`、`ctx.fs`、`ctx.subprocess`、`ctx.terminals` 与沙箱 seam 的 Service Provider——这正是既有笔记指名的唯一合法集成形态。

新建家族 `packages/vm/`：一个拥有生命周期词汇的 `vm` seam——开通世界、快照、恢复、销毁、带 keepalive 的租约、状态上报——每种宿主技术一个 `vm-<backend>` 提供方，以及把 VM 的提供方接进一个 Session 组合的世界装配层。第一个后端在 QEMU 类 microVM 与 OCI 容器之间是开放问题；seam 的词汇不得预设其中任何一种。模型可见的工具不变：bash、fs、terminal 工具透明地指向活跃世界，agent 无法从工具表面分辨 VM 世界与本地世界。

快照是 VM 家族自己的持久状态，在 Session 日志之外；Session 以 branded id 引用其世界，并在世界丢失时如实记录而不虚构恢复。住在 Host 上的文件系统接缝（`ctx.browserUse`、附件、deliverables）留在 Host——VM 世界替换的是执行组，不是整个应用。

### Lifecycle and ownership

默认所有权是一个 Session 一个世界；预热世界共享池是同一 seam 之后的后续优化。租约过期与 Session 释放以完全相同的方式销毁世界，恢复总是产出一个只含快照文件系统、不继承任何进程的新世界。

## Alternatives considered

**把 VM 做成 `ctx.sandbox` 后端。**否决——割裂世界规则：bash 在 VM 里受限而 fs 工具写宿主，正是沙箱笔记排除的不一致形态。

**只用 OCI 容器。**否决其作为 seam 的定义：容器共享宿主内核，预设容器的 seam 未来无法获得 microVM 后端。容器保留为首个后端的候选。

**在 SSH 家族上加自动开通。**否决：SSH 按设计假设主机预先存在——部署方所有的别名、摘要钉住的 helper——自动开通会把另一种信任模型塞进同一配置表面。

**采用远程执行器服务 API。**否决其作为 seam：这类服务沙箱的是单条命令，不是共同拥有 shell、fs 与 terminal 的环境一致世界。合规的服务最多可以成为某个后端提供方。

## Acceptance criteria

- 一个组合可以运行 bash、fs、terminal 工具全部观察 VM 文件系统的 Session；宿主文件从不出现在 VM 世界，VM 文件从不出现在宿主。
- 销毁与租约过期拆除世界，Session 记录世界的丢失而不是向它重试。
- 恢复快照产出一个只含快照文件系统、不继承任何进程的新世界。
- 未配置 VM 的部署完全不变，每个既有提供方仍可选择。

## Risks

冷启动延迟与每世界成本约束 Session 认领世界的激进程度，快照存储在缺乏保留策略时无限增长。VM 内的网络出站控制是 seam 不得夸大的承诺——沙箱笔记"仅文件操作"的诚实适用于整个世界。Windows 作为运行 VM 的宿主机是未解决的后端问题，且没有自动重连或重放，与 SSH 语义对齐。
