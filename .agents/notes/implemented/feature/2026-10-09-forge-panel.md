# Agent Note: Change request panel and worktree Sessions

Status: implemented

English | [中文](2026-10-09-forge-panel.zh.md)

## Problem

[Session change request bindings](2026-10-09-session-change-request-bindings.md) give each Session a list of change requests, but nothing shows it. A user who asks the agent to open change requests needs their checks, reviews, and mergeability without leaving the conversation, and wants a new Session's edits and commits kept out of the current checkout. Git must run where the Session's commands run, which can be a remote or confined execution world; inspection must not change the repository, and a worktree must exist before the model's first action.

## Decision

[`dsh-experimental-client-ui-forge`](../../../../packages/experimental/client-ui-forge/README.md) is a two-face package. Its Host half, the `forgePanel` Remote, assembles everything the panel shows for one Session into one streamed state; the forge registry and the binding service keep only their domain operations. Its Client half is a right-sidebar tab, a Session header button that shows or hides it, a header branch label, a New Session option, a creation card above the composer, and a toast. Every surface calls a bound item a change request, the forge registry's term, whatever its code host calls it. The [forge bundle](../../../../packages/experimental/forge-bundle/README.md) ships the panel, the forge registry, the GitHub provider, the bindings, and an isolated worktree service as one default-disabled Plugins page entry.

The Remote inspects the checkout through the Session's subprocess provider under the Session's read-only sandbox policy, so it reads what the Session's commands see and cannot write. Inspection reads refs and configuration only: the top-level, Git, and common Git directories, the branch or the abbreviated HEAD commit, the upstream, and the remotes. It runs when a Session is followed, after each `working-directory/change`, `tool/result`, and `sandbox/mode` event, and on refresh, one at a time with one trailing rerun.

Status polling follows panel subscriptions: a Session's bindings are watched only while one of its surfaces is mounted, and the registry stops polling change requests nobody watches. Each card keeps the last snapshot a poll returned, so a transient failure keeps the title and number visible. A Session's only open change request starts expanded, and with several every card starts collapsed; the user's first toggle replaces this default.

A new Session starts in a worktree through a request, not an immediate creation. Checking the option in the New Session row, a `conversation.hero.options` entry, appends a `plugin:client-ui-forge/worktree` record with the base branch; changing the base or clearing the option appends another, and nothing touches the repository until the user sends. The option is offered only where creation can succeed: under `workspace-write`, the checkout and its common Git directory must lie inside the writable root, which excludes a project that is itself a linked worktree. The worktree must exist before the first message enters the Session, so the message runs there and a stopped creation leaves it unsent: the panel's listener on the [`agent-controller/admission` stage](../architecture/2026-10-17-agent-controller-message-delivery.md) holds the first message while it creates and enters the worktree as Agent maintenance, then lets the message enter, and the New Session composer shows the message as sending meanwhile. The creation's stage streams to a card above the composer, where Cancel stops it and returns the message to editing. A failure also returns the message to editing, and the card keeps the failure: sending again starts a new attempt with a new branch name, and Continue without a worktree withdraws the request. An `agent/pre-step` listener still creates the worktree at the first step proposal of a Session whose request is open, because other senders reach the Agent without admission; it moves the working-directory notice into the proposed messages, and a failure ends the turn. The `forgeWorktree` projection ignores requests after the first `turn/start` and creations after the first `step/start`, so a running Session never moves. The Session header names the branch the Session works on.

The worktree a Session works in can be removed outside it. Each inspection checks whether the created worktree's directory still exists, and admission checks again for every message of a worktree Session, refusing it while the directory is missing so the message stays in the composer. Restore checks the branch out again at the recorded directory, or creates the branch again at its base commit when it is gone; Continue in the project moves the Session to the source checkout.

The panel no longer moves a Session between existing worktrees. Removing a change request appends a `dismiss` record, and its toast offers Undo through `track`.

## Deferred

A left-navigation review page next to Plugins and Scheduled tasks, listing the user's pull requests or merge requests on the selected provider, is deferred. It attaches without changing this package's Session surfaces:

- **Provider capability** — an optional `ForgeProvider` method such as `listForViewer(host, filter, signal)` returns change request references; GitHub implements it with `gh search prs --author @me` or the GraphQL `viewer`, and the registry aggregates enabled providers.
- **Remote** — a stream like `follow` that is keyed by provider and filter instead of a Session and polls through the same `ctx.forge.watch`.
- **Client** — a `sidebar.panellist` entry with a `main` page in this package, as `ui-schedule` does, rendering `ChangeRequestCard`, which takes a change request, its snapshot, and optional actions.
- **Settings** — provider choice and hosts on the bundle's configuration page.

## Alternatives considered

**Per-host nouns.** Calling items pull requests on GitHub and merge requests on GitLab would need each provider to declare its noun and every string to take it; GitHub is the only provider, and one term keeps the copy fixed.

**A Host service package for Git inspection.** No second consumer needs checkout facts yet; a model tool can move them into a shared service when it exists.

**Running Git as a Host process.** Remote and confined execution worlds would show the Host's files instead of the Session's, and the Host would read directories the Session cannot.

**Creating the worktree when the option is checked.** Every toggle or base change would create and abandon a checkout, and the Session would move before the user decided to send.

**Carrying the option in the Session creation request.** The Session controller owns a closed request; a plugin record keeps the option inside this package and survives a reload of the blank Session.

**Switching between existing worktrees from the panel.** A switched Session keeps the sandbox root of its project, so a worktree outside the project stays read-only, and moving mid-conversation splits the model's view of the files. Starting a Session in its worktree avoids both.

**The option in the composer tool row.** The tool row stays after the first message, when the option no longer applies; the New Session row disappears once the Session starts. The row offered only single slots, so `ui-conversation` gained the list slot `conversation.hero.options`.

**Creating the worktree within the first turn.** The message is already accepted when the first step proposal runs, so cancelling could only drop it or queue it again, and the New Session screen is already gone. A thrown pre-step error also discards the claimed message.

**Creating the worktree in a maintenance job when a message arrives.** The message would sit in the queue and the composer would already be cleared; holding the message at admission keeps it in the composer until the worktree exists.

**A submit gate in the Web composer.** The browser held the message before the Host saw it, so every check needed a Remote call, the stage of a refused message lived only in the browser, and other senders bypassed it. Admission holds the message where it enters the Agent and keeps the failure in the panel state.

**The creation card in the transcript.** Transcript nodes accept no plugin kinds; the input dock above the composer is the nearest list slot, and it renders on the New Session screen.

**A Session-row hover section and manual URL tracking.** Both duplicated the tab. Bindings come from `gh pr create` and pushes, and `track` remains for Undo.

## Consequences

The panel shows current status only while it is open; checks that finish while nothing is mounted produce no notification. Changes made outside the Session appear after Refresh or the next tool result. Every inspection spawns up to seven short Git processes in the Session's execution world. A worktree exists only for a Session that requested it before its first step, and a failed or cancelled attempt can leave its branch or checkout behind. Only the Web Session Remote admits messages so far; other senders create the worktree within the first turn and send into a removed worktree. Restoring loses changes that were never committed. With Git Worktrees also enabled, two independent worktree services exist; the model's tool never sees the panel's service.
