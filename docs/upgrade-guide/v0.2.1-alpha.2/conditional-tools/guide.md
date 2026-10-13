---
kind: upgrade-guide
description: "Step provider, model, and reasoning-effort selection moves from `agent/request` to `agent/model`, and custom tool and prompt plugins must use step-owned tool admission."
---

# Update step model selection, conditional tools, and prompt hooks

English | [中文](guide.zh.md)

## Change

`agent/model` returns each step's `ModelSelection` (provider, model, and optional reasoning effort) before `system-prompt/prepare` and `agent/pre-step`. Prompt preparation, `agent/pre-step` through its new `modelSelection` payload field, tool conditions, and every request attempt in the step use that selection. `agent/request` still runs for each attempt after prompt assembly and `step/start`, but it may change only sampling controls such as `maxTokens`, `temperature`, and `stop`; returning another provider, model, or reasoning effort fails the step. An agent without options provider and model must receive them from `agent/model`. Plugins that replaced the provider, model, or effort in `agent/request`, including on a retry, are affected. `installModelSelection` applies its selection through `agent/model`, and `ModelSelectionRef` no longer has `assembled`.

Runtime context preparation uses `system-prompt/prepare`; `system-prompt/assemble` receives presentation fields without a tool array. Tool declarations remain owned by registered providers. Conditional tools require a resolved step set for execution, including nested PTC calls. Replacing a registration does not authorize an outstanding call to run the replacement.

`exit_plan_mode` is offered only while committed plan mode is active. A failed plan-state write stops step admission and keeps the pending selection. Existing Sessions require no format migration.

## Migration

1. Move provider, model, and reasoning-effort replacement from `agent/request` listeners to `agent/model` listeners that return `{ provider, model, reasoningEffort? }`; an omitted effort uses the model's provider default. Keep only sampling changes in `agent/request`. Read the selection from `payload.modelSelection` in `agent/pre-step` and from `AssembleContext.modelSelection` in prompt providers.
2. Declare tool conditions with `ctx.tools.register(definition, { when })`; the condition receives `{ agent, modelSelection, signal }`.
3. Move runtime-context preparation listeners to `system-prompt/prepare`. Keep presentation changes in `system-prompt/assemble` and stop replacing its tool list.
4. For programmatic conditional calls, resolve `{ agent, modelSelection, signal }` through `ctx.tools.resolve()`, pass the resulting `toolSet` to assembly and execution, and dispose it after the batch settles. AgentLoop does this once per step for model calls. Pass `context.toolSet` when tool guidance queries `ctx.tools.get()` or `schemas()`.
5. Remove `assembled` from `ModelSelectionRef` objects, and add `modelSelection` to `agent/pre-step` payloads that tests dispatch directly. Verify that inactive tools are absent from declarations, that a historical name returns `UNKNOWN_TOOL` without reaching the implementation, and that an `agent/request` listener changing the model or effort ends the turn with an error naming `agent/model`.
