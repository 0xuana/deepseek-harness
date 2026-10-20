---
description: "Create persistent removable interface plugins after an explicit user choice."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-creation-recommendations

English | [中文](README.zh.md)

## Summary

For an explicit or clearly implied reusable-interface need, or a clearly reusable result already obtained in the current task, the Agent answers first and may offer one optional creation card at the completed Turn’s end. The user can change its suggested location, then choose Create. A background Creator builds a new plugin and installs it into the profile. Keep confirms retention; Undo removes that plugin.

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

The left entry and its global page form one placement, including global streaming tools. Default selection distinguishes global from Session scope first; Session streaming output or interaction takes the tab, while other viewers and editors take the right sidebar. An optional page keeps the current result’s known data scope; a Session-local viewer defaults to the right sidebar. Clarification is needed only when missing scope changes the outcome.

The card also offers Write your own. Its human-authored placement overrides earlier location text and is saved in the acceptance receipt. Creator resolves it through existing DSH extension points using the three placement references as needed; it does not add a fourth Slot or call a separate routing model. An unsupported request must fail rather than silently choose another location. Blank or over-1,000-character custom input is refused before spawning a child.

Personalized pages works with the plugin recommendation experiment disabled or absent. It plans reusable interfaces for work and personal tasks, not just DSH features. The skill uses the current official-plugin catalog only after a page need qualifies, to avoid creating a duplicate. Questions about existing features do not load this planning skill. A matching plugin is explained through its Plugins entry; if the recommendation experiment is also enabled, it can offer that plugin through `suggest_plugin`. Both experiments share the one-card-per-turn limit.

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

The Host reserves a new package name and launches the existing `cordis` preset through `subagents`, passing a self-contained brief and the selected location. The child generates files in `.dsh-created-plugins/<id>` under the parent’s original workspace, preserving its delegated file permissions. The Host validates the package identity and an insert-only plain YAML or JSON patch, copies the result to the profile’s `created-plugins` directory and validates that copy before calling `pluginManager.installBundle`. Installation remains independent of the source workspace. The patch may add only the new package’s uniquely named, non-group rows. Custom YAML tags, aliases and includes are rejected. Each row must resolve to an existing built JavaScript entry. Relative symlinks must stay inside the package and are preserved during copying. A Session projection retains proposals and decision receipts. Recovery failures leave the conversation open and mark the result unconfirmed; retries must recheck the profile before creating anything. Completion targets the current instance of a reopened Session. Concurrent clicks share one operation; a tool guard reserves at most one recommendation per turn across `suggest_action` and `suggest_plugin`.

The Creator receives the full brief, the user’s final location as authoritative over earlier placement text, and an absolute path to a location-specific reference shipped in this package. The reference supplements `cordis-plugin-development` without depending on a newer preset package. It reads only the needed registration, state and teardown guidance before inspecting current APIs. Teardown must remove its own UI and tabs while preserving unrelated content; this is a generated-code requirement, not a static package check. [Intent cases](tests/fixtures/intent-cases.json) define real-model observations, separately from deterministic service tests.

When a page starts from an existing result, the proposal also carries optional `initialContent`: the necessary original rows, values and relationships, separate from the short displayed brief. It survives replay and passes to Creator as data. The child does not inherit the parent conversation; the main Agent must include the needed content without copying unrelated history. An omitted field means no existing content was supplied. Handoff preserves the submitted text exactly but cannot verify that the model included every relevant fact. Users who will add content themselves can receive an empty-page proposal without supplying old material; it must not promise automatic chat import. Explicit requests to prefill unavailable content require clarification.

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

The existing `skill` tool loads `personalized-pages` for an explicit or clearly implied reusable-interface need, or a task result the user intends to revisit or update. Its short catalog entry describes these conditions without naming individual plugin use cases; no common system-prompt section is added. Loading returns planning and placement guidance plus current official-plugin names, descriptions and enabled state for duplicate checks. The catalog does not trigger planning and is not a complete inventory of built-in UI. Questions about existing features, ordinary coding, quoted wishes, discussion-only, declined and one-off requests need no load or card. A suitable existing capability replaces a duplicate page proposal; unconfirmed details remain explicit. `suggest_action` is the only new tool: its typed `request` selects `create_personalized_page` with `title`, a one-to-three-sentence `brief` containing only requested or essential behavior, and `slot`, plus optional `initialContent` for existing data. No business field such as an assignee is required. The tool receipt explicitly says that no action has started. Plan-only and read-only requests permit a proposal. Only clicking Create starts background Creator work; the Agent must not wait, poll, claim installation or request a refresh/report-back. Ordinary answers stay plain text; no Markdown/JSON response protocol is parsed for cards.

#### Token effect

One shared card-tool schema and one short skill-catalog entry are added while enabled. Full policy and current plugin descriptions enter context only when the existing skill tool loads them. A normal creation recommendation needs one skill load and one `suggest_action` call. Guidance reuses a catalog already read in the same turn instead of requesting it again. Only an accepted creation spends a background Creator run. The card's information button explains potentially long generation and substantial token use; reading it starts no work.

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
