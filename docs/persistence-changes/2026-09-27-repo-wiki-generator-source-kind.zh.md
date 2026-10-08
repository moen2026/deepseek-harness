---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-27-repo-wiki-generator-source-kind

[English](2026-09-27-repo-wiki-generator-source-kind.md) | 中文

## 概述

新增 `dsh-repo-wiki-generator` 消息源 kind：仓库 wiki 生成流水线中的页面生成提示词携带显式的来源归因。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-27-repo-wiki-generator-source-kind
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "8a250f1bffe1987f17208cb1adb112574b525d2af3623abc83a319edd71ed82a"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "69d8f2d2ea43a7e41b74d49bdc707771fc80e5c4217c2873813219a0ad7e4400"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "f72b4d4854f1b3f1fc36c53e2a5d9582b55bc1f39e38ebb21c26c67a9d3fac6a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "66fc84f350891800c645b093f222396c35a0204a76f4c7d0cef0e20cae73d7a1"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新 kind 只扩展消息源槽位上显式限定的归因并集；既有 kind 及其支持的策略不变，因此不会重写任何已记录数据，Session 头保持 V4。拒绝未知归因 kind 的读取方是唯一受影响面。

<a id="verification"></a>
## 验证

生成的持久化目录对与 schema 清单已重新生成；分类器在相同支持策略下接受新增的归因 kind，双语记录对验证一致。

<a id="dev-note"></a>
## 开发备注

无。
