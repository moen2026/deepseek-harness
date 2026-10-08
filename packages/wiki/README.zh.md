---
description: "wiki 组地图：经 repo-wiki 接缝的仓库 wiki、其部署配置 LLM 路由的文件系统生成器，以及面向模型的 read_wiki 工具，面向导航本组的用户与维护者。"
kind: "package-group"
---

# wiki/ — 面向 agent 的仓库 wiki

[English](README.md) | 中文

## 概述

wiki 组为 agent 提供整合生成的仓库文档视图：`read_wiki` 列出页面（带每页 staleness）、返回一页完整 Markdown 或其标题大纲。使用 `repo-wiki-generator` 经部署配置的 LLM 路由从配置的源 glob 生成 wiki 到 `<root>/.dsh/wiki/`——可直接阅读并提交到 Git 供团队共享的普通 Markdown。共享的 `repo-wiki` 包保持页面词汇表（路径、标题、staleness、内容）提供方中立，且 staleness 只是元数据：源变化从不在读者背后重写页面。没有提供方挂载时本组不应答任何请求。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发注记](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`repo-wiki/`](repo-wiki/README.zh.md) | 定义仓库 wiki 服务：独占的单提供方保留与只读路由（getPage、listPages、outline） | `ctx.repoWiki` |
| [`repo-wiki-generator/`](repo-wiki-generator/README.zh.md) | 经部署配置的 LLM 路由从工作区源生成 Markdown 页面，并从 `<root>/.dsh/wiki/` 服务接缝 | 注册于 `ctx.repoWiki` |
| [`tool-repo-wiki/`](tool-repo-wiki/README.zh.md) | 经 `read_wiki` 把 wiki 暴露给模型 | 注册于 `ctx.tools` |

提供方生成并存储页面，不是工具：`tool-repo-wiki` 是模型可见名称、schema、提示词指引与呈现的唯一所有者，因此更换提供方不会改变模型请求 wiki 的方式。

-----

<a id="related-documentation"></a>
## 相关文档

- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-repo-wiki)——模型收到的 `read_wiki` schema。
- [仓库 wiki 子系统](../../docs/subsystems/repo-wiki.zh.md)——本组的注册面与三个包的组合方式。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>
