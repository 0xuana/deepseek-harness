# Agent Note: 在步骤准备之前选定步骤路由

Status: implemented

[English](2026-10-12-step-route-chosen-before-preparation.md) | 中文

## 问题

工具是否可用可能取决于声明这些工具的请求所用的路由：`web_search` 不得出现在没有搜索凭据的路由上，计划或团队状态也可能撤下其他工具。消息准备同样需要这一路由：会话引用按模型的上下文窗口确定快照大小，模型选择会通告模型切换。循环原先在 `agent/pre-step` 之前组装工具与提示词段落，直到 `step/start` 之后才在 `agent/request` 中决定路由，因此更早的消费方只能依据模型选择状态预测路由。若监听器在 `agent/request` 中（包括在重试时）替换路由，已组装的提示词与工具目录就会描述另一个模型。

## 决策

提供方与模型是步骤级事实。领取输入之后，循环为每个拟议步骤派发一次 `agent/route`。其默认值在本循环记录请求之前取 agent 选项中的路由，之后取已记录请求头中的路由；`installModelSelection` 在这里捕获其选择。循环把得到的 `StepRoute` 作为 `AssembleContext.route` 传给 `system-prompt/prepare`，作为 `payload.route` 传给 `agent/pre-step`，作为 `ToolActivationContext.route` 传给工具条件。提示词变量 `{{provider}}` 与 `{{model}}` 读取该路由。

`agent/pre-step` 接纳步骤且 `step/start` 打开步骤之后，循环解析条件工具并组装提示词，各执行一次。之后每次请求尝试都在准入之前紧接着运行 `agent/request` 与 `prepareCall()`。`agent/request` 可以修改调用控制参数；返回其他提供方或模型会使步骤失败。重试复用该步骤的路由、工具集合与已渲染组装结果，步骤拥有的工具集合在该步骤的工具批次结束后关闭。步骤进行中做出的选择从下一个步骤开始生效。

## 考虑过的替代方案

- **在 `agent/pre-step` 之前通过 `agent/request` 绑定路由，并提供 `Agent.currentRoute()`。** 已准备调用会捕获适配器注册与连接设置，因此在压缩、钩子与会话读取期间一直持有它，会忽略期间修改的设置；被 `agent/pre-step` 拒绝的步骤也会准备适配器。该 getter 只在步骤内有效、在其他时刻抛错，且每个 Agent 实现与测试替身都必须提供它。
- **在 `agent/pre-step` 内记录路由。** `system-prompt/prepare` 在该 waterfall 之前运行，而 waterfall 内的路由消费方将依赖监听器顺序。
- **不使用事件，直接在 Agent 上登记模型选择。** 这会给通用 `Agent` 接口增加只有单一消费方的方法，把模型选择的推理强度规则移入循环，并移除为创建时没有路由的 agent 提供路由的监听器途径。
- **路由决定留在 `agent/request`，为更早的消费方预测路由。** 只要模型选择之外的监听器修改路由，预测就会偏离。

## 后果

- 工具条件、提示词变量、引用预算与切换通告读取的路由，与请求头记录的路由一致。
- `prepareCall()` 紧邻分发，因此其适配器注册与连接快照只覆盖请求头记录与流式请求。
- 步骤无法在重试时切换到其他提供方；需要这种能力的策略必须为重试的尝试重新执行路由选择、工具解析与组装。
- 路由不能依赖 `agent/pre-step` 的结果。计划状态在该 waterfall 内提交，因此按计划模式选择模型需要先在路由选择之前提交计划选择。
- `agent/pre-step` 监听器与直接派发方必须处理必填的 `route` 字段。

## 相关

- [基于提供方路由的 LLM 适配器](2026-07-14-provider-routed-llm-adapters.zh.md)负责调用配置中的提供方与模型字段。
- [可重建请求](2026-07-05-reconstructable-requests.zh.md)负责依据已记录请求头重建请求。
- [提示词变量与工具指导归属](2026-07-05-prompt-variables-and-tool-guidance-ownership.zh.md)负责 `{{model}}` 变量。
