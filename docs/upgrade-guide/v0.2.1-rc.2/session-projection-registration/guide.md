---
kind: upgrade-guide
description: "Session projection registration returns a callable thenable instead of a native Promise."
---

# Session projection registration returns a callable thenable

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-session-projection` keeps the declared `register(definition): Promise<ProjectionHandle<S>>` API, but its runtime return value changes from a native Promise to a callable thenable. `await`, `.then()`, `.catch()`, and `.finally()` still deliver the same retained handle. `typeof registration` is now `"function"`, and `registration instanceof Promise` is false. Code that branches on those checks or treats functions as callbacks is affected; Vitest's `.rejects` can call the disposer instead of observing the registration error.

The callable value supports deprecated synchronous disposer usage by compiled plugins. Registry-level `stateOf(session, key): unknown` is also available again as a deprecated runtime API; new code reads through retained handles. Async return/yield assimilates it into the handle, which is not a valid Cordis effect. See [runtime compatibility](../../../../packages/session/session-projection/README.md#deprecated-plugin-compatibility) for warning timing and ignored-error handling.

## Migration

1. Keep awaiting `ctx.sessionProjections.register(definition)` and use the returned handle's `stateOf(session)` and `dispose()` methods. In async plugins or effects, await registration and return `void`; the owning fiber releases the registration automatically.
2. Where a native Promise is required, pass `Promise.resolve(registration)`. Replace checks on the registration's `typeof` or `instanceof Promise` with ordinary awaiting. In Vitest, write `await expect(Promise.resolve(registration)).rejects.toThrow(...)`.
3. Run plugin initialization and disposal tests, including a rejected registration. Confirm that the expected registration error is observed and released registrations no longer participate in snapshots.
