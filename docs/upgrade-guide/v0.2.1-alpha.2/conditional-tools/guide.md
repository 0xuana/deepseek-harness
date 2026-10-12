---
kind: upgrade-guide
description: "Step routing moves from `agent/request` to `agent/route`, and custom tool and prompt plugins must use step-owned tool admission."
---

# Update step routing, conditional tools, and prompt hooks

English | [中文](guide.zh.md)

## Change

`agent/route` chooses each step's provider and model before `system-prompt/prepare` and `agent/pre-step`. Prompt preparation, `agent/pre-step` through its new `route` payload field, tool conditions, and every request attempt in the step use that route. `agent/request` still runs for each attempt after prompt assembly and `step/start`, but it may change only call controls such as `reasoningEffort`; returning another provider or model fails the step. An agent without an options route must receive one from `agent/route`. Plugins that replaced the provider or model in `agent/request`, including on a retry, are affected.

Runtime context preparation uses `system-prompt/prepare`; `system-prompt/assemble` receives presentation fields without a tool array. Tool declarations remain owned by registered providers. Conditional tools require a resolved step set for execution, including nested PTC calls. Replacing a registration does not authorize an outstanding call to run the replacement.

`exit_plan_mode` is offered only while committed plan mode is active. A failed plan-state write stops step admission and keeps the pending selection. Existing Sessions require no format migration.

## Migration

1. Move provider and model replacement from `agent/request` listeners to `agent/route` listeners that return `{ provider, model }`; keep only control changes in `agent/request`. Read the route from `payload.route` in `agent/pre-step` and from `AssembleContext.route` in prompt providers.
2. Declare tool conditions with `ctx.tools.register(definition, { when })`; the condition receives `{ agent, route, signal }`.
3. Move runtime-context preparation listeners to `system-prompt/prepare`. Keep presentation changes in `system-prompt/assemble` and stop replacing its tool list.
4. For programmatic conditional calls, resolve `{ agent, route, signal }` through `ctx.tools.resolve()`, pass the resulting `toolSet` to assembly and execution, and dispose it after the batch settles. AgentLoop does this once per step for model calls. Pass `context.toolSet` when tool guidance queries `ctx.tools.get()` or `schemas()`.
5. Add `route` to `agent/pre-step` payloads that tests dispatch directly. Verify that inactive tools are absent from declarations, that a historical name returns `UNKNOWN_TOOL` without reaching the implementation, and that an `agent/request` listener changing the model ends the turn with an error naming `agent/route`.
