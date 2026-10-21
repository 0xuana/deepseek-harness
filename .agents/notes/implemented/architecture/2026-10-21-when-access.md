# Agent Note: whenAccess registration that follows access

Status: implemented

English | [中文](2026-10-21-when-access.zh.md)

## Problem

Client plugins need to switch their own registrations on and off with the current Peer's access: sidebar entries, main panels, overlays, and data streams. The existing Client access surface covers only rendering:

| Where | Existing capability | Gap |
|---|---|---|
| Components | `useRemoteAccess(action)` (global), `useSessionAccess(sessionId, action)`, `useWorkspaceAccess(workspaceId, action)`, and the Session-scope `useAccess(action)` | Readable only during render; a changed answer re-renders automatically |
| JS (`apply`, services) | `ctx.remoteAccess.source(kind, id, action)` returns a `HostObservable<boolean>` | A plugin must read `getSnapshot` and subscribe to changes itself, then register and dispose by hand |

#6486 therefore writes `if (!ctx.remoteAccess.owner) return` at the start of `apply` in 8 plugins: the check is fixed on identity, and registrations do not follow an access change.

## Decision

### whenAccess

The JS side has a `whenAccess` for each of the three access Hooks, from the package that publishes that Hook:

| Interface | Provider | Matching Hook |
|---|---|---|
| `ctx.remoteAccess.whenAccess(action, callback)` | remote-access | `useRemoteAccess(action)` |
| `ctx.uiSession.whenAccess(sessionId, action, callback)` | ui-session | `useSessionAccess(sessionId, action)` |
| `ctx.uiWorkspace.whenAccess(workspaceId, action, callback)` | ui-workspace | `useWorkspaceAccess(workspaceId, action)` |

```ts ignore-check
import type { AccessEffect, RemoteEndpoint } from '@deepseek-ai/dsh-api-remote-access/client'

/** The global-resource member; the Session and Workspace versions take the resource id first. */
export interface WhenAccess {
  /**
   * Keep `callback`'s effects installed while the current Peer may call `action`
   * on the resource: run it when the answer becomes true, dispose its effects in
   * reverse order when it becomes false, and run it again on the next true.
   * @returns disposer for the observation and any installed effects.
   */
  whenAccess(action: RemoteEndpoint, callback: () => AccessEffect): () => void
}
```

`AccessEffect` is `(() => void) | Iterable<() => void, void, void>`.

| Rule | Content |
|---|---|
| Semantics | Same as `ctx.slots.inject`: the callback returns one disposer or an iterable of disposers; an iterable installs as one transaction and disposes in reverse order; the controller belongs to the caller's fiber and disposes when the plugin unloads |
| Synchronous run | When the answer is already true, the callback runs synchronously; the owner's answer is always true, so registration order matches direct registration |
| Stream failure | A non-owner's answer turns false and the installed effects dispose |
| Callback failure | A setup failure at the call throws synchronously; a setup failure on a later grant stops the controller and is rethrown in a microtask |
| Layering | remote-access knows only `global`; the Session and Workspace versions are built over remote-access's lower-level `whenResourceAccess(kind, id, action, callback)`, as their Hooks are built over `source(kind, id, action)`. Only the package that owns a resource kind calls `source` and `whenResourceAccess`; other plugins use only the access Hooks and `whenAccess` and pass no kind. All four entry points share [`when-allowed.ts`](../../../../packages/api/remote-access/src/client/when-allowed.ts) |

### Plugin migration

| Plugin | Change | Action |
|---|---|---|
| ui-schedule | The task catalog source, delete toast overlay, right-sidebar task tab and title, main panel, sidebar entry, turn-tail card, Session-header reminder catalog, and Session row mark and hover list move into `remoteAccess.whenAccess`; the task tab type and the turn definition stay registered outside | `schedule/catalog` |
| ui-plugin-manager | Host change subscriptions, refresh toast overlay, main panel (including `pluginNavigation`), and sidebar entry move into `remoteAccess.whenAccess`; the controller and `pluginChanges` stay outside | `pluginManager/listBundles` |
| ui-settings-general | The settings shell `sidebar.settings` and the `settings.open` shortcut move into `remoteAccess.whenAccess` | `settings/describe` |
| ui-settings-account | The account state stream (including default model initialization), quota notice, and settings launcher move into `remoteAccess.whenAccess` | `account/watch` |
| ui-directory-picker-native | Both directory flows move into `remoteAccess.whenAccess` | `directoryPicker/pick` |
| ui-message-feedback | The message feedback buttons stay registered and the component decides whether to render through the Session-scope `useAccess`; `messageFeedback/*` requests carry `sessionId`, which the Gateway resolves to that Session through the `session` resource's default field, so they declare nothing. The `/feedback` decoration has no Client check: the decoration registry is global while `sessionFeedback/record` is decided per Session, so without access the dialog still opens and the Host refuses the submission, which the dialog reports with its failure code | `messageFeedback/put` |
| ui-deliverables, ui-open-in-app | Unchanged: an owner-only HTTP route that cannot be read falls back as before | — |

## Alternatives considered

**Return after an owner check at the start of `apply`**: fixed on identity; does not follow an access change.

**Trim the plugin list per connection**: a plugin cannot reload at once when access changes.

**Declare access in the plugin package manifest**: defines an access-control concept in the package manifest.

**One generic method with a resource parameter, or all three versions on remote-access**: business code would pass a kind, and remote-access would name the Session and Workspace resource kinds.

## Consequences

| Consequence | Note |
|---|---|
| Registrations follow access changes | The 6 plugins no longer return at the start of `apply`; without a grant, a non-owner sees none of the corresponding entries, which appear after a grant and disappear after a revocation; the owner's behavior is unchanged |
| The callback must hand back disposers | An effect registered through the plugin's `ctx` inside the callback also hangs on the plugin fiber; a registration whose disposer is not yielded does not dispose on access loss, only when the plugin unloads |
| Readers receive all plugin code | Plugins load as before; the Gateway decides each call, and `whenAccess` and the Hooks control the UI |
| Test stand-ins | [`dsh-client-test-runtime`](../../../../packages/test-support/client-runtime/README.md) replaces remote-access with fixed answers through `StaticRemoteAccess`, `staticAccessPlugin`, and `TestClientOptions.access`, so plugin specs cover the refused path |

## Related

- [Peer, principal, and remote access](2026-10-12-peer-principal-and-remote-access.md): this Note extends its Client access face.
