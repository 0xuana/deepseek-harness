---
description: "解析助手回答末尾用于提案卡片的 dsh-action 围栏 JSON 块，供卡片实验和聊天渲染共用。"
kind: "package-library"
---

# @deepseek-ai/dsh-util-action-block

[English](README.md) | 中文

## 概述

调用方可以把助手回答里的 `dsh-action` 围栏块读成已解析的 JSON 对象，并辨认每个块声明的动作。本包只拥有围栏语法；每个卡片实验各自校验自己的块字段，并决定一个块何时成为卡片。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 读取回答里的块

`actionBlocksOf(text)` 按回答顺序返回每个 ```` ```dsh-action ```` 围栏内格式正确的 JSON 对象。JSON 错误、数组或标量的围栏不产生任何块；其他围栏语言被忽略。每个对象的字段由拥有该动作的 schema 校验。

```ts
import { actionBlocksOf, actionOf } from '@deepseek-ai/dsh-util-action-block'

declare const answerText: string

const blocks = actionBlocksOf(answerText)
const mine = blocks.filter(block => actionOf(block) === 'create_personalized_page')
const foreign = blocks.some(block => actionOf(block) !== undefined && actionOf(block) !== 'create_personalized_page')
```

### 区分动作

`actionOf(block)` 返回已解析块的非空 `action` 字符串，否则返回 `undefined`。投影用它找出自己的块，并察觉同一回答里还带着另一个实验的块，而不必知道那个实验的 schema。

### 隐藏围栏

`ACTION_BLOCK_LANGUAGE` 是围栏语言。聊天渲染把这种语言的围栏从渲染后的回答里隐藏；轨迹视图保留原文。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

一个全局正则匹配每个信息串以 `dsh-action` 开头的围栏；围栏行之间的正文去掉首尾空白后交给 `JSON.parse`。解析器没有状态也没有依赖，因此 Host 投影和浏览器包对同一回答的读法完全一致。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 围栏语言、块解析和动作判别 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [工具包地图](../README.zh.md) — 相邻的无状态辅助包。
- [个性化页面](../../experimental/creation-recommendations/README.zh.md) — 通过这些块提案新页面。
- [插件推荐](../../experimental/plugin-recommendations/README.zh.md) — 通过这些块推荐官方插件。

-----

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **围栏必须闭合且从行首开始** — 模型没写结束符或加了缩进的块是普通文本；回答按原样记录，不出卡片。
- **还没有共享的卡片规则** — 一轮一张、替换和状态通知仍由各实验自己折叠；共享的动作卡层推迟到两个实验都合入之后。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
