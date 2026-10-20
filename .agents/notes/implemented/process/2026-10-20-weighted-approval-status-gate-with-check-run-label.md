# Agent Note: Weighted approval gates through its commit status and labels the conclusion on a check run

Status: implemented

English | [中文](2026-10-20-weighted-approval-status-gate-with-check-run-label.zh.md)

## Problem

The approval gate must block merging until the policy holds, complete so tools that wait for pull-request checks to finish can end, and name the blocked state for readers. A commit status has no action-required state, so a `pending` status conflates an approval wait with running checks and makes `gh pr checks --watch` wait for reviewers. A check run can carry `action_required`, but a check run published with the default-branch workflow's token is not matched by this repository's branch rules: after the gate was moved to a required check run, the API and `gh pr checks` reported the run complete while the merge box kept showing `Expected — Waiting for status to be reported`, and two pull requests needed an administrator bypass to merge. That change was reverted.

## Decision

The publisher writes two records for every evaluation:

- The required `weighted approval` commit status carries the gate. It concludes `success` only when the policy holds and `failure` when it does not, so it always completes instead of waiting as `pending`.
- The `weighted approval decision` check run carries the label. It concludes `action_required` when the policy is unmet, `success` when it holds, and `failure` when setup or evaluation fails. It is not required.

Branch rules require the commit status with GitHub Actions as its expected source, which is the record this workflow publishes and the ruleset matched before this change.

The publisher republishes the status as `pending` before Python setup or lexer installation, so a failed setup or an interrupted history fetch cannot leave a previous success in place. It records the conclusion it wrote in a step output, and the setup-failure step runs only when no conclusion was recorded, so a published decision survives a later failure or cancellation while a run cancelled before that write concludes `failure`. The decision check run keeps one GitHub Actions run per head: the publisher updates the head's existing run and creates one only when none exists, and revokes a published success through its conclusion because GitHub accepts but does not apply a return to `in_progress`.

## Verification

[Approval policy tests](../../../../.github/review-ownership/check-approval.test.mjs) pin the status conclusion for each policy outcome, the check-run payloads, revoking a published success through its conclusion, updating an existing check run instead of creating another, recording the published conclusion, and invalid list responses. [Workflow tests](../../../../scripts/ci-workflow.spec.ts) pin both write permissions, the `revoke` and `failure` phase commands, the publish step identity, and the conclusion-gated fallback.

The check-run limit was measured on 2026-10-20 with the previous design on this repository: the `weighted approval decision` check run completed as `success` on the pull-request head, the REST API and `gh pr checks` listed it, and the merge box kept reporting the same context as expected; merging required an administrator bypass.

## Alternatives considered

**Require the check run instead of the commit status.** This is what the reverted change did; the measurement above shows the ruleset does not match it, so the gate cannot be satisfied.

**Publish the commit status as `pending` while the policy is unmet.** Branch rules block correctly, but watchers cannot distinguish an approval wait from running checks and do not finish.

**Publish only the check run.** The label is right, but nothing the branch rules match carries the gate.

**Publish the commit status as `success` for every completed evaluation.** The gate would pass while the policy is unmet.

**Publish the required check run from a dedicated GitHub App.** A check run whose app the ruleset names would carry an action-required conclusion on the required entry itself. The repository has no App with the checks permission, so this change uses the commit status for the gate and the check run for the label; adding an App would let the label move onto the required record.

## Consequences

The merge box reports `weighted approval` as failed while reviewers are pending, next to the `weighted approval decision` entry that reads `action_required`. Readers distinguishing the two records see the gate and the label; `gh pr checks` lists both and finishes because both are complete. A previous evaluation's `success` is revoked by rewriting the status to `pending` and, once the policy is decided, to its new conclusion.
