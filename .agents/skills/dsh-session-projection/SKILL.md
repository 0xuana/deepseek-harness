---
name: dsh-session-projection
description: Use when creating, extending, or reviewing a DeepSeek Harness session projection, or migrating a fold helper to one.
---

# DeepSeek Harness Session Projections

Follow the [projection API](../../../packages/session/session-projection/README.md) for registration and lifecycle details.

1. Decide whether to extend an existing projection or create one; check whether an existing owner already maintains the needed state.
2. Keep projection definitions and handles private to the owning service's implementation. Expose domain methods to consumers, not projection definitions.
3. A service that stores its data in projections should normally require `sessionProjections` in its Cordis dependencies.
4. Evaluate retained state size as the session grows. Do not accumulate state proportional to session length, including collections of event sequence numbers. Growth is acceptable only when slow enough to remain negligible. When the data would keep growing, consider incremental loading instead of retaining the complete state.
5. `apply` is synchronous and cannot read arbitrary historical events asynchronously. When later reads need event payloads, consider storing sequence numbers and letting state consumers resolve them asynchronously.
6. When migrating from `foldXXX`, remove the superseded fold helper.
7. Do not add calls to deprecated readers such as `snapshotEvents` or `eventAt`. Assume the full event log is not resident in memory and random reads may require asynchronous disk access.
8. Consider performance, but do not complicate the design without a concrete need.
