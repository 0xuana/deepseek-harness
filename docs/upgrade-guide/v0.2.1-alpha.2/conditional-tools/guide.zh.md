---
kind: upgrade-guide
description: "步骤路由选择从 `agent/request` 移到 `agent/route`，自定义工具和提示词插件必须使用步骤拥有的工具准入集合。"
---

# 更新步骤路由、条件工具与提示词钩子

[English](guide.md) | 中文

## 变更

`agent/route` 在 `system-prompt/prepare` 与 `agent/pre-step` 之前选定每个步骤的提供方与模型。提示词准备、`agent/pre-step`（通过新增的 payload 字段 `route`）、工具条件以及该步骤的每次请求尝试都使用这一路由。`agent/request` 仍在提示词组装与 `step/start` 之后为每次尝试运行，但只能修改 `reasoningEffort` 等调用控制参数；返回其他提供方或模型会使步骤失败。options 中没有路由的 agent 必须由 `agent/route` 提供路由。在 `agent/request` 中替换提供方或模型的插件（包括在重试时替换的插件）会受到影响。

运行时上下文准备使用 `system-prompt/prepare`；`system-prompt/assemble` 接收不含工具数组的展示字段。工具声明仍由已注册提供方持有。条件工具执行需要已解析的步骤集合，包括嵌套 PTC 调用。替换注册不会授权尚未执行的旧调用使用新实现。

`exit_plan_mode` 只在已提交的计划模式启用时提供。计划状态写入失败会停止步骤接纳并保留待提交选择。现有 Session 无需格式迁移。

## 迁移

1. 把 `agent/request` 监听器中的提供方与模型替换移到返回 `{ provider, model }` 的 `agent/route` 监听器；`agent/request` 只保留调用控制参数的修改。在 `agent/pre-step` 中从 `payload.route` 读取路由，在提示词提供方中从 `AssembleContext.route` 读取路由。
2. 使用 `ctx.tools.register(definition, { when })` 声明工具条件；条件接收 `{ agent, route, signal }`。
3. 将运行时上下文准备监听器迁移到 `system-prompt/prepare`。展示变更留在 `system-prompt/assemble`，停止替换它的工具列表。
4. 程序化调用条件工具时，通过 `ctx.tools.resolve()` 解析 `{ agent, route, signal }`，将返回的 `toolSet` 传给组装与执行，并在批次结束后释放。AgentLoop 会为模型调用在每个步骤完成一次这些操作。工具指导查询 `ctx.tools.get()` 或 `schemas()` 时传入 `context.toolSet`。
5. 为测试直接派发的 `agent/pre-step` payload 补上 `route`。验证未启用工具不出现在声明中，使用历史名称调用会返回 `UNKNOWN_TOOL` 且不会进入实现，并验证修改模型的 `agent/request` 监听器会让轮次以指向 `agent/route` 的错误结束。
