---
description: "Check macOS Computer Use permissions and revoke application access."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cua

English | [中文](README.zh.md)

## Summary

Open Computer Use in Plugins to check Accessibility and Screen Recording, request missing system permissions, and revoke application access. Explicit activation probes permissions and may start a dedicated native helper. Missing privileges show setup guidance; a failed probe directs the user to diagnostics and retry in the details page. System prompts still require the user's decision.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

Application permission prompts and permission-page lists show native icons and application names. Paths remain available on hover. Icons are presentation metadata and are never saved with grants. This plugin registers the application-approval presentation in the existing composer chain and reuses the shared approval card. The pending question still owns waiting, cancellation and answers. The prompt offers session access, refusal and, for verifiable applications with writable settings, persistent access.

-----

<a id="use-this-package"></a>
## Use this package

The [Computer Use bundle](../cua-bundle/README.md) mounts this page with its native provider. **Authorize Computer Use** groups the new-session default, Accessibility, and Screen Recording inside one border, with dividers between the rows. Each system-permission row shows the system-reported responsible application’s `.app` bundle filename and icon together in a bordered label. **Manage applications Computer Use can access** places the application lists inside a separate bordered group. Choose **Request permission**, find that application in the macOS permission list, and enable its switch; if macOS names another application, follow that prompt. With no detected source, the page directs the user to the application named by macOS. **Open System Settings** opens the corresponding privacy pane. The page refreshes on entry, when the window regains focus, and after permission actions. A failed query offers **Retry**. Follow any macOS quit-and-reopen prompt and restart DSH as needed.

System-permission operations affect the computer running DSH. When accessing DSH remotely, complete authorization on that computer.

Enabling shows setup guidance when system permissions need attention, with **Later** and **Open settings** actions. The dialog navigates to the plugin details without changing the default mode. The detail page provides **Set to PTC** under **Default mode for new sessions**; only this action saves the default. Existing sessions keep their preset.

The page lists always-allowed applications and refusals from any session. A refusal in one session does not cancel another session’s grant or prevent a new session from asking. Session-only grants remain effective within their sessions and are omitted from this page. **Revoke** removes the selected application's access and cancels affected work. Input already delivered to an application cannot be undone; observe the application before any further action. **Allow asking again** clears that application’s refusal records across all sessions; the next application selection still requires a new decision.

This plugin has no configurable fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The optional browser contribution mounts the native provider's permission Remote and reuses the Plugins activation and configuration slots. The three setup rows remain visible while unknown fields use placeholders. The default-mode form, system checks, application decisions, and application icons fill in as each query completes. Application names and actions do not wait for icons; icon positions retain their space. User actions run in order without waiting for pending observation queries. Disposal waits for both actions and queries to settle before releasing the separately owned Remote mount. Query errors stay with the affected section, and activation guidance depends only on system checks. Plugin Manager’s pending state pauses observation during bundle changes and resumes it afterward; late results from the previous activation are discarded. One controller projects queries into the page and setup dialog; reconnects and updates to the Host-reported settings namespace refresh it. Operation notices live in the shell overlay, so closing the page does not remove them. The provider owns permission checks, persisted decisions, and cancellation; the browser owns no authorization state.

The detail page reads the effective default (`selectedDefault ?? default`) from the existing `configForms` service. Its button writes only `selectedDefault` through the form's revision-checked settings path. Loading, read-only and unavailable settings cannot submit a change; a failed write remains beside the setting for retry.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Native provider](../cua/README.md): executable identity and operation checks.
- [Plugin manager](../../client/ui-plugin-manager/README.md): activation and page slots.
- [UI primitives](../../client/ui-primitives/README.md): shared modal, buttons, and toast.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers browser controls and no model-facing tools or prompt sections.

#### KV Cache effect

None; the native provider owns model-visible guidance and operation results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

This CUA-specific UI remains experimental while Windows support is in development; promotion returns it to the `client` group as `ui-cua`.

- macOS may require restarting the launching application after a system permission change. A pending request is not an authorization grant.
- Application attribution depends on an optional native system query and available application metadata. If either is unavailable, the page uses generic system-prompt guidance. Packaged Desktop distribution and permission attribution remain deferred.
- No invariant companion is published: this UI projects the provider's query and stores no independent authorization decisions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
