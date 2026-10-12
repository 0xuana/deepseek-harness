---
kind: upgrade-guide
description: "Session projection registration is asynchronous and returns a retained reader instead of a disposer."
---
# Session projection registration handles

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-session-projection` changes `SessionProjectionRegistry.register(definition)` from a synchronous disposer to `Promise<ProjectionHandle<S>>`. Registry-level `stateOf(session, key)` is removed. Registration errors now reject the returned promise. After the last registration is disposed, the unit leaves snapshots, checkpoints, and live notifications, but retained handles can still fold Session events on demand.

`@deepseek-ai/dsh-subagent` now requires `sessionProjections`. `@deepseek-ai/dsh-api-session-controller` removes `installModelSelectionProjection`; consumers register `modelSelectionProjection` instead. The controller also registers `agentPreset`, whose null value means the Session has no recorded preset; that key does not establish that a preset registry is available. `turnBoundaryProjectionDefinition` is exported by `@deepseek-ai/dsh-agent`; its `agent-loop` re-export remains available.

## Migration

1. Declare `sessionProjections` as a required plugin injection and mount `SessionProjectionRegistry` before consumers, including `SubagentRuntime` in custom compositions.
2. In an asynchronous function-plugin `apply()` or service `[Service.init]()`, await `ctx.sessionProjections.register(definition)` and retain the returned handle before publishing dependent operations. Keep existing function-plugin namespace exports.
3. Replace `registry.stateOf(session, key)` with `handle.stateOf(session)`. Import the owning package's projection definition when a reader needs to acquire a handle itself. Replace stored unregister callbacks with `handle.dispose`; fiber disposal still releases registrations automatically. Await registration when handling initialization failures.
4. Replace `installModelSelectionProjection(ctx)` with `await ctx.sessionProjections.register(modelSelectionProjection)`, importing the definition from `@deepseek-ai/dsh-api-session-controller/src/model-selection-projection.ts`.
5. Typecheck custom plugins, then verify activation, a Session state read, and owner disposal. A released reader remains usable, while the released unit disappears from new snapshots once its final registration is gone.
