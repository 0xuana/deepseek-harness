---
description: "实验性会话视图：按轮次与步骤展示上下文大小、首 token 延迟、模型与工具耗时、缓存命中率和输出速度。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-perf

[English](README.md) | 中文

## 概述

在「对话」和「轨迹」旁边加一个「性能」页签。每一轮一行，展开后列出各步的上下文词数、输出词数、缓存命中率、首 token 延迟、模型用时、输出速度、工具调用用时，以及一条按首 token、生成、工具调用、其余四段拆开的总用时条。还在跑的步显示已用时间，而不是留空。「触发」列会说明这一轮由什么触发：人写的提问显示原文，团队/智能体消息、子代理完成、目标轮次、定时/Webhook/后台任务或上下文唤醒显示本地化触发标签加触发文本；团队或智能体消息还会在标签里写明发送方。带图的提问在「触发」列显示与触发标签同样式的张数标签；悬停或键盘聚焦标签会浮出小图预览，点击预览用共用看图器加载该图，只有图片的提问显示标签而不是空单元格。页签只读会话事件和提问里的持久图片，不注册工具、提示词段落或服务。

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

四个 Conversation Definition 把事件窗口折叠成名为 `perf` 的视图目标节点。`perf-step` 每个 `step/start` 一个上下文；`perf-prompt` 每条唤醒该轮的用户消息（人写提示或自动触发）一个上下文；`perf-turn-end` 记录轮次边界，让被中断的尾部也能收尾；`perf-code-mode` 每个 Code-Mode 根调用一个上下文，收纳它实际派发的内层调用。轮次与步骤身份取自引擎给出的 match Location，而不是模块级状态，因此历史分页和多个 Session 都不会串归属。

| 文件 | 职责 |
| --- | --- |
| `src/client/perf-definition.ts` | 三个 Definition：匹配规则、发布节奏与节点信封 |
| `src/client/perf-fold.ts` | 事件折叠、工具配对、Code-Mode 内层调用归属、单步指标 |
| `src/client/perf-aggregate.ts` | 轮次汇总与排序，含被中断尾部的收尾 |
| `src/client/perf-snapshot-builder.ts` | `perf` 视图目标的增量 builder |
| `src/client/PerfView.tsx` | 表格、时间条、步骤手风琴、复制按钮，以及提问图片标签、预览与看图器 |
| `src/client/locales.ts` | 全部可见文案，中、英、日三份 |

会话窗口是有界的：某一步的 `step/start` 不在已加载窗口里时，与起点有关的列显示 `—` 并标「起止未知」，不估算数值。滚到顶部会向 Session 请求更早的一页；视图按新增内容的高度补偿滚动位置，正在读的行不会跳走。

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
- **Code-Mode 内层调用按根调用上下文并回步骤。** 内层调用不带 turn/step，因此每个根调用各自开一个以 root call id 为键的上下文，由 builder 把它的派发并回持有 runner 的那一步。窗口里丢了派发起点时仍会合并调用，但无法给出它们各自的实测耗时。
- **浏览器证据是仅测试用的 overlay。** 包级测试覆盖折叠、汇总、格式化与 jsdom 表格；`apps/web/tests/client-ui-perf-panel.e2e.ts` 用仅测试用的 overlay 把插件挂到真实 Web 面上，并比对提交的 ARIA golden。由于还没有任何 shipped profile 挂载本包，暂无录制会话场景。
- **迟到重投不是轮次。** 压缩可能把被裁剪的工具结果按原来的轮次/步骤在之后重新投递；窗口里既没有加载到的起点、也没有问题或结束标记的轮次会被丢弃，不再显示成空的幽灵行。
- **计时是推导值。** 总用时取最后一步结束减第一步开始；排队和调度等待落在「其余」段里。总用时条把工具调用画成配对区间之并，并行调用只算一次；工具列仍显示逐次求和。轮次时间条以当前屏幕内可见的轮次为刻度，滚出屏幕的超大轮次不会把本屏的行压扁。
- **提问图片走共用图片缓存。** 标签与预览用 `uiConversation.imageUrl` 解析持久附件，浏览器 URL 由缓存按 Session binding 持有并释放，视图不自己创建 URL。读取失败时显示本地化失败状态并可重试。触屏不打开悬停预览，点击标签会直接加载第一张图。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本页签从一份独立的客户端插件移植而来。列名口径参照 `@deepseek-ai/dsh-session-stats`（模型用时、工具调用用时、首 token、输出速度），版式参照轨迹表格，让两个页签读起来一致。

</details>

**运行时不变式：** 不发布伴生入口。全部状态都从会话事件窗口推导，独立观察只会重复注册与折叠逻辑，而不会断言另一种关系。
