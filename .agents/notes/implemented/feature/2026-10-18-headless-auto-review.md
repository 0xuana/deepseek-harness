# Agent Note: Headless caller authority for Auto review

Status: implemented

English | [中文](2026-10-18-headless-auto-review.zh.md)

## Problem

An external supervisor can give headless a task and resume its Session, but the existing Auto reviewer recognizes only Web human admission and in-process parent instructions. A headless task has neither a browser RPC identity nor child lineage. Treating it as a fact prevents explicit authorization of medium-risk work; treating every user-role message as an instruction would promote injected content and old unattributed history.

## Decision

The [experimental Auto layer](../../../../packages/experimental/auto-review/README.md#headless-supervision) supports explicit headless selection. Default profiles remain unchanged. This extends the Web-only scope of [per-tool Auto review](2026-08-28-auto-review.md); its risk classes, full-access execution, PTC exclusions, and lifecycle remain authoritative.

While Auto is active, the headless runner admits each task with the optional user-source field `entrypoint: 'headless'`. The durable message keeps this attribution across resume and ordinary replay. The reviewer assigns its text the `caller-instruction` role. The caller may be a human or a supervising agent; both can define the task and authorize an exact medium-risk action, target, and scope. Direct-parent instructions cannot override caller restrictions. Files, constraints, checkpoints, images, tool results, and unmarked messages do not gain authority. The marker comes from task admission, never from prompt contents; it is not retroactively added to earlier history.

Headless applies an explicit `--approval-policy` after selecting the permission preset. An unattended invocation repeats `--permission-mode auto --approval-policy never`, including on resume. This retains the structured denial and avoids dependence on a human answerer. `ask` still follows [the approval fallback decision](2026-09-24-auto-review-user-approval-fallback.md); it does not add a CLI approval transport. Unloading a profile may migrate a live Auto Session to Full access, so saved selection alone is insufficient for an unattended invocation.

The JSON projection includes existing durable error fields under its normal output bounds. A final denial carries `AutoReviewDeniedError` / `AUTO_REVIEW_DENIED` and optional reviewer detail; a technical or parsing failure carries `AutoReviewFailedError` / `AUTO_REVIEW_FAILED`. Neither executes the tool body. Completed agent execution does not imply that every requested action succeeded.

## Alternatives considered

**Reuse a browser RPC id.** A headless invocation is not a browser request. Faking that identity would couple authorization to a different transport and misdescribe the persisted source.

**Promote every user-role message.** Plugins and restored history also supply user-role content. Admission needs an explicit source field; message role alone cannot establish authority.

**A live caller-approval channel.** Headless consumes stdin as one task. Approving a suspended call needs a bidirectional protocol with correlation, disconnect and cancellation handling, and an answerer lifecycle. A later invocation can instead supply scoped authorization and receive a fresh review, without claiming to approve the earlier call.

## Consequences

A supervisor can use Auto for implementation and gates, inspect structured denials, and resume with revision instructions. Native tools keep all supported tool bodies under review; direct Node effects inside PTC remain outside it. The reviewer remains a fallible model with full-access consequences, and the integration remains experimental and opt-in. Unmarked historical instructions must be restated when their authority is needed.
