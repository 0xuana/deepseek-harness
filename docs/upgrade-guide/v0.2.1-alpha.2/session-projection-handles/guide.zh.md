---
kind: upgrade-guide
description: "Session 投影注册改为异步，并返回保留读取能力的句柄而不是释放函数。"
---
# Session 投影注册句柄

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-session-projection` 的 `SessionProjectionRegistry.register(definition)` 从同步释放函数改为返回 `Promise<ProjectionHandle<S>>`。注册表级 `stateOf(session, key)` 已移除，注册错误现在使返回的 Promise 拒绝。最后一次注册释放后，该投影单元不再参与快照、检查点和实时通知，但保留的句柄仍可按需折叠 Session 事件。

`@deepseek-ai/dsh-subagent` 现在必需注入 `sessionProjections`。`@deepseek-ai/dsh-api-session-controller` 移除了 `installModelSelectionProjection`；消费者改为注册 `modelSelectionProjection`。控制器也注册 `agentPreset`，其 null 值表示 Session 未记录预设；该键不代表预设注册表可用。`turnBoundaryProjectionDefinition` 由 `@deepseek-ai/dsh-agent` 导出；`agent-loop` 的再导出仍然可用。

## 迁移

1. 将 `sessionProjections` 声明为插件的必需注入，并在消费者之前挂载 `SessionProjectionRegistry`，包括自定义组合中的 `SubagentRuntime`。
2. 在函数插件的异步 `apply()` 或服务的 `[Service.init]()` 中，等待 `ctx.sessionProjections.register(definition)`，在发布依赖操作前保留返回的句柄。保留既有的函数插件命名空间导出。
3. 将 `registry.stateOf(session, key)` 替换为 `handle.stateOf(session)`。读取方需要自行取得句柄时，导入归属包的投影定义。将保存的注销回调替换为 `handle.dispose`；fiber 释放仍会自动解除注册。处理初始化错误时须等待注册完成。
4. 将 `installModelSelectionProjection(ctx)` 替换为 `await ctx.sessionProjections.register(modelSelectionProjection)`，从 `@deepseek-ai/dsh-api-session-controller/src/model-selection-projection.ts` 导入该定义。
5. 对自定义插件执行类型检查，再验证激活、Session 状态读取与 owner 释放。已释放的读取句柄仍可使用，而投影单元在最后一次注册解除后会从新快照中消失。
