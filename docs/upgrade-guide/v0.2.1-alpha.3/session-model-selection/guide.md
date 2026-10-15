---
kind: upgrade-guide
description: "Session model choices now apply at step preparation, and request listeners must preserve the selected route."
---

# Session model selection applies at the next step

English | [中文](guide.zh.md)

## Change

ACP model and reasoning changes take effect at the next model step, including a tool continuation in the current turn. Previously, ACP pinned the selection for the complete prompt turn. A prepared step and its retries retain their captured selection. Image admission checks the route selected when admission begins; a later option change can select a different route before the step starts.

The Agent registry now requires `sessionProjections` and owns the durable `modelSelection` projection. Programmatic resume restores recorded choices, including a selection not yet used by a request, before falling back to `AgentOptions`. Configured Agent-loop resumes, headless adoption, and SDK resume explicitly record their deployment route.

Plugins must select a complete provider/model route before prompt assembly. `agent/request` can adjust controls but rejects provider or model changes. `installModelSelection` and `ModelSelectionRef` are removed; selection readers and writers use the shared Session projection.

## Migration

1. In custom Cordis compositions, mount `dsh-session-projection` before `dsh-agent`.
2. Replace mutable selection references and route-changing `agent/request` listeners with `recordModelSelection(ctx.sessionProjections, agent, selection)` from `@deepseek-ai/dsh-agent`. Validate the route before recording it. Use `currentModelSelection()` to read the choice and `installModelSwitchNotice(agent.ctx)` when the composition needs a durable model-switch notice.
3. To override a saved route during programmatic resume, call `recordDeclaredRoute()` in the Agent setup callback. Supplying `agentOptions` alone provides only a fallback for a Session without a selection or request.
4. Pass the fixed route in `agent/pre-step.callConfig` when dispatching that event. Direct `SessionReferenceResolver.prepare()` callers pass the route as the fourth argument, before the optional signal.
5. ACP controllers that require one model throughout a turn must wait for the active prompt to finish before changing its options. Verify that a mid-turn change is recorded as `model/selection`, the next step uses it, and resume retains an unused choice.
