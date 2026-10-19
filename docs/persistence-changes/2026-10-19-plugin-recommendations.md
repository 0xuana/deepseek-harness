---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-19-plugin-recommendations

English | [中文](2026-10-19-plugin-recommendations.zh.md)

## Summary

Adds a plugin-recommendation message source for the notice queued after a user enables a recommended official plugin.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-19-plugin-recommendations
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "77a13807c15400b23a7ef7bb6920787b6eba466c3f3ecf63d39552176c36b3fb"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "a6cc709dc063ad3d5a3755416ce4cba0c6dd7afab82e7d3a7ee27a5c22ed20f7"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "34cdaafedea27447895eb9f7f51a9da1b1de6c36c7415d7e76a72f1002e84214"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "784aaa6de3e5e3d2aaad0fe35c139e9a5ad4797d85587ac5676ae5561bc4dbb7"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing sources and records are unchanged, so the new reader accepts existing sessions. The added kind is merge-extensible MessageSource metadata and carries the established notice form with its required summary. Older consumers fall through unfamiliar source kinds and can present the notice form and unchanged message content; no new required event discriminator or reinterpretation of an existing kind is introduced. The notice records a completed profile action and never replays that action when a session is read. Experimental decision receipts use the existing ignorable plugin-record envelope.

<a id="verification"></a>
## Verification

Focused Host and Client tests: 28 passed with 100% affected-source coverage. The Loader/HMR composition test enables a real optional package, verifies the saved profile, and observes the same Agent consuming the continuation notice. Tests cover replayed decisions, duplicate actions, failed activation, and disposal.

<a id="dev-note"></a>
## Dev Note

None.
