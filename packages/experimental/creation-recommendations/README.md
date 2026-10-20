---
description: "Create persistent removable interface plugins after an explicit user choice."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-creation-recommendations

English | [中文](README.zh.md)

## Summary

For an explicit interface or reusable feature wish, the Agent answers first and offers one creation card at the completed Turn’s end. The user can change its suggested location, then choose Create. A background Creator builds a new plugin and installs it into the profile. Keep confirms retention; Undo removes that plugin.

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

The left entry and its global page form one placement, including global streaming tools. Default selection distinguishes global from Session scope first; Session streaming dialogue takes the tab, while other viewers and editors take the right sidebar. Unclear scope calls for clarification before a recommendation.

### Outcomes and recovery

Creation requires a live root conversation and permission to modify the profile. Cancel is available during generation; retry waits for the child’s cleanup. Once installation starts, the card shows Completing installation and lets the accepted operation finish. Closing or leaving the conversation does not uninstall a completed plugin. Receipts survive reconnects; interrupted or uncertain runs are reconciled with the installed bundle before retry. Failed removal preserves the existing receipt and its application outcome for retry. Unloading this recommendation bundle stops its Creator work and local follow-up. Plugin Manager owns accepted profile changes and may finish after reload; reopening checks the installed profile before retrying. Installed plugins remain. Recovery confirms installation only; it does not infer runtime activation from the profile’s enabled flag.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host reserves a new package name and launches the existing `cordis` preset through `subagents`, passing a self-contained brief and the selected location. The child generates files in `.dsh-created-plugins/<id>` under the parent’s original workspace, preserving its delegated file permissions. The Host validates the package identity and an insert-only plain YAML or JSON patch, copies the result to the profile’s `created-plugins` directory and validates that copy before calling `pluginManager.installBundle`. Installation remains independent of the source workspace. The patch may add only the new package’s uniquely named, non-group rows. Custom YAML tags, aliases and includes are rejected. Each row must resolve to an existing built JavaScript entry. Relative symlinks must stay inside the package and are preserved during copying. A Session projection retains proposals and decision receipts. Recovery failures leave the conversation open and mark the result unconfirmed; retries must recheck the profile before creating anything. Completion targets the current instance of a reopened Session. Concurrent clicks share one operation; a tool guard reserves at most one recommendation per turn across `suggest_view` and `suggest_plugin`.

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

`list_creation_plugins` reads shipped plugin names, descriptions and enabled state without requiring the recommendation experiment or Creator-mode management tools. It is a small on-demand catalog, not an index of every built-in feature. `suggest_view` records the title, explicit need, relevant context, and suggested location. It never creates a plugin by itself. The main Agent judges intent semantically; there is no keyword trigger, TODO reader or background scanner. Guidance keeps proposal planning at product level, defers source/API inspection to the Creator after Create, and asks it to check existing official plugins first, call the tool, then provide one concise final answer. Vague wishes, ordinary one-off tasks and explicit requests to discuss only do not merit a card. The user’s Create action starts a separate Creator conversation; Keep and Undo do not resume the parent model.

#### Token effect

Two tool schemas are added while enabled. Discovery results and proposals append to the current conversation. Only an accepted creation spends a background Creator run.

#### KV Cache effect

Proposal metadata appends to the transcript. Installing a generated plugin can change later tool declarations and cache reuse.

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
