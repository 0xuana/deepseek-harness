---
kind: upgrade-guide
description: "自定义工具和提示词插件必须使用请求拥有的工具准入集合以及提前的路由准备阶段。"
---

# 更新条件工具与提示词钩子

[English](guide.md) | 中文

## 变更

`agent/request` 与 `prepareCall()` 在 `agent/pre-step` 之前绑定路由。运行时上下文准备使用 `system-prompt/prepare`；`system-prompt/assemble` 接收不含工具数组的展示字段。工具声明仍由已注册提供方持有。条件工具执行需要已解析的请求集合，包括嵌套 PTC 调用。替换注册不会授权尚未执行的旧调用使用新实现。

`exit_plan_mode` 只在已提交的计划模式启用时提供。计划状态写入失败会停止步骤接纳并保留待提交选择。现有 Session 无需格式迁移。

## 迁移

1. 使用 `ctx.tools.register(definition, { when })` 声明工具条件。通过 `agent.currentRoute()` 读取已绑定路由，不从初始选项或先前 Session 请求头推断。
2. 将运行时上下文准备监听器迁移到 `system-prompt/prepare`。展示变更留在 `system-prompt/assemble`，停止替换它的工具列表。
3. 程序化调用条件工具时，通过 `ctx.tools.resolve()` 解析 `{ agent, signal }`，将返回的 `toolSet` 传给组装与执行，并在批次结束后释放。AgentLoop 会为模型调用完成这些操作。工具指导查询 `ctx.tools.get()` 或 `schemas()` 时传入 `context.toolSet`。
4. 为自定义 Agent 实现补充 `currentRoute()`，仅在主请求已绑定期间可用。验证未启用工具不出现在声明中，且使用历史名称调用会返回 `UNKNOWN_TOOL`，不会进入实现。
