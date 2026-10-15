---
kind: upgrade-guide
description: "Session 模型选择现在于步骤准备时生效，请求监听器必须保留已选路由。"
---

# Session 模型选择从下一个步骤开始生效

[English](guide.md) | 中文

## 变更

ACP（Agent Client Protocol）的模型与推理强度变更从下一个模型步骤开始生效，包括当前轮次的工具后续步骤。此前，ACP 会在整个提示词轮次中固定选择。已准备的步骤及其重试保留捕获的选择。图片准入检查准入开始时选择的路由；后续选项变更可能在步骤开始前选中另一条路由。

Agent 注册表现在依赖 `sessionProjections`，并拥有持久 `modelSelection` 投影。程序化恢复优先还原记录中的选择，包括尚未被请求使用的选择，然后才回退到 `AgentOptions`。配置式 Agent-loop 恢复、headless 接管与 SDK 恢复会显式记录各自的部署路由。

插件必须在提示词组装前选定完整的提供方／模型路由。`agent/request` 已弃用。现有监听器仍在主循环的每次请求尝试中运行，可以调整控制参数，但提供方或模型变更会被拒绝。压缩等辅助调用不会分发该事件。`installModelSelection` 与 `ModelSelectionRef` 已移除，选择的读取方与写入方使用共享 Session 投影。

## 迁移

1. 在自定义 Cordis 组合中，先挂载 `dsh-session-projection`，再挂载 `dsh-agent`。
2. 不要添加新的 `agent/request` 监听器。将可变选择引用与选择提供方、模型或推理强度的监听器替换为 `@deepseek-ai/dsh-agent` 导出的 `recordModelSelection(ctx.sessionProjections, agent, selection)`。记录前先校验路由。使用 `currentModelSelection()` 读取选择；组合需要持久模型切换提示时，调用 `installModelSwitchNotice(agent.ctx)`。
3. 通过 `AgentOptions.maxTokens` 设置输出上限。其他逐请求控制参数覆盖没有替代 API；仍需要该行为时，保留现有监听器。
4. 要在程序化恢复时覆盖已保存路由，在 Agent setup 回调中调用 `recordDeclaredRoute()`。仅提供 `agentOptions` 时，它只为没有选择或请求记录的 Session 提供回退值。
5. 分发 `agent/pre-step` 时通过 `callConfig` 传入固定路由。直接调用 `SessionReferenceResolver.prepare()` 时，将路由作为第四个参数，放在可选信号之前。
6. 要求整轮使用同一个模型的 ACP 控制器，必须等待活跃提示词完成后再更改选项。验证轮次中的变更被记录为 `model/selection`、下一个步骤使用该选择，且恢复保留尚未使用的选择。
