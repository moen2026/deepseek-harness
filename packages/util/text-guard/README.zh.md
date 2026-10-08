---
description: "在不可信文本进入持久化模型上下文前进行安全扫描：隐形 Unicode 检测、双语提示注入模式、凭据形状令牌（结论脱敏）。"
kind: "package-library"
---

# @deepseek-ai/dsh-text-guard

[English](README.md) | 中文

## 摘要

`dsh-text-guard` 在不可信文本被持久化进模型可见上下文（长期记忆、agent 自写技能文件）之前进行扫描，报告三类发现：隐形或双向重排 Unicode、窄口径的双语提示注入模式、凭据形状的令牌。发现内容永不回显机密：凭据匹配只保留提供方前缀加体长，隐形 Unicode 的详情只列码点，不复制周围文本。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在每个"不可信文本变为模型可见上下文"的写入点调用 `scanUntrustedText`。发现即拒绝或脱敏的理由；拒绝策略由调用方持有。

```ts
import { scanUntrustedText } from '@deepseek-ai/dsh-text-guard'

const findings = scanUntrustedText(candidate.text)
if (findings.length > 0) return reject(findings)   // or drop the candidate and log
```

干净文本返回 `[]`。每条发现带 `kind`（`invisible-unicode`、`injection-pattern`、`credential-like`）与有界、脱敏的 `detail`，可直接记录或展示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

模块是三张模式表之上的一个纯函数。隐形 Unicode 覆盖零宽字符、双向标记与覆盖符（U+200B–U+200F、U+202A–U+202E）、词连接符（U+2060–U+2064）、字节序标记与 Unicode 标签字符（U+E0000–U+E007F）。注入模式为英文与中文中"指令动词 + 指令对象"的短语锚定对，刻意收窄使普通技术散文永不命中。凭据模式要求提供方特有前缀（`sk-`、`ghp_`、`github_pat_`、`AKIA…`、`xox…-`、`eyJ…` JWT、PEM 私钥头）加长体，短的形似标识符可通过。每类聚合为一条发现，保持输出有界。

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

- **建议性而非保证** —— 干净的扫描不证明文本安全；这些模式类之外的刻意夹带无法检出。
- **不做归一化** —— 同形字与 Unicode 归一化夹带不在范围内；仅检测上述字面码点类。
- **无 I/O、无策略** —— 模块从不读取、写入或决策；拒绝、脱敏与日志由消费方持有。
