---
description: "在已完成的回答末尾显示官方插件推荐。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-plugin-recommendations

[English](README.md) | 中文

## 概述

用户在完整回答下方看到一张插件推荐卡片，显示插件当前的界面语言标题、描述和 Agent 给出的理由。标题、理由和描述是同一个点击区域，悬停时整体高亮；点击可打开插件页中的对应详情，不会启用插件或改变当前 Session。启用和暂不需要仍是独立操作。重新连接后仍能看到之前的选择并打开详情。

## 目录

- [使用本包](#use-this-package)
- [实现原理](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

启用[插件推荐 Bundle](../plugin-recommendations/README.zh.md)，即可组合本界面和 Host skill、操作服务。本界面没有配置字段。

-----

<a id="understand-the-implementation"></a>
## 实现原理

<details>
<summary>实现细节 — 点击展开</summary>

回合末尾插槽读取 `pluginRecommendations` Session 投影中的提案，在回合结束后（无论以何种原因结束）显示该回合接纳的那一条；投影每个回合最多接纳一条提案，聊天界面隐藏围栏本身。投影标为未展示的提案不渲染。卡片向 Host 读取插件当前的目录文本和启用状态；不在可推荐目录里的名字不显示操作按钮。Session 投影恢复刷新后的选择状态。卸载时同时移除可选 Remote 和所有界面注册。

卡片沿用应用字体和交付物卡片的边框与背景，通过标题、正文和独立操作区区分信息层级。构建入口将生成的 Remote 描述传给可直接从源码测试的挂载流程。

- [Source](src/client/index.ts)
- [Tests](tests/)

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [推荐服务](../plugin-recommendations/README.zh.md) — 推荐范围、启用和持久化。
- [Session 投影](../../session/session-projection/README.zh.md) — 卡片读取的提案和卡片状态。
- [Slots](../../client/ui-slots/README.zh.md) — 回合末尾呈现。

<a id="model-experience"></a>
## 模型体验

间接影响来自卡片操作：Host 推荐服务在下一次模型请求中追加一条已记录的状态通知。本界面不增加模型工具或提示词。

#### KV Cache effect

卡片不增加模型上下文。启用操作可能通过 Host 改变后续工具声明。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每个回合只显示第一条推荐。
- 历史选择不会跟踪之后在插件页面进行的修改。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
