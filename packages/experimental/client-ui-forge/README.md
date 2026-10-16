---
description: "GUI panel for the change requests a Session creates, and a worktree option for new Sessions, with the Host Remote that serves them."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-forge

English | [中文](README.zh.md)

## Summary

This optional two-face package shows the change requests a Session created or pushed, and lets a new Session start in its own Git worktree. The Host half is the `forgePanel` Remote: it inspects the Session's checkout read-only, recognizes the code host, checks sign-in, streams the Session's [bound change requests](../forge-session/README.md) with their polled status, and creates a requested worktree while the Session's first message waits at Agent admission. The Client half adds a right-sidebar tab, a Session header button and branch label, a New Session option, a creation card above the composer, and a toast for action outcomes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable the [forge bundle](../forge-bundle/README.md) on the Plugins page; it composes this package with the forge registry, the GitHub provider, the Session bindings, and its own [worktree service](../worktree/README.md).

- **Worktree option** — on the New Session screen, Worktree sits at the right end of the row with the workspace and mode pickers. Checking it shows the base branch, the current branch by default; the menu lists recent local branches. The option is disabled, with the reason in its tooltip, outside a Git checkout, in a read-only Session, and when the checkout or its Git directory lies outside the Session's writable root, as for a project that is itself a linked worktree. Sending the first message keeps it in the composer on the New Session screen, shown as sending, while the branch `dsh-<first 8 hexadecimal digits of the Session id>-<4 random hexadecimal digits>` is created from the base under the repository's `.agents/worktrees/` and its checkout becomes the Session's working directory; the Host accepts the message once the worktree exists.
- **Creation card** — while the worktree is created, a card above the composer shows the new branch and its two steps, creating the branch and checking out files; More details adds the branch and base. Cancel stops the creation and returns the message to editing with the option kept. A failed attempt returns the message to editing, and the card shows the reason: sending the message again tries again with a new branch name, and Continue without a worktree withdraws the request so the next send uses the current checkout.
- **Branch label** — the Session header shows the branch the Session works on, or the abbreviated commit on a detached HEAD; its tooltip names the kind of checkout, which is the worktree the Session created with its base, another worktree, or the project directory, and its path with the Host home shortened to `~`.
- **Removed worktree** — when the worktree the Session works in has been removed outside the Session, a card above the composer says so, and the Host returns each message to the composer until the worktree is restored or left. Restore worktree, also offered as Restore in the tab, checks the branch out again at the same directory, or creates the branch again at the commit it started from when the branch is gone too; Continue in the project moves the Session to the source checkout. The branch label shows the warning tone meanwhile.
- **Header button** — appears when the Session has bound change requests or its directory is inside a Git checkout, and shows or hides the tab. A red dot marks an open change request with failed checks, requested changes, or conflicts.
- **Tab** — the first row names the checked-out branch, or the abbreviated commit on a detached HEAD, and the kind of checkout as the branch label does; for a removed worktree it offers Restore. Below it, each change request card shows a glyph for its state, its title, which opens it in the browser, and its number; the glyph tells open, draft, merged, and closed apart, and marks an open one with failed checks, requested changes, or conflicts as needing attention, as the header button's red dot does. A collapsed card adds the checks of an open change request and the most urgent of requested changes, conflicts, or draft, or when a merged or closed one ended. An expanded card shows the head and base branches; then, for an open change request, the checks, whose row opens the list of checks with failed ones first and their durations and links, the review decision with unresolved threads, and the merge state, or when a merged or closed one ended; and the changed lines. It offers Open in browser, Copy change request link, and Remove from this Session, whose toast offers Undo. When exactly one bound change request is open, its card starts expanded. Refresh inspects the checkout, checks sign-in, and polls every change request again. A banner shows the `gh auth login` command when sign-in is missing.

