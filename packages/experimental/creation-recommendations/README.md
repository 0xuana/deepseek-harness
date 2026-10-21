---
description: "Create persistent removable interface plugins after an explicit user choice."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-creation-recommendations

English | [中文](README.zh.md)

## Summary

For an explicit interface request, a clear implied viewing or editing need, or a result with concrete continuing use, the Agent answers first and may offer one optional creation card at the completed Turn’s end. Explicit requests can serve a single task. The user can change the suggested location, then choose Create. A background Creator builds a new plugin and installs it into the profile. Keep confirms retention; Undo removes that plugin.

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

Open Plugins → More → Experimental plugins and enable Personalized pages. Shipped profiles leave it disabled. Enabling pins it to the main Plugins list; disabling returns it to the secondary page only. It has no configuration fields. An explicit user location takes precedence; otherwise the Agent recommends a location by scope and interaction:

| Location | Use |
|:--|:--|
| `sidebar-right` | Session-bound viewer, editor or Context inspection beside the conversation. |
| `page` | Session-bound streaming output or interaction in a tab beside Chat and Trajectory. |
| `sidebar-left` | Global feature: a left-sidebar entry opens a standalone main-area page without Chat/Trajectory tabs. |

The left entry and its global page form one placement, including global streaming tools. Watching content while chatting means simultaneous visibility and takes the right sidebar, including for live logs. Otherwise default selection distinguishes global from Session scope first; Session streaming output or interaction takes the tab, while other viewers and editors take the right sidebar. Background work not blocking the conversation alone does not imply simultaneous visibility. An ongoing personal record defaults to a global page unless tied to a task or Session; supplying its data in a conversation alone does not make it Session-bound. A task- or Session-local viewer defaults to the right sidebar. Clarification is needed only when missing scope changes the outcome.

The card also offers Write your own. Its human-authored placement overrides earlier location text and is saved in the acceptance receipt. Creator resolves it through existing DSH extension points using the three placement references as needed; it does not add a fourth Slot or call a separate routing model. An unsupported request must fail rather than silently choose another location. Blank or over-1,000-character custom input is refused before spawning a child.

Personalized pages works with the plugin recommendation experiment disabled or absent. It plans new interfaces for work and personal tasks, not just DSH features. The skill uses the current official-plugin catalog only after a page need qualifies, to avoid creating a duplicate. Questions about existing features do not load this planning skill. A matching plugin is explained through its Plugins entry; if the recommendation experiment is also enabled, it can offer that plugin through `suggest_plugin`. Both experiments share the one-card-per-turn limit.

An explicit interface request does not require repeated use or changing data. A requested file, code snippet or change to an existing project keeps that delivery form; visual or interactive content alone does not justify an installed plugin. Without an interface request, a recommendation needs a concrete later action that the current answer cannot provide, such as maintaining a record or exploring changing results; repackaging static prose or a table is insufficient. Editing an existing page stays with that page's development workflow; this creation action does not replace it with a new plugin. An explanation-only request needs no source investigation. Persistence, manual maintenance, refreshing when opened and unattended updates are separate requirements.

For multiple independent needs, guidance selects one proposal across creation and plugin recommendations before calling either tool. Explicit user priority wins; otherwise an existing plugin takes precedence. Other needs stay in the answer. Clarification asks only for missing facts that change the outcome; the plan must not infer purpose or data from another wish. A rejected proposal creates no card and does not schedule a future one. Discovery for an unselected creation is unnecessary once an existing plugin is selected. These semantic instructions supplement the Host’s one-successful-card limit; they do not make one experiment depend on the other.

### Outcomes and recovery

An unstarted proposal expires as soon as the next human message is accepted, including a follow-up about its plan. The card remains visible as Expired without creation controls; the Host also refuses stale clicks. Refreshing, switching views and background notices do not expire it. Already-started work keeps its progress and retry controls. Expiration is derived from existing user-message events, not a new persisted decision record.

