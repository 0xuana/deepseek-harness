---
kind: upgrade-guide
description: "Each step's provider, model, and reasoning effort come from `agent/model` through `agent.step`, plan selections commit at `agent/step-boundary`, and custom tool and prompt plugins must use step-owned tool admission."
---

# Update step model selection, conditional tools, and prompt hooks

English | [中文](guide.zh.md)

## Change

`agent/model` returns each step's `ModelSelection` (provider, model, and optional reasoning effort) after the new serial `agent/step-boundary` event and before `agent/pre-step`. The loop publishes it as `agent.step` until the step ends; `agent/pre-step` listeners, tool conditions, prompt sections, and every request attempt read it there. `agent/request` still runs for each attempt after prompt assembly and `step/start`, but it may change only sampling controls such as `maxTokens`, `temperature`, and `stop`; returning another provider, model, or reasoning effort fails the step. An agent without options provider and model must receive them from `agent/model`. Plugins that replaced the provider, model, or effort in `agent/request`, including on a retry, are affected. `installModelSelection` applies its selection through `agent/model`, and `ModelSelectionRef` no longer has `assembled`.

`system-prompt/assemble` runs once per step after `step/start` and receives presentation fields without a tool array; tool declarations remain owned by registered providers. Pre-step decisions no longer contain the runtime-context message: the snapshot is admitted after the step's accepted messages, and a changed runtime context alone no longer opens a step. Conditional tools require a resolved step set for execution, including nested PTC calls. Replacing a registration does not authorize an outstanding call to run the replacement.

`exit_plan_mode` is offered only while committed plan mode is active. A plan selection made during a turn is committed at the next `agent/step-boundary`, even when `agent/pre-step` rejects that step; a failed write fails the proposal and keeps the selection pending. Existing Sessions require no format migration.

## Migration

1. Move provider, model, and reasoning-effort replacement from `agent/request` listeners to `agent/model` listeners that return `{ provider, model, reasoningEffort? }`; an omitted effort uses the model's provider default. Keep only sampling changes in `agent/request`. Read the step's selection from `agent.step` in `agent/pre-step` listeners, tool conditions, and prompt providers.
2. Declare tool conditions with `ctx.tools.register(definition, { when })`; the condition receives `{ agent, signal }`.
3. Keep presentation changes in `system-prompt/assemble` and stop replacing its tool list. Do not look for the runtime-context message in `agent/pre-step` decisions.
4. For programmatic conditional calls, resolve `{ agent, signal }` through `ctx.tools.resolve()`, pass the resulting `toolSet` to assembly and execution, and dispose it after the batch settles. AgentLoop does this once per step for model calls. Pass `context.toolSet` when tool guidance queries `ctx.tools.get()` or `schemas()`.
5. Commit state that applies from the next step in an `agent/step-boundary` listener. Remove `assembled` from `ModelSelectionRef` objects, and set `step` on test Agents whose pre-step listeners read the model. Verify that inactive tools are absent from declarations, that a historical name returns `UNKNOWN_TOOL` without reaching the implementation, and that an `agent/request` listener changing the model or effort ends the turn with an error naming `agent/model`.
