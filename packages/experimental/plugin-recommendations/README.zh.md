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

打开插件 → 更多 → 实验性插件，启用“插件推荐”。应用默认关闭此实验性插件。启用后在插件一级页显示，关闭后仅保留在二级页。插件没有配置字段。

```yaml
- name: @deepseek-ai/dsh-experimental-plugin-recommendations
```

面对多个独立需求，指引要求先选定一项再调用推荐工具：优先遵循用户明确指定的顺序，否则先推荐现成插件，再考虑新界面。其余需求在正文说明；缺少信息时先澄清，不推断它们之间的关联。每轮限制覆盖两类推荐工具，包括同批提交的调用。被拒绝的调用不会生成卡片，也不会安排后续自动出卡。已经选定现成插件时，无需为未选中的创造需求再查另一份目录。这些属于语义指引，Host 仍独立执行每轮最多一张成功卡片的限制。

### 结果与恢复

启用需要修改配置档案的权限。Host 会在变更前重新检查插件是否符合条件。已保存的选择可能需要重启或被其他配置覆盖，这些结果不会让 Agent 续跑。失败和取消后可以重试。响应丢失时需等待 Session 投影恢复来确认结果；重复操作同一卡片具有幂等性。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host 入口是普通函数插件，在 `apply` 内通过 `ctx.plugin` 组装内部 `pluginRecommendations` Remote service。该 service 负责本功能的状态、effect 生命周期和类型化按钮通信，不作为可替换能力单独暴露为 YAML 条目；`dsh-base` 不增加 service。关闭功能插件时一并卸载内部 service、工具和监听，并清理其负责的异步工作。此结构沿用 `command-feedback` 组装 `sessionFeedback` 的现有方式。

目录和启用操作复用 `pluginManager`。仅主会话可见的提示要求 Agent 在用户明确表达 DSH 功能或显示需求时，即使没有提到插件也先查目录；功能愿望本身不构成修改源码、设置或指令的授权。任一推荐工具不可用时不提供该提示，卸载时一并撤下。主 Agent 理解用户表达的需求；Host 限制为随应用提供的官方目录，每轮只允许一个成功建议，并要求用户单独点击。并发建议在查询目录前预留本轮名额，失败后释放；已完成建议通过回放保留限制，重新加载不会重置，下一轮可以再次推荐。可信目录文案存入工具结果元数据，Session 投影累积选择回执。同一卡片的并发点击共享操作，卸载时停止本地后续处理，不等待排在自身 HMR 卸载之后的配置变更。已接纳的变更由插件管理器负责；结果不明的卡片在重载后重新检查插件状态。已在其他页面开启的插件记录为 `already-enabled`，不会再次重载或发送通知；配置已选中不代表运行时已经生效。无法读取的记录会阻止推荐操作并显示恢复提示，不影响其他 Session 投影。配置档案文件拥有安装状态，实验性 Session 记录仅保存历史选择。关闭插件会撤下工具、卡片和对应的 Remote。

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

[`list_official_plugins`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-plugin-recommendations) 返回符合条件的插件及现有中英文名称、描述和启用状态。匹配到已启用插件时说明用法，不再出卡；只有未启用的插件可以被推荐。使用体验需求（包括已展示思考内容的可读性）先查目录，不查源码或配置；明确开发请求仍使用常规工具。描述结合能力、使用场景和重要限制，与插件管理页共用，不另建触发规则表。`suggest_plugin` 记录一条推荐及其明确需求和解释。用户启用成功后会追加包含原需求的通知，指引 Agent 重读原始请求并保留“先只推荐”“不要执行”等限制；这些情况及纯发现请求以简短确认结束，不调用工具。其他情况只继续已请求的工作，不扩展为账户级搜索或批量修改。这是语义指导，而不是 Host 强制执行的意图分类器或执行边界。普通任务直接回答；如果可用的创造工具允许为当前任务已得到的明显可复用结果顺带推荐页面，路由指引会保留这条路径，但不扩大插件发现范围，也不引入依赖。

#### Token 影响

启用实验性插件后会加入两个工具 schema 和一段简短路由指引。名称和描述仅在查询目录后进入上下文；不会向每次提示注入目录、TODO 列表或关键词分类器。目录结果和成功启用通知会追加上下文。原生工具文本仅包含已推荐状态和包名；展示元数据和 PTC 结构化值保留完整建议。

#### KV Cache 影响

路由指引在请求间保持稳定；开关实验会改变提示前缀。推荐事实追加到会话记录。启用插件可能改变后续工具声明及其缓存复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

人工运行的真实模型输入集见 `evaluation/intent-cases.json`；单元测试不衡量语义意图准确率。工具指引要求 Agent 澄清模糊需求、尊重不推荐的要求，并在提出建议后给出一次简洁的最终回答。这些语义决策通过真实模型测试评估，不是关键词硬判断。

- 仅支持随应用提供的可选官方插件，不支持缺失包或第三方市场。
- 推荐要求存在活动的主会话，不主动挖掘用户尚未表达的机会。
- 历史回执不会持续跟踪之后在插件页发生的变更。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
