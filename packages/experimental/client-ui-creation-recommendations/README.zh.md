---
description: "在完整回答末尾显示支持位置选择、保留和撤销的创建卡片。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-creation-recommendations

[English](README.md) | 中文

## 概述

用户在完整回答下方看到一条创建建议。方案默认显示三行，可展开查看全文。下拉菜单提供右侧栏、会话 Tab、全局页面和自行撰写四项。消耗提示在用户收起前默认展开，本浏览器跨会话记住选择，信息按钮可重新打开。只有点击创建才启动后台任务，主对话可继续。进度显示在顶部，保留用于确认继续使用，撤销则移除插件。

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

启用[个性化页面 Bundle](../creation-recommendations/README.zh.md)。本浏览器组件没有配置字段。

### 操作结果与恢复

创建、安装、保留和移除记录来自 Session 投影，重新连接后会在卡片中恢复。操作回复丢失时显示可采取行动的错误信息；重试以 Host 已记录的状态为准。请求处理中禁用重复操作。生成阶段可取消，等待子任务清理后才能重试；已接纳的安装不再取消。信息说明中包含源码目录，并明确撤销会保留这些文件。

自行撰写会显示位置输入框，最多 1,000 字，空白内容不能启动创建；改选预设位置后不提交自定义文字。已接受的请求将文字存入操作记录，供重连和重试恢复，并连同完整方案交给 Creator。编辑草稿、打开菜单或查看消耗说明都不会调用模型。收起提示或点击创建、暂不需要后，浏览器本地存储记住已读；更换浏览器、清除或无法使用存储时可能再次显示。历史已结束的卡片默认收起提示。

-----

<a id="understand-the-implementation"></a>
## 实现原理

<details>
<summary>实现细节 — 点击展开</summary>

成功的原生及 PTC 结果元数据成为隐藏的 Conversation 节点。已完成回合的末尾插槽读取该回合的推荐索引，只显示第一项。组件接收绑定会话的回调和框架绑定的提示偏好，不直接访问服务。共享 Menu 处理浮层定位、键盘选择和关闭。可选 Remote、语言字典、事件定义和插槽注册使用同一插件生命周期。

- [源码](src/client/index.ts)
- [测试](tests/)

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [创建服务](../creation-recommendations/README.zh.md) — 创建任务与持久化。
- [Conversation](../../client/ui-conversation/README.zh.md) — 事件索引。
- [Slots](../../client/ui-slots/README.zh.md) — 回合末尾呈现.

<a id="model-experience"></a>
## 模型体验

间接影响来自用户接受的创建操作：Host 启动 Creator，传入完整方案和选定或手写的位置，不增加浏览器侧模型工具，也不恢复父模型执行。

#### KV Cache effect

渲染卡片和修改位置不会影响模型缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 需求摘要由模型编写，需要包含 Creator 所需的上下文。
- 历史记录不会持续跟踪之后在插件页手动进行的修改。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
