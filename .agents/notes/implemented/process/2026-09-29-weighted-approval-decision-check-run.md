# Agent Note: Weighted approval decisions are completed check runs

Status: implemented

English | [中文](2026-09-29-weighted-approval-decision-check-run.zh.md)

## Problem

The weighted approval policy must block merging until its conditions hold, distinguish an unmet condition from a failed evaluation, and let tools that wait for pull-request checks to finish terminate. A draft pull request, insufficient approval points, and an effective `CHANGES_REQUESTED` review from a write-capable reviewer are reversible review states rather than evaluation failures.

Commit statuses offer only `pending`, `success`, `failure`, and `error`. A `pending` commit status blocks merging, but `gh pr checks --watch` and other CI watchers treat it as running work and wait until someone approves. A `failure` commit status ends the wait but reports an unmet, reversible condition as a malfunction and conflates the policy outcome with publisher health.

## Decision

The [publisher](../../../../.github/review-ownership/check-approval.mjs) reports the decision as the `weighted approval decision` check run on the pull-request head, written with the job's GitHub Actions token. Branch rules require that check run with GitHub Actions as its expected source.

| Condition | Check run |
|---|---|
| Dependency setup or evaluation in progress | `in_progress` |
| Draft, fewer than the required points, or an effective write-capable `CHANGES_REQUESTED` review | `completed`, conclusion `action_required` |
| Ready, threshold met, and no blocking review | `completed`, conclusion `success` |
| Setup or evaluation failure | `completed`, conclusion `failure` |

A blocking review dominates the point total, so the conclusion remains `action_required` even when counted approvals reach the threshold. GitHub accepts only `success`, `neutral`, and `skipped` for a required check, so `action_required` blocks merging while completing the check.

The publisher lists the head's check runs with that name, updates every run owned by GitHub Actions, and creates one only when none exists. An incomplete list or a run without a valid ID fails the publication.

## Verification

[Approval policy tests](../../../../.github/review-ownership/check-approval.test.mjs) pin the threshold-reaching blocker case, the exact published check-run payloads, updating an existing run instead of creating another, and invalid list responses. [Workflow tests](../../../../scripts/ci-workflow.spec.ts) pin the `checks: write` permission, the `in_progress` and `failure` phase commands, and the separate publisher job name.

## Alternatives considered

**Keep the `pending` commit status.** Branch rules block correctly, but CI watchers cannot distinguish an approval wait from running checks and do not finish.

**Publish `failure` for unmet conditions.** This ends the wait, but it represents an unmet, reversible merge condition as a malfunction and conflates the policy outcome with publisher health.

**Publish nothing until success.** A required check that was never reported remains expected and is invisible to many watchers. Revoking a success already published on the same head still requires a non-success write, and each watcher's treatment of a missing required check is unspecified.

**Keep the `weighted approval` name.** When a check and a commit status share a required name, GitHub requires both to pass. Heads that carry a `pending` commit status from the earlier publisher would stay blocked until a new push.

**Create a new check run on every evaluation.** Several same-name check runs on one head make the result depend on how GitHub and each watcher select among them.

**Let approval points override a blocking review.** This makes the score the only success condition, but it permits success while a write-capable reviewer's effective decision still requests changes.

## Consequences

CI watchers finish while the decision waits on reviewers. `gh pr checks` groups `action_required` with failed checks and exits non-zero; consumers distinguish it by the check name, the `ACTION_REQUIRED` conclusion, or the output title, which carries the score or blocker. The `weighted approval publisher` Actions job and the `failure` conclusion carry operational failures.

Revoking an earlier success on the same head returns the completed check run to `in_progress`, a transition the GitHub REST reference does not restrict.