`gitCommand`, `gitTimeoutMs`, `graceMs`, `maxOutputBytes`, `readinessTimeoutMs`, `maxBranches`, and `worktreePrefix` are listed in the [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-client-ui-forge).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ForgePanelController` keeps one `SessionPanel` per followed Session and disposes it when the last follower leaves. A panel starts with the Session's working directory and bindings, re-inspects after each `working-directory/change`, `tool/result`, and `sandbox/mode` event, and publishes a new `ForgePanelState` for every change. Each change request keeps the latest snapshot a poll returned while later polls fail. Inspections run one at a time with one trailing rerun, and a result for a directory the Session has since left is dropped. The code host comes from the remotes in order: the upstream's remote, then `origin`, then the rest. A sign-in probe runs when the recognized host changes and on refresh, within `readinessTimeoutMs`.

Inspection runs `rev-parse --show-toplevel`, `rev-parse --path-format=absolute --git-common-dir`, `rev-parse --path-format=absolute --git-dir`, `symbolic-ref --short HEAD`, `rev-parse --short HEAD`, `rev-parse --abbrev-ref @{upstream}`, and `remote -v`; `branches` runs `symbolic-ref` and `for-each-ref --count=<maxBranches>`. None reads the working tree. Every command runs under the Session's read-only sandbox policy with optional index writes, hooks, the filesystem monitor, prompts, and lazy object fetches disabled and the inherited Git selectors and secret-bearing variables removed, within its own `gitTimeoutMs` deadline and `maxOutputBytes` limit per stream. The top-level, Git, and common Git directories Git prints are resolved through `ctx.fs` into the canonical process paths that the working-directory service records; a checkout whose Git directory differs from the common one is a linked worktree. The worktree option is usable under the `danger-full-access` sandbox mode, never under `read-only`, and under `workspace-write` only when both directories lie inside the canonical workspace root of the Session's sandbox policy.

A worktree request is a `plugin:client-ui-forge/worktree` record, folded by the host-only `forgeWorktree` projection: requests and withdrawals apply until the first `turn/start` or creation, and the first `created` record of an open request applies until the first `step/start`. `requestWorktree` and `cancelWorktree` refuse with `forgePanel/session-started` after a turn started or the worktree was created, with `forgePanel/worktrees-unavailable` without a `worktrees` service, and with `forgePanel/invalid-branch` for an empty branch; both forget a failed attempt. An `agent-controller/admission` listener holds a message of a Session whose request is open while one attempt with a new branch name runs as maintenance of the Session's Agent, so a message from another client waits for it; it publishes the running stage in the panel state with `held` set, records `created` with the source repository root, and then lets the message enter. A failed attempt stays in the panel state as `failure`, with its branch, base, failed step, and reason, until another attempt starts or the request changes, and the message is refused with `forge/worktree-creation-failed`. `stopCreation` and the Agent's cancellation refuse it with `forge/worktree-creation-stopped`, and the sender's cancellation passes through. Each message of a Session that works in its created worktree is refused with `forge/worktree-missing` while the worktree is missing; a check that cannot answer lets it pass. A refusal is marked `presented` while a panel follows the Session. The worktree service queues the working-directory notice, which the first step claims. An `agent/pre-step` listener creates the worktree at step 1 of a Session whose request is still open, which covers a message that entered without admission; it moves the notice into the proposed messages, and a failure ends the turn with the request kept. `restoreWorktree` and `continueInProject` also run as maintenance. The bundle isolates its `worktrees` service, so enabling Git Worktrees as well leaves two independent services. `track` rejects a URL no provider recognizes with `forgePanel/unrecognized-url`.

Each inspection also decides whether the worktree is missing: the Session's directory lies inside the created worktree, `ctx.fs.lstat` finds no directory there, and `show-ref` in the source repository tells whether the branch still exists.

The browser entry mounts the Remote, then the UI. One stream per Session feeds the tab, the header button, the branch label, the New Session option, and the creation card; it opens with the first subscriber, closes with the last, reopens after a transport reset, and keeps the last state for the next subscriber. The New Session option fills `conversation.hero.options`, the worktree card `conversation.input.dock`, and the branch label `conversation.session.header.actions`. The worktree card shows a running creation, with Cancel calling `stopCreation` while a message waits for it, or the last failure, with Continue without a worktree calling `cancelWorktree`; the composer itself shows the waiting message as sending and keeps a refused one. The tab and the branch label shorten paths with the Host home from the Remote's Host facts, read again after each transport reset. The tab reports its visibility to the header button's pressed state. The toast lives in a `shell.overlay` entry so it outlives the tab. The change request card takes a change request, its snapshot, and optional actions, so another surface can reuse it.

| Source | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | `forgePanel` Remote and per-Session panels |
| [`src/panel.ts`](src/panel.ts) | Panel state, inspection scheduling, and sign-in probes |
| [`src/worktree.ts`](src/worktree.ts) | Worktree record, projection, and creation at admission and at the first step |
| [`src/git.ts`](src/git.ts) | Confined read-only Git commands |
| [`src/parse.ts`](src/parse.ts) | Git output parsing and remote order |
| [`src/client/mount.ts`](src/client/mount.ts) | Remote mount, slot entries, and action outcome mapping |
| [`src/client/ChangeRequestCard.tsx`](src/client/ChangeRequestCard.tsx) | Reusable change request card |
| [`src/client/WorktreeToggle.tsx`](src/client/WorktreeToggle.tsx) | New Session worktree option |
| [`src/client/WorktreeProgress.tsx`](src/client/WorktreeProgress.tsx) | Worktree creation and removed-worktree card |
| [`src/client/BranchChip.tsx`](src/client/BranchChip.tsx) | Session header branch label |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Forge subsystem](../../../docs/subsystems/forge.md) — change request types and service reference.
- [Session bindings](../forge-session/README.md) — how change requests bind to a Session.
- [Worktree service](../worktree/README.md) — how a worktree is created and entered.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the working-directory service: its notice about a Session's new worktree joins the first request's messages, and Continue in the project queues the same kind of notice for the next request. Inspection, status, restoring, and the panel add nothing to model requests.

#### KV Cache effect

None for a new worktree, as its notice belongs to the first request of the Session, before any cached prefix exists. A notice after Continue in the project is appended after the cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Panel-only status** — status is polled only while a surface of this package is mounted for the Session; there are no notifications for checks that finish while none is.
- **Inspection triggers** — the checkout is inspected after Session tool results and directory changes; a change made outside the Session appears after Refresh or the next tool result.
- **Creation only** — the panel creates a worktree only before a Session's first step and never removes or prunes one; a failed or cancelled attempt can leave its branch or checkout behind. Branch names come from the Session id and random digits, not from the Session title, which does not exist yet.
- **Senders without admission** — only the Web Session Remote delivers messages through the agent controller's `agent-controller/admission` stage. A first message from another sender starts the turn, and the worktree is created at its first step; a message to a removed worktree enters, and its tools fail on the missing directory.
- **Restoring** — restoring recreates the checkout from the branch, or from the commit the branch started from when the branch is gone; changes that were never committed are lost with the removed directory.
- **Linked-worktree projects** — the option is unavailable when the project is itself a linked worktree: under workspace-write its Git directory lies outside the writable root, so neither the new branch nor later commits could be written.
- **Review page** — deferred: a left-navigation page that lists the user's change requests from the selected provider; the [decision note](../../../.agents/notes/implemented/feature/2026-10-09-forge-panel.md) records where it attaches.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
