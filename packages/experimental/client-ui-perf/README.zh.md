---
description: "实验性会话视图：按轮次与步骤展示上下文大小、首 token 延迟、模型与工具耗时、缓存命中率和输出速度。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-perf

[English](README.md) | 中文

## 概述

在「对话」和「轨迹」旁边加一个「性能」页签。每一轮一行，展开后列出各步的上下文词数、输出词数、缓存命中率、首 token 延迟、模型用时、输出速度、工具调用用时，以及一条按首 token、生成、工具调用、其余四段拆开的总用时条。还在跑的步显示已用时间，而不是留空。页签只读会话事件，不注册工具、提示词段落或服务。

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

挂到已经提供 `slots`、`uiConversation`、`locale` 的客户端组合里。它向 `conversation.view` 槽贡献一个条目，没有配置字段。

### 何时选择它

需要按提示词长度、缓存复用情况和总时间去向比较轮次或步骤时选它。需要完整事件清单、请求头和工具正文时选 `@deepseek-ai/dsh-client-ui-trajectory`；两个页签读同一份会话，可以同时启用。

### 最小配置

```yaml
- id: ui-perf
  name: '@deepseek-ai/dsh-experimental-client-ui-perf'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

三个 Conversation Definition 把事件窗口折叠成名为 `perf` 的视图目标节点。`perf-step` 每个 `step/start` 一个上下文；`perf-prompt` 记录这一轮的用户问题；`perf-turn-end` 记录轮次边界，让被中断的尾部也能收尾。

| 文件 | 职责 |
| --- | --- |
| `src/client/perf-definition.ts` | 三个 Definition：匹配规则、发布节奏与节点信封 |
| `src/client/perf-fold.ts` | 事件折叠、工具配对、Code-Mode 内层调用归属、单步指标 |
| `src/client/perf-aggregate.ts` | 轮次汇总与排序，含被中断尾部的收尾 |
| `src/client/perf-snapshot-builder.ts` | `perf` 视图目标的增量 builder |
| `src/client/PerfView.tsx` | 表格、时间条、步骤手风琴与复制按钮 |
| `src/client/locales.ts` | 全部可见文案，中英两份 |

会话窗口是有界的：某一步的 `step/start` 不在已加载窗口里时，与起点有关的列显示 `—` 并标「起止未知」，不估算数值。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@deepseek-ai/dsh-client-ui-trajectory`](../../client/ui-trajectory/README.zh.md) —— 本页签的表格约定参考它。
- [`@deepseek-ai/dsh-session-stats`](../../session/session-stats/README.zh.md) —— 列名口径与会话统计一致。
- [`docs/subsystems/conversation.md`](../../../docs/subsystems/conversation.zh.md) —— 视图目标与 Definition 的装配方式。

-----

<a id="model-experience"></a>
## 模型体验

无直接影响，因为页签只读会话事件并在浏览器里渲染，不注册工具、提示词段落或模型输入。

#### KV Cache 影响

没有影响。本包不构造模型请求，也不修改提示词。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **默认产品不挂载。** Web 包按规则拒绝引用 experimental 包，需要 profile 或显式组合添加这一行。
- **窗口被截断时没有起始时刻。** 已加载窗口从半步中间开始时，首 token、模型用时和总用时都推导不出来；行上标「起止未知」，不估算。
- **Code-Mode 归属是进程内的。** 内层调用不带 turn/step，归属靠内存里的 root call 表解析，上限 4000 条；淘汰之后重放的窗口无法再归属更早的内层调用。
- **只有包级测试。** 覆盖折叠、汇总与格式化；页签还没有浏览器快照测试或录制会话场景。
- **计时是推导值。** 总用时取最后一步结束减第一步开始；排队和调度等待落在「其余」段里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本页签从一份独立的客户端插件移植而来。列名口径参照 `@deepseek-ai/dsh-session-stats`（模型用时、工具调用用时、首 token、输出速度），版式参照轨迹表格，让两个页签读起来一致。

</details>

**运行时不变式：** 不发布伴生入口。全部状态都从会话事件窗口推导，独立观察只会重复注册与折叠逻辑，而不会断言另一种关系。
