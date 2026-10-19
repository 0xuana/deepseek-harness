# Agent Note: Deprecated projection registration compatibility

Status: implemented

English | [中文](2026-10-19-session-projection-compatibility.zh.md)

## Problem

Existing external plugins use the disposer returned by projection registration and read state through the registry. Asynchronous retained readers improve acquisition and cleanup ownership, but removing those runtime operations forces unrelated plugins to migrate together.

## Decision

The [retained-reader decision](2026-10-12-session-projection-registration-handles.md) remains the normal API. A registration is Promise-compatible and callable: awaiting it yields a handle, while calling it preserves the old disposal operation. The callable value is the original Cordis effect disposer so a composed effect can adopt its ownership and control release order. Keyed reads remain a deprecated runtime API returning `unknown`. TypeScript consumers migrate their declarations; the old host state map and generic signatures are not restored. Each registry instance owns one-time console warnings for legacy registration and keyed reads; warning state has no process-global owner.

Definition installation stays synchronous and handle delivery stays asynchronous. The registry observes acquisition and the existing `fiber.await()` result without changing Cordis or delaying activation. After startup settles, an unobserved registration rejection is logged and the calling plugin is disposed through its existing API, unless the owner is already unloading or disposed. This leaves a brief interval when its services can be visible and ends in `DISPOSED` rather than retryable `FAILED`; failure containment does not join the activation promise. A plugin that explicitly observes the returned Promise retains error-handling responsibility, including when it awaits registration later in its asynchronous initialization.

This partially supersedes the earlier decision's unconditional migration requirement. Retained handles still fold after release, keyed reads still lose access after the final release, and new code uses private handles or owning domain services. Synchronous `try/catch` cannot catch asynchronous acquisition failure. Compatibility relies on the current synchronous definition installation; introducing asynchronous preparation requires revisiting legacy consumers that read before activation rather than silently returning incomplete state.

## Alternatives considered

**Require every external plugin to migrate immediately.** This makes the retained-reader change a deployment-wide coordination requirement even for plugins that only register during initialization and read after activation.

**Return a new wrapper around the disposer.** Cordis composition adopts effects by their original returned identities. A wrapper leaves the original registration independently owned, so owner disposal can release it before the composed cleanup finishes.

**Automatically delay every effect or event listener.** These operations already have synchronous consumers and initialization-time observers. The compatibility requirement belongs to projection acquisition; changing unrelated effect timing would create a larger migration.

## Consequences

Legacy plugins can migrate independently while new code keeps explicit asynchronous acquisition. The compatibility layer retains synchronous runtime composition and once-per-registry diagnostics. An async function or async generator assimilates the callable thenable into its handle, so legacy async return/yield composition still requires migration. Native-Promise-only consumers use `Promise.resolve(registration)`. Focused tests cover modern error recovery, ignored rejection reporting and disposal, callable and composed disposal, owner unload during acquisition, and independent warning ownership. A real Loader subprocess exercises an unchanged-style plugin against the package entry points and verifies its reads and console warnings.
