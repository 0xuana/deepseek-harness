---
kind: upgrade-guide
description: macOS Computer Use grants use bundle identifiers and require renewed consent for old application identities.
---

# macOS Computer Use application identity

English | [中文](guide.zh.md)

## Change

Application grants use the case-sensitive native bundle identifier. Versions and copies at different paths share permission and revocation, regardless of signing. Applications without a bundle identifier remain limited to conversation-scoped access. The profile storage and conversation scopes are unchanged.

This affects macOS users with saved path/signature grants, including grants imported from the legacy `allowedApps` configuration. Those grants do not match the new identities. They remain visible and removable but do not authorize other installations automatically. Old and new records can show the same name and path; the permission page does not distinguish them. Another program declaring an approved bundle identifier inherits permission; this policy does not authenticate publishers.

## Migration

1. In Computer Use application management, revoke every existing always-allowed entry for each affected application before selecting it again. If you already granted access after upgrading, remove all entries for that application rather than trying to distinguish old and new records.
2. Under “Applications not allowed,” use “Allow asking again” for that application so a prior refusal or revocation does not prevent the next prompt. Select the application again and approve the intended scope. “Always allow” covers all versions and copies with the same bundle identifier within the profile.
3. Select another installed copy with that bundle identifier and confirm it does not ask again within the granted scope. Revoke the shared grant to stop access for all copies. Versions with different bundle identifiers still require separate approval.