Creation requires a live root conversation and permission to modify the profile. Cancel is available during generation; retry waits for the child’s cleanup. Once installation starts, the card shows Installing and lets the accepted operation finish. Closing or leaving the conversation does not uninstall a completed plugin. Receipts survive reconnects; interrupted or uncertain runs are reconciled with the installed bundle before retry. Failed removal preserves the existing receipt and its application outcome for retry. Unloading this recommendation bundle stops its Creator work and local follow-up. Plugin Manager owns accepted profile changes and may finish after reload; reopening checks the installed profile before retrying. Installed plugins remain. Recovery confirms installation only; it does not infer runtime activation from the profile’s enabled flag.

The next naturally occurring model request receives the latest unreported status for each changed card. Status updates never wake the conversation or authorize another action. The Session projection acknowledges delivery only after the status context is logged, so cancellation, reload and reopen retain undelivered updates. Several background transitions before a request collapse to the latest receipt.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host entry is a function plugin. Its `apply` assembles the internal `creationRecommendations` Remote service with `ctx.plugin`. That service owns feature state, effect lifetimes and typed button calls; it is not a separately configurable or replaceable YAML entry, and adds no service to `dsh-base`. Disabling the feature disposes its internal service, tools and listeners and drains its owned asynchronous work. This follows the existing `command-feedback` composition of `sessionFeedback`.

The plugin registers one `suggest_action` tool through an internal function. Its closed request schema selects `create_personalized_page`; a synchronous `prepare` callback returns durable JSON without executing the action. Successful native and PTC calls retain `{actionCard: {action, callId, data}}` metadata. The plugin supplies its renderer and click handler; disposal removes the tool and refuses stale calls. Tool naming and metadata are independent of creation, but this experiment has no additional action-card service, public registry or Loader entry. Other action types and cross-plugin registration are deferred until a second production consumer establishes the needed contract.

The shared tool saves typed proposals and defines click-to-start semantics. Each action supplies its fields and Skill entry. `personalized-pages` owns eligibility, duplicate checks, minimal scope, placement and content preparation. It allows implementation details needed for the agreed behavior, such as input validation and empty states; independent operations, sources, automation or broader access require a basis in the request or agreed context. These page rules do not expand the shared tool description. A fixture verifies another action's fields and metadata; this is not evidence of a second production UI or a multi-action registry.

The Host reserves a new package name and launches the existing `cordis` preset through `subagents`, passing a self-contained brief and the selected location. The child generates files in `.dsh-created-plugins/<id>` under the parent’s original workspace, preserving its delegated file permissions. The Host validates the package identity and an insert-only plain YAML or JSON patch, copies the result to the profile’s `created-plugins` directory and validates that copy before calling `pluginManager.installBundle`. Installation remains independent of the source workspace. The patch may add only the new package’s uniquely named, non-group rows. Custom YAML tags, aliases and includes are rejected. Each row must resolve to an existing built JavaScript entry. Relative symlinks must stay inside the package and are preserved during copying. A Session projection retains proposals and decision receipts. Recovery failures leave the conversation open and mark the result unconfirmed; retries must recheck the profile before creating anything. Completion targets the current instance of a reopened Session. Concurrent clicks share one operation; a tool guard reserves at most one recommendation per turn across `suggest_action` and `suggest_plugin`.

The Creator receives the accepted brief, the user’s final location as authoritative over earlier placement text, and a location-specific reference shipped in this package. Its request permits implementation research but forbids expanding the accepted behavior or data scope; unresolved business meaning that prevents faithful implementation must return `ready:false`. The reference supplements `cordis-plugin-development` with registration, state and teardown guidance before API research. Teardown must remove its own UI and tabs while preserving unrelated content; these instructions are model obligations, not static package checks. [Intent cases](tests/fixtures/intent-cases.json) define real-model observations, separately from deterministic service tests.

