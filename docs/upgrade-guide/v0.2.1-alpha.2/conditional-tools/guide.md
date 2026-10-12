---
kind: upgrade-guide
description: "Custom tool and prompt plugins must use request-owned tool admission and the earlier route preparation stage."
---

# Update conditional tools and prompt hooks

English | [中文](guide.zh.md)

## Change

`agent/request` and `prepareCall()` bind the route before `agent/pre-step`. Runtime context preparation uses `system-prompt/prepare`; `system-prompt/assemble` receives presentation fields without a tool array. Tool declarations remain owned by registered providers. Conditional tools require a resolved request set for execution, including nested PTC calls. Replacing a registration does not authorize an outstanding call to run the replacement.

`exit_plan_mode` is offered only while committed plan mode is active. A failed plan-state write stops step admission and keeps the pending selection. Existing Sessions require no format migration.

## Migration

1. Declare tool conditions with `ctx.tools.register(definition, { when })`. Read the bound route through `agent.currentRoute()`; never infer it from initial options or the preceding Session header.
2. Move runtime-context preparation listeners to `system-prompt/prepare`. Keep presentation changes in `system-prompt/assemble` and stop replacing its tool list.
3. For programmatic conditional calls, resolve `{ agent, signal }` through `ctx.tools.resolve()`, pass the resulting `toolSet` to assembly and execution, and dispose it after the batch settles. AgentLoop does this for model calls. Pass `context.toolSet` when tool guidance queries `ctx.tools.get()` or `schemas()`.
4. Update custom Agent implementations with `currentRoute()`, valid only while a main request is bound. Verify that inactive tools are absent from declarations and that a historical name returns `UNKNOWN_TOOL` without reaching the implementation.
