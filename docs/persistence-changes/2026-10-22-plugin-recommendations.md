---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-22-plugin-recommendations

English | [中文](2026-10-22-plugin-recommendations.zh.md)

## Summary

Adds official-plugin status attribution to logged model context.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-22-plugin-recommendations
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-20-personalized-page-status"
    after: "dde4d210811d670552c70fa7a9864ae650cef357590ad60ef1778c9b7dd1d7bf"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-20-personalized-page-status"
    after: "1adeb5417a9565c55ad63138034d1c51daf6a75f8964c46352691a1d94188265"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-20-personalized-page-status"
    after: "651a11c7869dfbe778ff23bf7e94567b141470b5dbad4a146f93189a4ff24646"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-20-personalized-page-status"
    after: "1ca126460ab395a27ca1d236203c0a8b58eddcc316d681484691bced1b220045"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing messages and decision records are unchanged. Readers without this plugin preserve the new source kind and its JSON metadata and derive the recorded text as ordinary context. Only the producer uses the through sequence to suppress already delivered notices; it grants no authority, and reading a session never replays the reported card decision. Decision receipts use the existing ignorable plugin-record envelope.

<a id="verification"></a>
## Verification

Focused plugin-recommendation projection, status, action and Loader/HMR composition tests: 33 passed; changed Host modules have 100% coverage. Status tests cover delivery on the next request, acknowledgement only after the notice is logged, cancellation, rejection, plugin reload, Session reopen and a receipt without a logged proposal.

<a id="dev-note"></a>
## Dev Note

None.
