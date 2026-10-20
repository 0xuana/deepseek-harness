# Agent Note: Weighted approval claims its commit status and aggregates conclusions on a check run

Status: implemented

[English](2026-10-20-weighted-approval-status-gate-with-check-run-label.md) | 中文

## 问题

批准门禁必须在策略满足前阻止合并、在检查完成后让等待检查的工具结束，并把被阻止的状态命名给读者。commit status 没有 action-required 状态，因此 `pending` 会把等待批准与正在运行的检查混在一起，使 `gh pr checks --watch` 一直等待评审人。check run 可以承载 `action_required`，但用默认分支 workflow 的 token 发布的 check run 不被本仓库的分支规则匹配：把门禁改到必需 check run 之后，API 与 `gh pr checks` 都报告该 run 已完成，而合并框一直显示 `Expected — Waiting for status to be reported`，两个 PR 需要管理员绕过才能合并。该改动已回退。

## 决定

publisher 每次评估写两条记录：

- 必需的 `weighted approval` commit status 承载门禁：仅在策略满足时结论为 `success`，否则为 `failure`，因此它总是完成，不会以 `pending` 等待。
- `weighted approval decision` check run 承载标签：策略未满足时为 `action_required`，满足时为 `success`，安装或评估失败时为 `failure`。它不是必需的。

分支规则要求该 commit status，且以 GitHub Actions 为期望来源——这正是本 workflow 发布的记录，也是本次变更前 ruleset 匹配的记录。

publisher 在 Python 安装或 lexer 安装前把 status 重新发布为 `pending`，因此安装失败或历史拉取中断不会留下旧的 success。它把自己写入的结论记录到 step output，安装失败步骤只在没有记录结论时运行，因此已发布的决策能在之后的失败或取消中保留，而在该写入之前被取消的 run 以 `failure` 结束。决策 check run 每个 head 只保留一个 GitHub Actions run：publisher 更新 head 上已有的 run，仅在不存在时创建；撤销已发布的成功时改写其 conclusion，因为 GitHub 接受但不执行改回 `in_progress` 的更新。

## 验证

[批准策略测试](../../../../.github/review-ownership/check-approval.test.mjs)锁定每个策略结果对应的 status 结论、check run payload、通过 conclusion 撤销已发布的成功、更新已有 check run 而不是另建一个、记录已发布的结论，以及无效的列表响应。[工作流测试](../../../../scripts/ci-workflow.spec.ts)锁定两个写权限、`revoke` 与 `failure` 阶段命令、publish 步骤的身份，以及按结论控制的兜底。

check run 的限制于 2026-10-20 在本仓库用上一版设计实测：`weighted approval decision` check run 在 PR head 上以 `success` 完成，REST API 与 `gh pr checks` 都能列出它，而合并框始终把同一上下文报告为 expected；合并需要管理员绕过。

## 考虑过的替代方案

**把 check run 作为必需检查。** 这正是被回退的改动；上面的实测表明 ruleset 不匹配它，因此门禁无法满足。

**策略未满足时把 commit status 发布为 `pending`。** 分支规则能正确阻止合并，但监控工具无法区分等待批准与检查仍在运行，因此不会结束。

**只发布 check run。** 标签正确，但没有任何被分支规则匹配的记录承载门禁。

**每次评估完成都把 commit status 发布为 `success`。** 策略未满足时门禁也会通过。

**由专用 GitHub App 发布必需 check run。** 由 ruleset 指定 app 的 check run 可以让必需条目本身携带 action-required 结论。本仓库没有具备 checks 权限的 App，因此本次变更用 commit status 承载门禁、用 check run 承载标签；新增 App 后可以把标签移到必需记录上。

## 后果

评审未完成时，合并框把 `weighted approval` 报告为失败，旁边是显示 `action_required` 的 `weighted approval decision` 条目。区分这两条记录的读者能同时看到门禁与标签；`gh pr checks` 会列出两者，并且因为二者都已完成而结束。上一次评估的 `success` 通过把 status 改写为 `pending` 撤销，在策略决定后改写为新结论。
