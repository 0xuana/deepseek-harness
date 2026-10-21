# Agent Note: Weighted approval keeps its commit status gate and publishes the decision label from an App

Status: implemented

English | [中文](2026-10-20-weighted-approval-status-gate-with-check-run-label.zh.md)

## Problem

The `weighted approval` commit status is the record this repository's branch rules require, and below the approval threshold it stays `pending`. A commit status has no action-required state, so readers cannot tell an approval wait from running work.

A check run carries that state, but GitHub associates a check run with a pull request through the check suite of the workflow run that creates it, and a `pull_request_target` run is not associated with the pull request. Two consequences were measured on 2026-10-20. Moving the gate to a required check run published with the job token made the merge box report the context as `Expected — Waiting for status to be reported` while the REST API and `gh pr checks` listed it complete, so two pull requests needed an administrator bypass; that change was reverted. Publishing the label as a non-required check run with the job token kept it out of the merge box entirely: the Checks page listed it, and the merge box listed no `weighted-approval` entry at all.

## Decision

The publisher keeps writing the `weighted approval` commit status exactly as before: `pending` while the policy is unmet, `success` when it holds, and `error` when setup or evaluation fails. Branch rules keep requiring that status. That behavior, including keeping an unmet policy `pending`, is what the [archived decision](../../archived/process/2026-09-09-blocked-weighted-approvals-remain-pending.md) records; this change adds the label beside it instead of changing the gate.

The publisher writes the `weighted approval decision` check run with a token minted from the repository App (`actions/create-github-app-token` with the App client ID and private key, scoped to `checks: write`). The check suite then belongs to the App and is associated with the pull-request head, so the merge box lists the label. The conclusion is `action_required` while the policy is unmet, `success` when it holds, and `failure` when setup or evaluation fails; the title carries the score or the blocker. Branch rules do not require the check run, so it never blocks a merge.

The status and the check run are written through separate API clients: the status gate uses the job token, and only the check-run calls use the App token. A failed check-run token step or a failed check-run write is logged and never changes the status, so the gate keeps working when the App permission is missing and the label then appears only on the Checks page.

A head keeps one App run with the check-run name: the publisher updates the head's existing run and creates one only when none exists. The setup phase creates the run as `in_progress` on a head without one and deals with a published success by rewriting its conclusion to `action_required`, because GitHub accepts but does not apply a return to `in_progress`. The publisher identifies its own runs by the `external_id` marker it sets on creation, which excludes check runs that workflow jobs produce for a same-named job.

## Verification

[Approval policy tests](../../../../.github/review-ownership/check-approval.test.mjs) pin the unchanged status states, the check-run conclusion for a met and an unmet policy, the phase writes, revoking a published success through its conclusion, one run per head, invalid list responses, the status fallback when the label write fails, and the split between the status client and the check-run client. [Workflow tests](../../../../scripts/ci-workflow.spec.ts) pin the `checks: write` and `statuses: write` permissions, the App token step and its single secret reference, the `DECISION_TOKEN` wiring, and the setup phase commands.

The check-run association limit was measured on 2026-10-20 with the reverted and the previous attempts on this repository: a required check run published with the job token stayed `Expected` in the merge box, and a non-required check run published with the job token was absent from the merge box's check list while the Checks page listed it.

## Alternatives considered

**Publish the label with the job token and accept the Checks page only.** That is the state this change replaces; the merge box never lists the label, so the conversation page shows only the pending status.

**Require the App check run instead of the commit status.** The App check run is associated with the pull request, so it could carry the gate. That needs a ruleset change to the App's integration and a migration for open heads; this change keeps the proven status gate and only moves the label onto the App.

**Publish the commit status as `failure` while the policy is unmet.** The status would complete, but this changes the required record's meaning and reports an unmet, reversible condition as a malfunction.

**Publish only the check run and leave the status untouched.** The status would keep its last state from an earlier evaluation, so the gate and the label could disagree.

## Consequences

The merge box now lists `weighted approval` (the gate, pending while reviewers are pending) and `weighted approval decision` (`action_required`, with the score or blocker in its title). If the App token cannot be minted, the label falls back to the job token and stays on the Checks page only; the gate is unaffected. A job that ends between the `pending` write and the fallback step, such as a lost runner or a cancellation that skips the final step, leaves the status `pending`; that is the original symptom of this status, not a regression.
