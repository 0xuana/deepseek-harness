---
description: "针对用户明确需求推荐内置官方插件，并通过会话卡片启用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-plugin-recommendations

[English](README.md) | 中文

## 概述

用户表达具体需求时，Agent 可以推荐相关内置插件。Agent 先回答，再在本轮结尾显示一张推荐卡片；用户可以打开对应插件详情、启用或暂不需要。点击启用后通过 HMR 生效并自动通知 Agent，无需刷新页面或补发消息。启用会修改整个配置档案，并在重启后保留。只有即时生效的变更才会继续原任务。之后可在插件详情页关闭或移除插件。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在插件页的实验性插件分组中启用“插件推荐”。应用默认关闭此实验性插件，插件没有配置字段。

```yaml
- name: @deepseek-ai/dsh-experimental-plugin-recommendations
```

### 结果与恢复

启用需要修改配置档案的权限。Host 会在变更前重新检查插件是否符合条件。已保存的选择可能需要重启或被其他配置覆盖，这些结果不会让 Agent 续跑。失败和取消后可以重试。响应丢失时需等待 Session 投影恢复来确认结果；重复操作同一卡片具有幂等性。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

目录和启用操作复用 `pluginManager`。主 Agent 理解用户表达的需求；Host 限制为随应用提供的官方目录，并要求用户单独点击。可信目录文案存入工具结果元数据，Session 投影累积选择回执。同一卡片的并发点击共享操作，卸载服务会等待已开始的变更。配置档案文件拥有安装状态，实验性 Session 记录仅保存历史选择。关闭插件会撤下工具、卡片和对应的 Remote。

- [源码](src/index.ts) — 注册与服务入口。
- [测试](tests/) — 操作、恢复和生命周期验证。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [插件管理器](../../boot/plugin-manager/README.zh.md) — 配置档案变更。
- [Session 投影](../../session/session-projection/README.zh.md) — 持久化派生状态。
- [推荐卡片](../client-ui-plugin-recommendations/README.zh.md) — 回答末尾的推荐入口。
- [会话界面](../../client/ui-conversation/README.zh.md) — 会话记录中的展示位置。

<a id="model-experience"></a>
## 模型体验

### 推荐工具

#### 模型可见内容

[`list_official_plugins`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-plugin-recommendations) 返回符合条件且未启用的插件。`suggest_plugin` 记录一条推荐及其明确需求和解释。用户启用成功后会追加包含原需求的通知，让 Agent 继续处理。工具说明要求仅针对已表达的需求进行推荐；这是语义指导，而不是 Host 强制执行的意图分类器。

#### Token 影响

启用实验性插件后会加入两个工具 schema。目录结果、推荐和成功启用通知会追加上下文。

#### KV Cache 影响

推荐事实追加到会话记录。启用插件可能改变后续工具声明及其缓存复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 仅支持随应用提供的可选官方插件，不支持缺失包或第三方市场。
- 推荐要求存在活动的主会话，不主动挖掘用户尚未表达的机会。
- 历史回执不会持续跟踪之后在插件页发生的变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
