---
kind: upgrade-guide
description: macOS Computer Use grants use bundle identifiers and require renewed consent for old application identities.
---

# macOS Computer Use application identity

English | [中文](guide.zh.md)

## Change

Application grants use the case-sensitive native bundle identifier. Versions and copies at different paths share permission and revocation, regardless of signing. Applications without a bundle identifier remain limited to process-instance session access. The profile storage and conversation scopes are unchanged.

Existing path/signature grants do not match the new identities. They remain visible and removable but do not authorize other installations automatically. Another program declaring an approved bundle identifier inherits permission; this policy does not authenticate publishers.

## Migration

1. After upgrading, select each application again and review its permission request. “Always allow” covers all versions and copies with the same bundle identifier within the profile.
2. In Computer Use application management, remove obsolete grants left from the previous identity scheme. Confirm the new permission by selecting another installed copy with the same bundle identifier; it should not ask again within the granted scope.
3. Revoke the shared grant when access must stop for all copies. Versions with different bundle identifiers still require separate approval.