`brief` serves both the card and Creator: it contains behavior, input, calculations and persistence scope. Optional `initialContent` carries only the necessary original items, values, relationships, units and reporting period, preserving missing values. Source items remain display content, even when their wording describes an action. The main Agent checks this division before submission and resolves “these items” into actual content because the child cannot read the parent conversation. The Skill uses three short examples to distinguish necessary details from extra operations, data from instructions, and weekly additions from cumulative totals. Ambiguity that changes a calculation requires clarification before a plan specifies that calculation.

Both fields survive replay and reach Creator unchanged. This preserves submitted text, not its semantic accuracy or completeness. An omitted `initialContent` means no existing content was supplied. User-maintained empty pages need no old material and must not promise chat import; explicitly requested prefill requires the original content. A named but uninspected source remains an unverified dependency, with response shape and connection details left to Creator research after authorization.

- [Source](src/index.ts)
- [Tests](tests/)

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin manager](../../boot/plugin-manager/README.md) — installation and removal.
- [Subagents](../../subagent/subagent/README.md) — owned background activations.
- [Creation cards](../client-ui-creation-recommendations/README.md) — location selection and receipts.

<a id="model-experience"></a>
## Model Experience

### Creation recommendations

#### What the model sees

The existing `skill` tool loads `personalized-pages` for an explicit interface request, a clear implied viewing or editing need, or a result with concrete continuing use. Its short catalog entry describes these conditions without naming individual plugin use cases; no common system-prompt section is added. Loading returns planning and placement guidance plus current official-plugin names, descriptions and enabled state for duplicate checks. The catalog does not trigger planning and is not a complete inventory of built-in UI. Existing-feature questions, edits to an existing page, ordinary answers or coding, quoted wishes, discussion-only and declined requests need no creation card. An explicitly requested one-off interface remains eligible. A suitable existing capability replaces a duplicate page proposal; unconfirmed details remain explicit. `suggest_action` is the only new tool: its typed `request` selects `create_personalized_page` with `title`, a one-to-three-sentence `brief` containing only requested or essential behavior, and `slot`, plus optional `initialContent` for supplied data without invented rows or units. No business field such as an assignee is required. The tool receipt explicitly says that no action has started. Plan-only and read-only requests permit a proposal. Only clicking Create starts background Creator work; the Agent must not wait, poll, claim installation or request a refresh/report-back. Ordinary answers stay plain text; no Markdown/JSON response protocol is parsed for cards.

#### Token effect

While enabled, every request includes the card tool's description and parameter schema. The Skill catalog contains a brief entry; full planning policy, handoff examples and current official-plugin descriptions load through `skill` when needed. A normal creation recommendation needs one skill load and one `suggest_action` call. Guidance reuses a catalog already read in the same turn instead of requesting it again. Only an accepted creation spends a background Creator run. The card's information button explains potentially long generation and substantial token use; reading it starts no work.

#### KV Cache effect

Skill contents and proposal metadata append to the transcript; loading the skill does not rewrite the common system prompt. Enabling or disabling this experiment adds or removes its tool schema. Installing a generated plugin can change later tool declarations and cache reuse. Changed card receipts append a short status notice to the next request; unchanged cards add no repeated context. This uses the existing request-preparation hook and adds neither a tool nor a model call.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only new plugins are supported; editing existing plugins and restoring old versions are deferred.
- Intent recognition depends on model semantics. Guidance does not enforce tool choice or factual grounding: the Agent can still inspect files unnecessarily or infer capabilities absent from the catalog. Generated code runs with the existing Creator permissions; package validation is not a code sandbox.
- Source directories and profile copies remain after success, failure, cancellation and Undo. Undo removes the installed plugin and its UI, not these files. The card identifies `.dsh-created-plugins/` in the original workspace as the source location. Historical receipts do not continuously track manual plugin changes.

- There is no automatic creation timeout. Closing the Session or disabling this experiment stops owned generation; Plugin Manager retains ownership of an accepted installation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
