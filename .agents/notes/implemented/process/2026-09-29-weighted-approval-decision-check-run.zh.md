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
| head 的首次评估 | 写入决策前为 `in_progress` |
| 重新评估已发布 `success` 的 head | 写入决策前 conclusion 为 `action_required` |
| draft、点数少于要求，或存在具有写权限的评审人仍然生效的 `CHANGES_REQUESTED` 评审 | `completed`，conclusion 为 `action_required` |
| 已 ready、达到阈值且没有阻塞性评审 | `completed`，conclusion 为 `success` |
| 安装、评估或取消导致的失败 | `completed`，conclusion 为 `failure` |

已经到达 `completed` 的 check run 不会再回到 `in_progress` 或 `queued`：GitHub 对该更新返回 `200`，但让 run 保持已完成，因此只有 conclusion 可变。publisher 因此在依赖安装前用阻塞性 conclusion 撤销已发布的成功，覆盖冷启动中占主要耗时的安装与历史拉取。同一 head 上只保留一个同名 GitHub Actions run：publisher 更新 head 上已有的 run，仅在不存在时创建一个。列表不完整或 run 没有有效 ID 时发布失败。决策已发布后被取消的 run 保留该决策；其余失败或被取消的 run 都以 `failure` 结束。

阻塞性评审的优先级高于点数总和，因此即使计入的批准已经达到阈值，conclusion 仍为 `action_required`。GitHub 只接受 `success`、`neutral` 和 `skipped` 作为必需检查的通过结果，因此 `action_required` 会阻止合并，同时让该检查处于完成状态。

## 验证

[批准策略测试](../../../../.github/review-ownership/check-approval.test.mjs)锁定已达到阈值但仍有 blocker 的场景、准确发布的 check run payload、通过 conclusion 撤销已发布的成功、更新已有 run 而不是另建一个，以及无效的列表响应。[工作流测试](../../../../scripts/ci-workflow.spec.ts)锁定 `checks: write` 权限、`revoke` 和 `failure` 阶段命令、publish 步骤的身份，以及运行失败或在发布前被取消时执行的兜底步骤。

转换矩阵与该兜底条件于 2026-09-30 在本仓库用一次性 tag 运行实测，使用的是与 publisher 相同的 GitHub Actions token。以 `in_progress` 创建、以 `success` 完成的 run，接受 `status: in_progress` 和 `status: queued` 的更新时都返回 `200` 并保持 `completed`；只改 conclusion 的更新把它依次改为 `action_required`、`success` 和 `failure`。兜底步骤在发布失败以及在发布步骤执行期间被取消时运行，而在决策发布之后才取消 job 时不运行。

## 考虑过的替代方案

**保留 `pending` commit status。** 分支规则能正确阻止合并，但 CI 监视工具无法区分等待批准与仍在运行的检查，因此不会结束。

**为尚未满足的条件发布 `failure`。** 该方案能结束等待，但会把尚未满足且可撤销的合并条件表示为故障，并混淆策略结果与 publisher 的健康状态。

**通过把已完成的 run 改回 `in_progress` 来撤销。** GitHub 接受该更新但不执行，因此已发布的成功会在依赖安装与历史拉取期间继续存在。

**在成功之前不发布任何结果。** 从未上报的必需检查保持 expected 状态，许多监视工具看不到它。撤销同一 head 上已发布的成功仍然需要写入非成功结果，而各监视工具如何对待缺失的必需检查没有规定。

**保留 `weighted approval` 名称。** 当 check 和 commit status 使用同一个必需名称时，GitHub 要求两者都通过。带有旧 publisher 所写 `pending` commit status 的 head 会一直被阻止，直到出现新的 push。

**每次评估都创建新的 check run。** 同一 head 上存在多个同名 check run 时，结果取决于 GitHub 和各监视工具如何在其中选择。

**允许批准点数覆盖阻塞性评审。** 该方案会让分数成为唯一的成功条件，但也允许在具有写权限的评审人仍然有效地要求修改时发布成功结果。

## 后果

决策等待评审人时，CI 监视工具会结束。`gh pr checks` 把 `action_required` 与失败的检查归为一组并以非零状态退出；消费方可以通过 check 名称、`ACTION_REQUIRED` conclusion 或携带分数或 blocker 的输出标题加以区分。`weighted approval publisher` Actions job 和 `failure` conclusion 承载运行故障信号。

重新评估已经发布 `success` 的 head 时，在新决策写入前会报告 `action_required`，因此在该窗口内轮询的监视工具会看到失败的检查。本次变更之前创建的 head 会保留原有的 `weighted approval` commit status：没有任何 API 能完成或删除 commit status，因此这些 head 对监视工具一直是 pending，直到它们收到新的 commit。
