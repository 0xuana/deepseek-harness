---
kind: upgrade-guide
description: "Session 模型选择在步骤准备时固定，投影类型移至其所属包。"
---

# Session 模型选择从下一个步骤开始生效

[English](guide.md) | 中文

## 变更

ACP（Agent Client Protocol）的模型与推理强度变更从下一个模型步骤开始生效，包括当前轮次的工具后续步骤。此前，ACP 会在整个提示词轮次中固定选择。已准备的步骤及其重试保留捕获的选择。图片准入检查准入开始时选择的路由；后续选项变更可能在步骤开始前选中另一条路由。

`dsh-agent-model` 提供 `ctx.agentModel`，并拥有持久 `modelSelection` 投影。Agent 注册表不再注册该投影。程序化恢复优先还原记录中的选择，包括尚未使用的选择，然后才回退到 `AgentOptions`。配置式 Agent-loop 恢复、headless 接管与 SDK 恢复会记录各自的部署路由；省略推理强度时，仅在路由相同的情况下保留已保存的显式强度。

插件必须在提示词组装前选定提供方、模型及可选的显式推理强度。`agent/request` 已弃用。现有监听器仍在主循环的每次请求尝试中运行，可以调整其他控制参数，但不能改变提供方或模型，也不能添加、修改或清除推理强度。未指定的强度仍在每次尝试时通过适配器默认值解析。压缩等辅助调用不会分发该事件。`installModelSelection` 与 `ModelSelectionRef` 已移除。

客户端投影类型移至 `dsh-agent-model/types`；API 包的转导出与具名 Host 投影状态导出已移除。

## 迁移

1. 在自定义 Cordis 组合中挂载 `dsh-session-projection` 与 `dsh-agent-model`。消费方注入 `agentModel`；随附 bundle 已包含该服务。
2. 将可变引用与选择 hook 替换为校验后的 `ctx.agentModel.select(agent, selection)`，使用 `resolveForNextStep(agent)` 读取选择。将切换提示 helper 替换为导入 `@deepseek-ai/dsh-agent-model/notice` 插件，并在 Agent setup 中等待 `agentCtx.plugin(ModelSwitchNotice)`。不要添加 `agent/request` 监听器。
3. 通过 `AgentOptions.maxTokens` 设置输出上限。其他逐请求控制参数覆盖没有替代 API；仍需要该行为时，保留现有监听器。
4. 要在程序化恢复时覆盖已保存路由，在 Agent setup 回调中调用 `ctx.agentModel.applyConfiguredRoute(agent, selection)`。仅提供 `agentOptions` 时，它只为没有选择或请求记录的 Session 提供回退值。
5. 通过 `agent/pre-step.callConfig` 传入捕获的 `Readonly<ModelSelection>`，包含已选定的显式强度；`AssembleContext.callConfig` 携带同一选择。直接调用 `SessionReferenceResolver.prepare()` 时，将路由作为第四个参数，放在可选信号之前。
6. 要求整轮使用同一个模型的 ACP 控制器，必须等待活跃提示词完成后再更改选项。验证轮次中的变更被记录为 `model/selection`、下一个步骤使用该选择，且恢复保留尚未使用的选择。
7. 从 `@deepseek-ai/dsh-agent-model/types` 导入 `ModelSelectionProjection`，替换 Agent/API 包别名。`ModelSelection` 仍位于 `dsh-agent/types`。导入新 `/types` 模块后，将具名 Host 状态导入替换为 `SessionProjectionStateMap['modelSelection']`；普通读取使用 `resolveForNextStep()`。强度值使用 `dsh-llm/brand` 中的 `ReasoningEffortId`。
