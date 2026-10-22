---
description: "扫描助手回答里的 dsh- 指令围栏块：解析 dsh-action 提案并隐藏围栏，供卡片实验和聊天渲染共用。"
kind: "package-library"
---

# @deepseek-ai/dsh-util-action-block

[English](README.md) | 中文

## 概述

调用方可以找出助手回答里的 `dsh-` 指令围栏，把其中的 `dsh-action` 块读成已解析的 JSON 对象，辨认每个块声明的动作，并在渲染回答时去掉这些围栏。本包只拥有围栏语法；每个卡片实验各自校验自己的块字段，并决定一个块何时成为卡片。

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

`actionBlocksOf(text)` 按回答顺序返回每个已闭合的 ```` ```dsh-action ```` 围栏内格式正确的 JSON 对象。JSON 错误、数组或标量的围栏不产生任何块，未闭合的围栏也不产生；其他围栏语言被忽略。每个对象的字段由拥有该动作的 schema 校验。

```ts
import { actionBlocksOf, actionOf } from '@deepseek-ai/dsh-util-action-block'

declare const answerText: string

const blocks = actionBlocksOf(answerText)
const mine = blocks.filter(block => actionOf(block) === 'create_personalized_page')
```

### 区分动作

`actionOf(block)` 返回已解析块的非空 `action` 字符串，否则返回 `undefined`。投影用它找出自己的块，并察觉同一回答里还带着另一个实验的块，而不必知道那个实验的 schema。

### 隐藏围栏

`hideDirectiveFences(text, { streaming })` 删除每个语言以 `dsh-` 开头的围栏，从开始行一直到结束行，其余文本保持原样。被删围栏前面是空行时，紧跟在它后面的一个空行也一并删除，只留下一个空行；围栏后面没有任何内容时，删除它前面的空行。未闭合的末尾围栏只在 `streaming` 为 true 时删除，因为块的其余部分还没到达；已完成的回答把它保留为文本。轨迹视图保留原始回答。

```ts
import { hideDirectiveFences } from '@deepseek-ai/dsh-util-action-block'

declare const answerText: string
declare const streaming: boolean

const rendered = hideDirectiveFences(answerText, { streaming })
```

### 查找围栏

`scanDirectiveFences(text)` 返回每个指令围栏：它的语言、开始行的偏移、结束行末尾的偏移、是否闭合，以及两条围栏行之间的正文行。`ACTION_BLOCK_LANGUAGE` 是 `dsh-action` 这个语言名。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

扫描器把文本切成以 `\n` 或 `\r\n` 结尾的行，并按 CommonMark 识别不在其他围栏内的围栏代码块。开始行最多缩进三个空格，接着是三个或更多反引号或波浪号；信息串的第一个词是语言，反引号围栏的信息串里不能有反引号。之后第一个最多缩进三个空格、由至少同样多的同种字符组成、后面只跟空格或制表符的行结束这个围栏。任何语言的围栏打开期间，其中每一行都是它的内容，因此 `````` ````markdown `````` 或 `~~~` 围栏里的 `dsh-action` 示例既不解析也不隐藏；一行里跟在其他文字后面的围栏字符不开启任何围栏。块正文去掉首尾空白后交给 `JSON.parse`。扫描器没有状态也没有依赖，因此 Host 投影和浏览器包对同一回答的读法完全一致。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 围栏扫描、块解析、动作判别和围栏隐藏 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [工具包地图](../README.zh.md) — 相邻的无状态辅助包。
- [个性化页面](../../experimental/creation-recommendations/README.zh.md) — 通过这些块提案新页面。

-----

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **不把块引用和列表项当作容器解析** — `>` 标记后面的围栏是普通文本，列表项里缩进不超过三个空格的围栏算作顶层围栏。
- **隐藏可能合并段落** — 前后没有空行的围栏被删除后，它前后的两行直接相邻，Markdown 会把它们渲染成同一段。
- **还没有共享的卡片规则** — 一轮一张、替换和状态通知仍由各实验自己折叠；共享的动作卡层推迟到第二个卡片实验读取这些块之后。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
