# Agent Note: 加权批准决策使用已完成的 check run

Status: implemented

[English](2026-09-29-weighted-approval-decision-check-run.md) | 中文

## 问题

加权批准策略必须在条件满足之前阻止合并，区分尚未满足的条件与失败的评估，并让等待 PR 检查结束的工具能够退出。draft PR、批准点数不足，以及具有写权限的评审人仍然生效的 `CHANGES_REQUESTED` 评审，都是可撤销的评审状态，而不是评估故障。

commit status 只提供 `pending`、`success`、`failure` 和 `error`。`pending` commit status 会阻止合并，但 `gh pr checks --watch` 和其他 CI 监视工具把它当作仍在运行的工作，会一直等到有人批准。`failure` commit status 能结束等待，但会把尚未满足且可撤销的条件报告为故障，并混淆策略结果与 publisher 的健康状态。

## 决策

[publisher](../../../../.github/review-ownership/check-approval.mjs) 使用该 job 的 GitHub Actions token，在 PR head 上以 `weighted approval decision` check run 报告决策。分支规则要求该 check run，并把 GitHub Actions 设为预期来源。

| 条件 | Check run |
|---|---|
| 依赖安装或评估进行中 | `in_progress` |
| draft、点数少于要求，或存在具有写权限的评审人仍然生效的 `CHANGES_REQUESTED` 评审 | `completed`，conclusion 为 `action_required` |
| 已 ready、达到阈值且没有阻塞性评审 | `completed`，conclusion 为 `success` |
| 安装或评估失败 | `completed`，conclusion 为 `failure` |

阻塞性评审的优先级高于点数总和，因此即使计入的批准已经达到阈值，conclusion 仍为 `action_required`。GitHub 只接受 `success`、`neutral` 和 `skipped` 作为必需检查的通过结果，因此 `action_required` 会阻止合并，同时让该检查处于完成状态。

publisher 列出 head 上同名的 check run，更新所有属于 GitHub Actions 的 run，只有在不存在时才创建一个。列表不完整或 run 没有有效 ID 时发布失败。

## 验证

[批准策略测试](../../../../.github/review-ownership/check-approval.test.mjs)锁定已达到阈值但仍有 blocker 的场景、准确发布的 check run payload、更新已有 run 而不是另建一个，以及无效的列表响应。[工作流测试](../../../../scripts/ci-workflow.spec.ts)锁定 `checks: write` 权限、`in_progress` 和 `failure` 阶段命令，以及独立的 publisher job 名称。

## 考虑过的替代方案

**保留 `pending` commit status。** 分支规则能正确阻止合并，但 CI 监视工具无法区分等待批准与仍在运行的检查，因此不会结束。

**为尚未满足的条件发布 `failure`。** 该方案能结束等待，但会把尚未满足且可撤销的合并条件表示为故障，并混淆策略结果与 publisher 的健康状态。

**在成功之前不发布任何结果。** 从未上报的必需检查保持 expected 状态，许多监视工具看不到它。撤销同一 head 上已发布的成功仍然需要写入非成功结果，而各监视工具如何对待缺失的必需检查没有规定。

**保留 `weighted approval` 名称。** 当 check 和 commit status 使用同一个必需名称时，GitHub 要求两者都通过。带有旧 publisher 所写 `pending` commit status 的 head 会一直被阻止，直到出现新的 push。

**每次评估都创建新的 check run。** 同一 head 上存在多个同名 check run 时，结果取决于 GitHub 和各监视工具如何在其中选择。

**允许批准点数覆盖阻塞性评审。** 该方案会让分数成为唯一的成功条件，但也允许在具有写权限的评审人仍然有效地要求修改时发布成功结果。

## 后果

决策等待评审人时，CI 监视工具会结束。`gh pr checks` 把 `action_required` 与失败的检查归为一组并以非零状态退出；消费方可以通过 check 名称、`ACTION_REQUIRED` conclusion 或携带分数或 blocker 的输出标题加以区分。`weighted approval publisher` Actions job 和 `failure` conclusion 承载运行故障信号。

撤销同一 head 上此前的成功结果时，已完成的 check run 会回到 `in_progress`；GitHub REST 参考文档没有限制这一转换。
