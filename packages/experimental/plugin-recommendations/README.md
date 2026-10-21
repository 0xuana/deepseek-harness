---
description: "Recommend built-in official plugins for explicit user needs and enable them from conversation cards."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-plugin-recommendations

English | [中文](README.zh.md)

## Summary

Users can discover a relevant built-in plugin while discussing a concrete need. The Agent answers first, then offers one card at the completed Turn’s end; the user can open its plugin details, choose Enable, or choose Not now. Enabling changes the whole profile and persists across restarts. The Agent learns the result with the next request; clicking starts no model turn. Users can later disable or remove the plugin from its details page.

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

Open Plugins → More → Experimental plugins and enable Plugin recommendations. Shipped profiles leave this experimental bundle disabled. Enabling pins it to the main Plugins list; disabling returns it to the secondary page only. Its one configuration field, `queuedMessageLimit`, is the number of queued next-turn messages at or above which the current turn offers no card; the default is 2.

```yaml
- name: @deepseek-ai/dsh-experimental-plugin-recommendations
  config:
    queuedMessageLimit: 2
```

The experiment works with or without Personalized pages. Both read the same answer-block format through `@deepseek-ai/dsh-util-action-block`, and a turn shows at most one card because Personalized pages yields to any other action's block while this experiment never yields; neither package depends on the other. For several independent needs, guidance follows an explicit user priority and otherwise prefers an existing plugin over a new page; other needs stay in the answer.

### Outcomes and recovery

Enable requires permission to modify the profile. The Host rechecks catalog eligibility before changing it. A saved selection can require restart or be overridden; failed and cancelled changes can be retried from the same card. A plugin already selected elsewhere settles as already enabled without another change. A later proposal replaces an undecided card, which then shows Replaced; a proposal written while `queuedMessageLimit` or more messages are queued, or after another card in the same answer or turn, is never offered. A lost response leaves the outcome uncertain until the Session projection reconnects; repeated card actions are idempotent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host entry is a function plugin. Its `apply` assembles the internal `pluginRecommendations` Remote service with `ctx.plugin`. That service owns feature state, effect lifetimes and typed button calls; it is not a separately configurable or replaceable YAML entry, and adds no service to `dsh-base`. Disabling the feature disposes its internal service, skill provider and listeners and drains its owned asynchronous work. This follows the existing `command-feedback` composition of `sessionFeedback`.

The plugin adds no model tool and no system-prompt section. It registers the `official-plugins` skill; loading it appends the current eligible catalog from `pluginManager`. A proposal is one fenced `dsh-action` JSON object with `action: "enable_official_plugin"`, `name` and `reason` at the end of the final answer. The Session projection reads the answer's last valid official-plugin block through `@deepseek-ai/dsh-util-action-block`, identifies the card by the message id, and applies the same per-turn reservation, queue suppression and replacement rules as Personalized pages, without depending on that package. The card asks the Host for the plugin's current title, description and selection, so names outside the eligible catalog show no actions. Only shipped, optional, official plugins that are available, writable and error-free are eligible.

Concurrent actions on one card share an operation, and disposal stops local follow-up without waiting on a profile mutation queued behind its own HMR unload. Plugin Manager owns an accepted mutation; an unconfirmed card rechecks the profile when clicked again. Profile files own installation state; experimental Session records own only the historical decision. Unreadable receipts block actions and show a recovery message without stalling other Session projections. Each decision is queued as a status notice for the next model request through the existing request-preparation hook; delivery is acknowledged only after the notice is logged.

- [Source](src/index.ts) — registration and service entry.
- [Tests](tests/) — actions, recovery and lifecycle evidence.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin manager](../../boot/plugin-manager/README.md) — profile changes.
- [Session projection](../../session/session-projection/README.md) — durable derived state.
- [Recommendation cards](../client-ui-plugin-recommendations/README.md) — completed-answer placement.
- [Personalized pages](../creation-recommendations/README.md) — the other card action; it yields to this experiment's block.

<a id="model-experience"></a>
## Model Experience

### Official plugin recommendations

#### What the model sees

The existing `skill` tool loads `official-plugins` when the user wants DSH itself to work differently or gain an ability, such as input methods, displayed thinking, past-session search, terminals, worktrees, agent teams, desktop control or approval prompts. The catalog entry tells the Agent to load it before reading files or source. Loading returns matching policy, the block format, six short examples and the current catalog with names, localized titles, descriptions and enabled state. An enabled match gets usage guidance without a card; a partial match states its limit. Ordinary tasks, quoted wishes, discussion-only and declined requests get no card. The block is the submission; nothing changes until the user clicks Enable. The next request after a click carries a status notice: a fact, not a request for more work, and enabling authorizes nothing beyond that plugin.

#### Token effect

While enabled, requests carry only the 535-character catalog entry; no tool schema or prompt section is added. A skill load appends about 10K characters: a 3.3K-character policy plus the catalog, which grows with the number of eligible plugins. A recommendation needs one skill load and no further model round trip: the block is part of the final answer. A changed card appends one short status notice to the next request.

#### KV Cache effect

Skill contents and proposal blocks append to the transcript; the common system prompt and tool list are unchanged, so toggling this experiment changes only its catalog entry. Enabling a recommended plugin can change later tool declarations and their cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The manual real-model input set is in `evaluation/intent-cases.json`; unit tests do not measure semantic intent accuracy. Matching, priority between needs and respect for a request not to recommend are skill guidance evaluated with real model runs, not keyword guards.

- Only shipped, optional, official plugins are eligible; missing packages and third-party registries are excluded.
- Recommendations require a live root conversation; there is no unsolicited opportunity discovery.
- The block parser is shared through `@deepseek-ai/dsh-util-action-block`; the turn rules, status notice and card tail are copies of the Personalized pages code until a shared action-card package owns them.
- A historical receipt does not continuously track changes later made on the Plugins page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
