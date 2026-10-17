# Agent Note: Headless 调用者对 Auto review 的授权

Status: implemented

[English](2026-10-18-headless-auto-review.md) | 中文

## Problem

外部监督者可以给 headless 任务并恢复其 Session，但现有 Auto reviewer 只识别 Web 的 human 入口和进程内父级指令。Headless 任务既没有浏览器 RPC 身份，也没有 child 谱系。将其视为事实会阻止对 medium 风险操作的显式授权；将所有 user-role 消息视为指令则会提升注入内容与旧的无归属历史的权威。

## Decision

[实验性 Auto 层](../../../../packages/experimental/auto-review/README.zh.md#headless-supervision)支持显式 headless 选择。默认 profile 保持不变。这扩展了[逐工具 Auto review](2026-08-28-auto-review.zh.md)仅限 Web 的范围；其风险分类、完全访问执行、PTC 排除项和生命周期仍具权威性。

Auto 生效时，headless runner 接纳每个任务并在 user source 写入可选字段 `entrypoint: 'headless'`。持久消息在恢复与普通回放时保留此归属。Reviewer 将其文本归为 `caller-instruction`。调用者可以是人或监督 agent；两者都可定义任务，并明确授权 medium 风险动作、准确目标和范围。直接父级指令不能覆盖调用者限制。文件、约束、checkpoint、图片、工具结果和未标记消息不会获得权威。标记来自任务入口，绝不来自提示词内容；不会追补到早期历史。

Headless 在选择权限预设后应用显式 `--approval-policy`。无人值守调用每次都重复 `--permission-mode auto --approval-policy never`，包括恢复时。这保留结构化拒绝，并避免依赖人工应答者。`ask` 仍遵循[审批兜底决策](2026-09-24-auto-review-user-approval-fallback.zh.md)；它不添加 CLI 审批传输。卸载 profile 可能将存活 Auto Session 迁移到 Full access，因此无人值守调用不能只依赖已保存的选择。

JSON 投影在正常输出限制内包含已有的持久错误字段。最终拒绝携带 `AutoReviewDeniedError` / `AUTO_REVIEW_DENIED` 和可选 reviewer 详情；技术或解析失败携带 `AutoReviewFailedError` / `AUTO_REVIEW_FAILED`。两者都不执行工具 body。Agent 执行完成不代表每个请求动作都成功。

## Alternatives considered

**复用浏览器 RPC id。** Headless 调用不是浏览器请求。伪造该身份会将授权耦合到另一种传输，并错误描述持久来源。

**提升每条 user-role 消息。** 插件和恢复历史也提供 user-role 内容。接纳入口需要显式来源字段；仅有消息角色不足以建立权威。

**实时调用者审批通道。** Headless 将 stdin 作为一个任务消费。审批暂停的调用需要双向协议、请求关联、断连与取消处理，以及应答者生命周期。后续调用可以改为提供限定范围的授权并接受新审查，不声称批准了先前调用。

## Consequences

监督者可以使用 Auto 实现修改和运行检查、查看结构化拒绝，并通过修订指令恢复。原生工具让所有支持的工具 body 都经过审查；PTC 内的直接 Node 效果仍不在范围内。Reviewer 仍是可能出错的模型，执行具有完全访问权限的后果，integration 仍保持实验性与显式启用。需要无标记历史指令的权威时，必须重新陈述这些指令。
