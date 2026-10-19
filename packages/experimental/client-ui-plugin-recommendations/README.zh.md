---
description: "在已完成的回答末尾显示官方插件推荐。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-plugin-recommendations

[English](README.md) | 中文

## 概述

用户在完整回答下方看到一张插件推荐卡片。点击标题或描述可打开插件页中的对应详情，不会启用插件或改变当前 Session。启用和暂不需要仍是独立操作。重新连接后仍能看到之前的选择并打开详情。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

启用[插件推荐 Bundle](../plugin-recommendations/README.zh.md)，即可组合本界面和 Host 工具、操作服务。本界面没有配置字段。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节 — 点击展开</summary>

已校验的原生及 PTC 工具结果存为隐藏的 Conversation 节点。已结束回合的末尾插槽读取该回合的推荐索引，只显示第一项，因此工具执行中和回答流式输出时不显示卡片。Session 投影恢复刷新后的选择状态。卸载时同时移除可选 Remote 和所有界面注册。

- [Source](src/client/index.ts)
- [Tests](tests/)

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [推荐服务](../plugin-recommendations/README.zh.md) — 推荐范围、启用和持久化。
- [Conversation](../../client/ui-conversation/README.zh.md) — 事件索引。
- [Slots](../../client/ui-slots/README.zh.md) — 回合末尾呈现。

<a id="model-experience"></a>
## Model Experience

Indirectly，通过成功的启用操作：Host 推荐服务发送已记录的续跑通知。本界面不增加模型工具或提示词。

#### KV Cache effect

卡片不增加模型上下文。启用操作可能通过 Host 改变后续工具声明。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 每个回合只显示第一条推荐。
- 历史选择不会跟踪之后在插件页面进行的修改。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

卡片沿用应用字体，通过标题、正文和独立操作区区分信息层级。构建入口将生成的 Remote 描述传给可直接从源码测试的挂载流程。
