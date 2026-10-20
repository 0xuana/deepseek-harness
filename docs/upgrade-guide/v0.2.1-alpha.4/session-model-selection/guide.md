---
kind: upgrade-guide
description: "Session model choices are fixed at step preparation, and projection types move to their owning package."
---

# Session model selection applies at the next step

English | [中文](guide.zh.md)

## Change

ACP model and reasoning changes take effect at the next model step, including a tool continuation in the current turn. Previously, ACP pinned the selection for the complete prompt turn. A prepared step and its retries retain their captured selection. Image admission checks the route selected when admission begins; a later option change can select a different route before the step starts.

`dsh-agent-model` provides `ctx.agentModel` and owns the durable `modelSelection` projection. The API Session controller no longer registers it. Programmatic resume restores recorded choices, including unused selections, before falling back to `AgentOptions`. Configured Agent-loop resumes, headless adoption, and SDK resume record their deployment route; an omitted effort preserves saved explicit effort only for the same route.

Plugins must select provider, model, and optional explicit reasoning effort before prompt assembly. `agent/request` is deprecated. Existing listeners still run on each main-loop request attempt and can adjust other controls, but cannot change provider or model, or add, change, or clear reasoning effort. Absent effort still resolves through adapter defaults on each attempt. Auxiliary calls such as compaction do not dispatch this event. `installModelSelection` and `ModelSelectionRef` are removed.

The client projection and Host state types move to `dsh-agent-model/types`; the API package no longer exports them.

## Migration

1. In custom Cordis compositions, mount `dsh-session-projection` and `dsh-agent-model`. Consumers inject `agentModel`; shipped bundles include it.
2. Replace mutable references and selection hooks with `ctx.agentModel.select(agent, selection)` after validation. Read with `resolveForNextStep(agent)`. Replace switch-notice helpers by importing the `@deepseek-ai/dsh-agent-model/notice` plugin and awaiting `agentCtx.plugin(ModelSwitchNotice)` in Agent setup. Do not add `agent/request` listeners.
3. Set the output cap through `AgentOptions.maxTokens`. Other per-request control overrides have no replacement API; retain an existing listener where that behavior is still required.
4. To override a saved route during programmatic resume, call `ctx.agentModel.applyConfiguredRoute(agent, selection)` in the Agent setup callback. Supplying `agentOptions` alone provides only a fallback for a Session without a selection or request.
5. Pass the captured `Readonly<ModelSelection>` in `agent/pre-step.callConfig`, including explicit effort when selected; `AssembleContext.callConfig` carries the same selection. Direct `SessionReferenceResolver.prepare()` callers pass the route as the fourth argument, before the optional signal.
6. ACP controllers that require one model throughout a turn must wait for the active prompt to finish before changing its options. Verify that a mid-turn change is recorded as `model/selection`, the next step uses it, and resume retains an unused choice.
7. Import `ModelSelectionProjection` from `@deepseek-ai/dsh-agent-model/types`, replacing Agent/API package aliases. `ModelSelection` remains in `dsh-agent/types`. Replace named Host state imports with `SessionProjectionStateMap['modelSelection']` after importing the new `/types` module; ordinary reads use `resolveForNextStep()`. Effort values use `ReasoningEffortId` from `dsh-llm/brand`.
