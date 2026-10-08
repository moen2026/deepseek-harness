# Agent Note：生成的仓库 wiki

Status: implemented

[English](2026-09-27-repo-wiki-generated-documentation.md) | 中文

## 问题

模型经常被问及仓库的架构、包与文档化行为，而每个答案都要通过词法检索与文件读取从源码重新推导全貌。`code-index` 让检索便宜但返回的是碎片，不是整合视图；harness 中没有任何东西维护一份可读、可团队共享的摘要供模型在重新推导前查阅。Qoder 对齐（路线图 A1）要求一个仓库 wiki：生成的页面整合已文档化的结构，以只读方式服务给模型，且永不在读者背后变化。

## 决策

仓库 wiki 以标准三层家族落地在新的 `packages/wiki` 组：[dsh-repo-wiki](../../../../packages/wiki/repo-wiki) 接缝（`ctx.repoWiki`：单提供方保留加作用于 wiki 相对 `.md` 路径的只读 `getPage`/`listPages`/`outline` 路由）、[dsh-repo-wiki-generator](../../../../packages/wiki/repo-wiki-generator) 提供方，以及 [dsh-tool-repo-wiki](../../../../packages/wiki/tool-repo-wiki) 消费者（`read_wiki` 工具加一个位于一方 order 2260 的系统提示词节，告诉模型在重新推导架构答案前先查 wiki）。

两个决策定义了提供方与读者的合同：

- **staleness 是元数据，永不是触发器。** 每页生成的页面携带记录其源路径与生成时指纹（size 加 mtime）的 front matter。读取把指纹与源当前 stat 比较；不匹配以 `stale: true` 连同未变内容一起读回。没有任何东西因为源变化而重写页面——重新生成只在一轮显式运行时发生，因此 wiki 在模型的 `listPages` 与 `getPage` 之间永不变化。
- **自描述页面的普通 Markdown。** 页面存放在 `<root>/.dsh/wiki/` 下，是 front matter 为唯一记账的普通 `.md` 文件——没有数据库、没有旁表——因此 wiki 可直接阅读，并可提交到 Git 供团队共享，与 Qoder 的 `.qoder/repowiki` 定位对齐。

`full` preset 挂载一个隔离的 `repo-wiki` 组：接缝与工具始终加载，生成器只在部署配置了生成路由（`DSH_WIKI_LLM_PROVIDER` 与 `DSH_WIKI_MODEL`）时加载；没有提供方时工具以模型可上报、可行动的"unavailable"形式应答。

## 已考虑的替代方案

**源变化时重新生成页面。** 指纹失配时自动重写会让页面保持新鲜，但破坏读取稳定性：先列出页面再读其一的模型可能看到 wiki 在其脚下变化。staleness 元数据把重新生成保留为显式的、需选择加入的行为。

**把 staleness 存到旁路数据库。** `node:sqlite` 指纹表会把状态机藏在 harness 内部，并使 wiki 目录不可移植；front matter 让每页自描述，团队共享变成一次普通 Git 提交。

**读取时从 `code-index` 派生 wiki。** 按需合成来服务页面会把每次读取与一次 LLM 调用耦合，并使结果跨调用不确定；预生成让读取便宜、确定且离线可用。

## 后果

- 设置了两个 wiki 环境变量的部署会得到生成的 wiki 与可召回它的 `read_wiki` 工具；没有它们时工具应答"unavailable"，会话继续。
- 生成的页面可提交并共享；源已变化的页面以 stale 读回，直到有人运行一轮重新生成。
- `docs/subsystems/repo-wiki.md` 获得生成的 Cordis API 节；`read_wiki` 在 `docs/tool-catalog.md` 中编目，其系统提示词节位于一方 order 2260。
