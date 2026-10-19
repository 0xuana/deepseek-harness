---
description: "Recommend built-in official plugins for explicit user needs and enable them from conversation cards."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-plugin-recommendations

English | [中文](README.zh.md)

## Summary

Users can discover a relevant built-in plugin while discussing a concrete need. The Agent answers first, then offers one card at the completed Turn’s end; the user chooses Enable or Not now. Enabling changes the whole profile and persists across restarts. Only an immediately applied change resumes the original request.

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

Enable Plugin recommendations in the Plugins page’s Experimental plugins group. Shipped profiles leave this experimental bundle disabled. It has no configuration fields.

```yaml
- name: @deepseek-ai/dsh-experimental-plugin-recommendations
```

### Outcomes and recovery

Enable requires permission to modify the profile. The Host rechecks catalog eligibility before changing it. A saved selection can require restart or be overridden; those outcomes do not resume the Agent. Failed and cancelled changes can be retried. A lost response leaves the outcome uncertain until the Session projection reconnects; repeated card actions are idempotent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The catalog and activation reuse `pluginManager`. The main Agent interprets expressed needs; Host code enforces the official shipped catalog and a separate human action. Trusted catalog text is persisted in tool-result metadata, while a Session projection folds decision receipts. Concurrent actions on one card share an operation, and disposal drains admitted changes. Profile files own installation state; experimental Session records only own the historical decision. Removing the bundle withdraws tools, cards and its generated Remote contribution.

- [Source](src/index.ts) — registration and service entry.
- [Tests](tests/) — actions, recovery and lifecycle evidence.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin manager](../../boot/plugin-manager/README.md) — profile changes.
- [Session projection](../../session/session-projection/README.md) — durable derived state.
- [Recommendation cards](../client-ui-plugin-recommendations/README.md) — completed-answer placement.
- [Conversation UI](../../client/ui-conversation/README.md) — transcript placement.

<a id="model-experience"></a>
## Model Experience

### Recommendation tools

#### What the model sees

[`list_official_plugins`](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-plugin-recommendations) returns disabled eligible plugins. `suggest_plugin` records one proposal with the explicit need and explanation. A successful user activation appends a notice containing that need so the Agent can continue. Tool descriptions restrict recommendations to expressed needs; this is semantic guidance, not an intent classifier enforced by the Host.

#### Token effect

Two tool schemas are present while the experimental bundle is enabled. Catalog results, recommendations and successful activation notices append context.

#### KV Cache effect

Recommendation facts append to the transcript. Enabling a plugin can change subsequent tool declarations and their cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only shipped, optional, official plugins are eligible; missing packages and third-party registries are excluded.
- Recommendations require a live root conversation; there is no unsolicited opportunity discovery.
- A historical receipt does not continuously track changes later made on the Plugins page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
