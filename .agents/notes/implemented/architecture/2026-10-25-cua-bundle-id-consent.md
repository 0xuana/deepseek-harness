# Agent Note: macOS consent shared by bundle identifier

Status: implemented

English | [中文](2026-10-25-cua-bundle-id-consent.zh.md)

## Problem

Users who install multiple versions of one application want one permission decision for that software. Executable paths split those decisions, and signing checks exclude unsigned development applications from saved access.

## Decision

macOS application consent uses the exact, case-sensitive native bundle identifier. The helper hashes `macos:bundle-id:` followed by that identifier into `CuaApplicationId`. Installation paths, versions and signatures do not distinguish grants. Conversation decisions and saved grants retain the scopes and revocation behavior of [profile consent storage](2026-10-19-cua-profile-consent-storage.md).

This supersedes the executable/signature identity choice in [application consent](2026-09-26-cua-application-consent.md); that note still owns enforcement and human decisions. Running applications without a nonempty bundle identifier retain process-instance consent, while pending launches use executable content identity. Neither can receive an always-allow grant. Native process, executable-location and window checks continue to bind each handle to its selected target. Launch checks reread the bundle identifier and executable path from disk; they do not fingerprint executable content for an application with a bundle identifier. Replacing bytes at the same path under the same identifier therefore retains consent, including during an approval wait.

The identity prefix separates new grants from old path/signature digests. Old grants remain removable but do not grant access to new bundle identities; users decide again before permission covers other installations.

## Alternatives considered

**Bundle identifier and path.** This distinguishes installed copies but requires separate decisions for the multiple versions the user wants to authorize together.

**Verified signing identity.** This distinguishes publishers but denies saved access when signing is absent or cannot be verified. Publisher authentication is outside this application-management policy.

## Consequences

Another program declaring the same bundle identifier inherits consent, including a program created or changed through separately authorized model tools. The worst consequence is observing or controlling an application that the user did not approve separately, within its available data and capabilities. The model cannot supply the authorization identity through the CUA request; the native helper reads it from the selected application. Different bundle identifiers require different decisions, even when users consider them versions of one product.

Revocation applies to every installation sharing the identifier. Tests exercise unsigned copies, different identifiers, missing identifiers, pending and running identity agreement, shared handle revocation and refusal to widen old grants.
