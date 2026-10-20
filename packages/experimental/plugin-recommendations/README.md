---
description: "Recommend built-in official plugins for explicit user needs and enable them from conversation cards."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-plugin-recommendations

English | [中文](README.zh.md)

## Summary

Users can discover a relevant built-in plugin while discussing a concrete need. The Agent answers first, then offers one card at the completed Turn’s end; the user can open its plugin details, choose Enable, or choose Not now. Enable applies through HMR and automatically notifies the Agent; no page refresh or follow-up message is needed. Enabling changes the whole profile and persists across restarts. Only an immediately applied change resumes the original request. Users can later disable or remove the plugin from its details page.

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

Open Plugins → More → Experimental plugins and enable Plugin recommendations. Shipped profiles leave this experimental bundle disabled. Enabling pins it to the main Plugins list; disabling returns it to the secondary page only. It has no configuration fields.

```yaml
- name: @deepseek-ai/dsh-experimental-plugin-recommendations
```

For multiple independent needs, guidance selects one proposal before any recommendation call: explicit user priority wins; otherwise an existing plugin precedes a new interface. Remaining needs stay in the answer, and missing requirements require clarification rather than an inferred connection. The limit covers both recommendation tools, including calls submitted together. Rejected calls create no card and do not schedule a later one. An already selected existing plugin does not require another catalog lookup merely to plan an unselected creation. These are semantic instructions; the Host still enforces the one-successful-card limit independently.

### Outcomes and recovery

Enable requires permission to modify the profile. The Host rechecks catalog eligibility before changing it. A saved selection can require restart or be overridden; those outcomes do not resume the Agent. Failed and cancelled changes can be retried. A lost response leaves the outcome uncertain until the Session projection reconnects; repeated card actions are idempotent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The catalog and activation reuse `pluginManager`. A root-only prompt section tells the main Agent to check the catalog for explicit DSH capability or display needs even when the user never mentions plugins. A capability wish does not authorize changes to source, settings or instructions. The section is absent when either recommendation tool is unavailable and is withdrawn on unload. The main Agent interprets expressed needs; Host code enforces the official shipped catalog, one successful proposal per Turn, and a separate human action. Concurrent proposals reserve the Turn before catalog lookup; failed proposals release that reservation. Replaying a settled proposal preserves the limit after reload, while a later Turn can recommend again. Trusted catalog text is persisted in tool-result metadata, while a Session projection folds decision receipts. Concurrent actions on one card share an operation, and disposal stops local follow-up without waiting on a profile mutation queued behind its own HMR unload. Plugin Manager owns an accepted mutation; an unconfirmed card rechecks the installed state after reload. A plugin selected elsewhere settles as `already-enabled` without another reload or activation notice; profile selection does not prove runtime activation. Unreadable receipts block recommendation actions and show a recovery message without stalling other Session projections. Profile files own installation state; experimental Session records only own the historical decision. Removing the bundle withdraws tools, cards and its generated Remote contribution.

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

[`list_official_plugins`](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-plugin-recommendations) returns disabled eligible plugins with their existing bilingual names and descriptions. Descriptions pair the capability with a usage scenario and material limits; they are shared with the plugin manager, not a separate trigger registry. `suggest_plugin` records one proposal with the explicit need and explanation. A successful user activation appends a notice containing that need. It directs the Agent to re-read the original request and preserve limits such as “only recommend” or “do not execute”; these and discovery-only requests end with a brief confirmation and no tools. Otherwise it continues only already requested work, without account-wide searches or bulk edits. This is semantic guidance, not a Host-enforced intent classifier or execution boundary.

#### Token effect

Two tool schemas and one short routing section are present while the experimental bundle is enabled. Names and descriptions enter context only after catalog lookup; no catalog, TODO list or keyword classifier is injected into each prompt. Catalog results and successful activation notices append context. Native tool text contains only an offered status and package name; presentation metadata and structured PTC values retain the full proposal.

#### KV Cache effect

The routing section stays stable across requests; toggling the experiment changes the prompt prefix. Recommendation facts append to the transcript. Enabling a plugin can change subsequent tool declarations and their cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The manual real-model input set is in `evaluation/intent-cases.json`; unit tests do not measure semantic intent accuracy. Tool guidance asks the Agent to clarify vague needs, respect a request not to recommend, and produce one concise final answer after proposing. These semantic decisions are evaluated with real model runs; they are not keyword guards.

- Only shipped, optional, official plugins are eligible; missing packages and third-party registries are excluded.
- Recommendations require a live root conversation; there is no unsolicited opportunity discovery.
- A historical receipt does not continuously track changes later made on the Plugins page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
