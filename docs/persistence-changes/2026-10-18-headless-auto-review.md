---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-18-headless-auto-review

English | [中文](2026-10-18-headless-auto-review.zh.md)

## Summary

Records trusted headless task admission for experimental Auto review in the optional user-source entrypoint field.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-18-headless-auto-review
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "79b4e8af57859669207575df2b9bc24821d6c6a6233394f7f1535f94c50a7285"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "2e608cacf794ca60b6fa29cfedc77ef5524ab71272079107fa04a262af6ea0ed"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "e9e33baf08197572f1815717fb0fa9801a6d6534250566aed7089710591cf5b9"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "18337848615a617607dac7c277a7b4bcc71a13a3e25a0f3b11f32f0853466678"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing messages without entrypoint remain valid and do not acquire caller authority. The current Auto reviewer recognizes only the exact headless marker written by the runner while Auto is active. Earlier reviewers ignore the new field and treat these messages as facts, so they cannot grant new medium-risk authority; a reader that refuses an unknown field fails closed. Browser RPC attribution, direct-parent lineage, and checkpoint constraints remain unchanged. No Session format version change is required.

<a id="verification"></a>
## Verification

Focused headless and Auto review suites: 163 tests passed with 100% coverage of both changed modules. The shipped headless profile exercised allow, deny, malformed response, provider failure, missing integration, and resumed caller attribution. The recorded headless-auto-review scenario verifies that only the allowed target is written.

<a id="dev-note"></a>
## Dev Note

None.
