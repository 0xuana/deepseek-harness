---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-20-personalized-page-status

English | [中文](2026-10-20-personalized-page-status.zh.md)

## Summary

Adds personalized-page status attribution to logged model context.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-20-personalized-page-status
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "1b43047675face5df9ba7646bbbcd873907465dcedcf22ea824f9f088cea2840"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "85d754f8957fcbbfb65bcb6dded47a816c409bb431de293ff3209b11fe093ded"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "9d2c7e74894fb4dbf3af436b09d1e9ae4a631dbdf3c7ebbfb2b490b1279c94b3"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "c81b3891a886d2e40a09d04633ec88918289bb10eee9098ed19d33c1994aa4d8"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing messages and decision records are unchanged. Readers without this plugin preserve the new source kind and its JSON metadata and derive the recorded text as ordinary context. Only the producer uses the through sequence to suppress already delivered notices; it grants no authority and does not change replay interpretation.

<a id="verification"></a>
## Verification

Focused creation, projection, status and card component tests: 68 passed; changed Host modules have 100% coverage. The web creation recording includes dismissal followed by a status question; Host protocol refresh and keyless replay each passed. Cards are replaced or suppressed and never expire; tests cover replacement by a later proposal, suppression while human input is queued, replay, stale clicks, background notices and started-task retries. A late request-preparation callback adds no context after the feature unloads.

<a id="dev-note"></a>
## Dev Note

None.
