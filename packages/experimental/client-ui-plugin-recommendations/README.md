---
description: "Show official plugin recommendations after completed answers."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-plugin-recommendations

English | [中文](README.zh.md)

## Summary

Users see one plugin recommendation below the completed answer, with the plugin's current title and description in the interface language and the Agent's reason. The title, reason and description form one target that highlights on hover; clicking it opens that plugin's details in Plugins without enabling it or changing the current Session. Enable and Not now remain separate choices. Decisions and the details link remain available after reconnecting.

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

Enable the [Plugin recommendations bundle](../plugin-recommendations/README.md). It composes this browser contribution with the Host skill and action service. This contribution has no configuration fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Turn tail reads the proposals of the `pluginRecommendations` Session projection and shows the one admitted in its Turn once that Turn has ended, for any end reason; the projection admits at most one proposal per Turn, and the chat hides the fence itself. A proposal the projection marks never offered renders nothing. The card asks the Host for the plugin's current catalog text and selection; a name outside the eligible catalog shows no actions. The browser contribution keeps returned catalog text by plugin name for its lifetime, so a revisited card renders it at once while its own lookup refreshes the selection. Until a plugin's first lookup returns, placeholder lines and the disabled actions hold the title, description and footer in place. Session projection decisions drive the card after reload. The optional Remote and all UI registrations are removed together on unload.

Cards use the application font, the deliverables card border and background, a distinct title and compact body scale, and a separate action footer. The built entry supplies generated Remote descriptors to the source-tested mount lifecycle.

- [Source](src/client/index.ts)
- [Tests](tests/)

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Recommendation service](../plugin-recommendations/README.md) — eligibility, activation and persistence.
- [Session projection](../../session/session-projection/README.md) — the proposals and card states the card reads.
- [Slots](../../client/ui-slots/README.md) — completed-Turn presentation.

<a id="model-experience"></a>
## Model Experience

Indirectly, through card actions: the Host recommendation service adds a logged status notice to the next model request. The browser contribution adds no model tools or prompt content.

#### KV Cache effect

The card adds no model context. Its Enable action can change subsequent tool declarations through the Host.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the first proposal in a Turn appears.
- Before a plugin's first lookup returns, the card reserves one description line; a longer description still extends the card when it arrives.
- Historical decisions do not track later changes made from the Plugins page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
