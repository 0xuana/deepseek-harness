---
description: "Create persistent removable interface plugins after an explicit user choice."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-creation-recommendations

English | [中文](README.zh.md)

## Summary

For an explicit interface wish, or a clearly reusable result already obtained in the current task, the Agent answers first and may offer one optional creation card at the completed Turn’s end. The user can change its suggested location, then choose Create. A background Creator builds a new plugin and installs it into the profile. Keep confirms retention; Undo removes that plugin.

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
| `page` | Session-bound streaming interaction in a tab beside Chat and Trajectory. |
| `sidebar-left` | Global feature: a left-sidebar entry opens a standalone main-area page without Chat/Trajectory tabs. |

The left entry and its global page form one placement, including global streaming tools. Default selection distinguishes global from Session scope first; Session streaming dialogue takes the tab, while other viewers and editors take the right sidebar. An optional page keeps the current result’s known data scope; a Session-local viewer defaults to the right sidebar. Clarification is needed only when missing scope changes the outcome.

The card also offers Write your own. Its human-authored placement overrides earlier location text and is saved in the acceptance receipt. Creator resolves it through existing DSH extension points using the three placement references as needed; it does not add a fourth Slot or call a separate routing model. An unsupported request must fail rather than silently choose another location. Blank or over-1,000-character custom input is refused before spawning a child.

Personalized pages works with the plugin recommendation experiment disabled or absent. When discovery finds an existing plugin, skill guidance directs the Agent to its Plugins entry instead of creating a duplicate. If the recommendation experiment is also enabled, it can offer that plugin through `suggest_plugin`; both experiments share the one-card-per-turn limit.

For multiple independent needs, guidance selects one proposal across creation and plugin recommendations before calling either tool. Explicit user priority wins; otherwise an existing plugin takes precedence. Other needs stay in the answer. Clarification asks only for missing facts that change the outcome; the plan must not infer purpose or data from another wish. A rejected proposal creates no card and does not schedule a future one. Discovery for an unselected creation is unnecessary once an existing plugin is selected. These semantic instructions supplement the Host’s one-successful-card limit; they do not make one experiment depend on the other.

### Outcomes and recovery

Creation requires a live root conversation and permission to modify the profile. Cancel is available during generation; retry waits for the child’s cleanup. Once installation starts, the card shows Installing and lets the accepted operation finish. Closing or leaving the conversation does not uninstall a completed plugin. Receipts survive reconnects; interrupted or uncertain runs are reconciled with the installed bundle before retry. Failed removal preserves the existing receipt and its application outcome for retry. Unloading this recommendation bundle stops its Creator work and local follow-up. Plugin Manager owns accepted profile changes and may finish after reload; reopening checks the installed profile before retrying. Installed plugins remain. Recovery confirms installation only; it does not infer runtime activation from the profile’s enabled flag.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host entry is a function plugin. Its `apply` assembles the internal `creationRecommendations` Remote service with `ctx.plugin`. That service owns feature state, effect lifetimes and typed button calls; it is not a separately configurable or replaceable YAML entry, and adds no service to `dsh-base`. Disabling the feature disposes its internal service, tools and listeners and drains its owned asynchronous work. This follows the existing `command-feedback` composition of `sessionFeedback`.

The plugin registers one `suggest_action` tool through an internal function. Its closed request schema selects `create_personalized_page`; a synchronous `prepare` callback returns durable JSON without executing the action. Successful native and PTC calls retain `{actionCard: {action, callId, data}}` metadata. The plugin supplies its renderer and click handler; disposal removes the tool and refuses stale calls. Tool naming and metadata are independent of creation, but this experiment has no additional action-card service, public registry or Loader entry. Other action types and cross-plugin registration are deferred until a second production consumer establishes the needed contract.

The Host reserves a new package name and launches the existing `cordis` preset through `subagents`, passing a self-contained brief and the selected location. The child generates files in `.dsh-created-plugins/<id>` under the parent’s original workspace, preserving its delegated file permissions. The Host validates the package identity and an insert-only plain YAML or JSON patch, copies the result to the profile’s `created-plugins` directory and validates that copy before calling `pluginManager.installBundle`. Installation remains independent of the source workspace. The patch may add only the new package’s uniquely named, non-group rows. Custom YAML tags, aliases and includes are rejected. Each row must resolve to an existing built JavaScript entry. Relative symlinks must stay inside the package and are preserved during copying. A Session projection retains proposals and decision receipts. Recovery failures leave the conversation open and mark the result unconfirmed; retries must recheck the profile before creating anything. Completion targets the current instance of a reopened Session. Concurrent clicks share one operation; a tool guard reserves at most one recommendation per turn across `suggest_action` and `suggest_plugin`.

The Creator receives the full brief, the user’s final location as authoritative over earlier placement text, and an absolute path to a location-specific reference shipped in this package. The reference supplements `cordis-plugin-development` without depending on a newer preset package. It reads only the needed registration, state and teardown guidance before inspecting current APIs. Teardown must remove its own UI and tabs while preserving unrelated content; this is a generated-code requirement, not a static package check. [Intent cases](tests/fixtures/intent-cases.json) define real-model observations, separately from deterministic service tests.

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

The existing `skill` tool loads `personalized-pages`: recommendation policy, placement guidance and current official-plugin names, descriptions and enabled state. Only its short discovery entry is always listed; no common system-prompt section is added. `suggest_action` is the only new tool. Its typed `request` selects `create_personalized_page` and supplies `title`, `brief` and `slot`. It records a proposal, never starts creation. The Agent matches needs semantically, prefers existing capabilities and explains enabled matches without another card. It skips quoted, declined and one-off requests; clearly reusable results may qualify. Plan-only and read-only requests still permit a card. Only clicking Create starts Creator in the background; the Agent must not wait, poll, claim installation or request a refresh/report-back. Ordinary answers stay plain text; no Markdown/JSON response protocol is parsed for cards. The discovery summary fits the existing skill catalog’s length limit. Product-use questions go to the current catalog before source inspection. Existing-feature questions receive the nearest supported option with unconfirmed details left explicit; the optional-plugin catalog is not a complete inventory of built-in UI. A proposed page contains only requested or essential behavior in one to three sentences; its final answer does not add optional features or refresh instructions.

#### Token effect

One shared card-tool schema and one short skill-catalog entry are added while enabled. Full policy and current plugin descriptions enter context only when the existing skill tool loads them. A normal creation recommendation needs one skill load and one `suggest_action` call. Guidance reuses a catalog already read in the same turn instead of requesting it again. Only an accepted creation spends a background Creator run. The card's information button explains potentially long generation and substantial token use; reading it starts no work.

#### KV Cache effect

Skill contents and proposal metadata append to the transcript; loading the skill does not rewrite the common system prompt. Enabling or disabling this experiment adds or removes its tool schema. Installing a generated plugin can change later tool declarations and cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only new plugins are supported; editing existing plugins and restoring old versions are deferred.
- Intent recognition depends on model semantics. Generated code runs with the existing Creator permissions; package validation is not a code sandbox.
- Source directories and profile copies remain after success, failure, cancellation and Undo. Undo removes the installed plugin and its UI, not these files. The card identifies `.dsh-created-plugins/` in the original workspace as the source location. Historical receipts do not continuously track manual plugin changes.

- There is no automatic creation timeout. Closing the Session or disabling this experiment stops owned generation; Plugin Manager retains ownership of an accepted installation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
