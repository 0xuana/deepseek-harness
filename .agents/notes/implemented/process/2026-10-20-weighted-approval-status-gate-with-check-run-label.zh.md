# Agent Note: Weighted approval 保留 commit status 门禁，并由 App 发布决策标签

Status: implemented

[English](2026-10-20-weighted-approval-status-gate-with-check-run-label.md) | 中文

## 问题

`weighted approval` commit status 是本仓库分支规则要求的记录，在批准阈值下方时保持 `pending`。commit status 没有 action-required 状态，读者无法区分等待批准与正在运行的工作。

check run 可以承载这个状态，但 GitHub 通过创建它的 workflow run 的 check suite 把 check run 关联到 PR，而 `pull_request_target` 的 run 不与该 PR 关联。2026-10-20 实测到两个后果：把门禁改成用 job token 发布的必需 check run 后，合并框把该上下文报告为 `Expected — Waiting for status to be reported`，而 REST API 与 `gh pr checks` 都显示已完成，两个 PR 需要管理员绕过，该改动已回退；把标签改成用 job token 发布的非必需 check run 后，它完全不进合并框——Checks 页能列出，合并框里没有任何 `weighted-approval` 条目。

## 决定

publisher 继续完全按原样写 `weighted approval` commit status：策略未满足时为 `pending`，满足时为 `success`，安装或评估失败时为 `error`。分支规则继续要求该 status。该行为——包括未满足的策略保持 `pending`——正是[已归档决定](../../archived/process/2026-09-09-blocked-weighted-approvals-remain-pending.md)记录的；本次变更在该门禁旁边新增标签，而不改变门禁。

publisher 用从专用批准 App 铸造的 token（`actions/create-github-app-token`，使用 `vars.DSH_APPROVAL_APP_CLIENT_ID` 与 `secrets.DSH_APPROVAL_APP_PRIVATE_KEY`，权限限定为 `checks: write`）写 `weighted approval decision` check run。check suite 因此归 App 所有并与 PR head 关联，合并框会列出该标签。策略未满足时结论为 `action_required`，满足时为 `success`，安装或评估失败时为 `failure`；标题携带分数或 blocker。分支规则不要求该 check run，因此它从不阻止合并。

status 与 check run 通过两个独立的 API client 写入：status 门禁使用 job token，只有 check-run 调用使用 App token。token 步骤失败或 check-run 写入失败会被记录，且从不改变 status，因此 App 权限缺失时门禁照常工作，标签只出现在 Checks 页。

每个 head 只保留一个 App run：publisher 更新 head 上已有的 run，仅在不存在时创建。setup 阶段对没有 run 的 head 以 `in_progress` 创建，并把已发布的 success 的 conclusion 改写为 `action_required`，因为 GitHub 接受但不执行改回 `in_progress` 的更新。publisher 用创建时设置的 `external_id` 标记识别自己的 run，从而排除 workflow job 为同名 job 产生的 check run。

## 验证

[批准策略测试](../../../../.github/review-ownership/check-approval.test.mjs)锁定未改动的 status 状态、策略满足与未满足两种情况下 check run 的 conclusion、阶段写入、通过 conclusion 撤销已发布的成功、每个 head 只有一个 run、无效的列表响应、标签写入失败时 status 的兜底，以及 status client 与 check-run client 的分离。[工作流测试](../../../../scripts/ci-workflow.spec.ts)锁定 `checks: write` 与 `statuses: write` 权限、App token 步骤及其唯一的密钥引用、`DECISION_TOKEN` 的接线，以及 setup 阶段命令。

check run 的关联限制于 2026-10-20 在本仓库用回退的尝试与上一版尝试实测：用 job token 发布的必需 check run 在合并框里保持 `Expected`；用 job token 发布的非必需 check run 不在合并框的检查列表中，而 Checks 页能列出它。

## 考虑过的替代方案

**用 job token 发布标签、只接受 Checks 页可见。** 这正是本次变更要替换的状态；合并框永远不列该标签，会话页只显示 pending 的 status。

**把 App check run 设为必需检查来替代 commit status。** App check run 已关联 PR，可以承载门禁。但那需要把 ruleset 改成该 App 的 integration 并为开放 head 做迁移；本次保留已验证的 status 门禁，只把标签移到 App。

**策略未满足时把 commit status 发布为 `failure`。** status 会完成，但改变了必需记录的含义，并把尚未满足且可撤销的条件报告为故障。

**只发布 check run 而不动 status。** status 会保留上一次评估的状态，门禁与标签可能不一致。

## 后果

合并框现在同时列出 `weighted approval`（门禁，评审未完成时为 pending）与 `weighted approval decision`（`action_required`，标题里是分数或 blocker）。若 App token 无法铸造，标签退回 job token，只出现在 Checks 页；门禁不受影响。job 在 `pending` 写入与兜底步骤之间结束（例如 runner 丢失，或取消导致最后一步未执行）会让 status 保持 `pending`；这是该 status 既有的表现，不是新增标签带来的回归。
