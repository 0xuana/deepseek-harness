---
description: "Show official plugin recommendations after completed answers."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-plugin-recommendations

English | [中文](README.zh.md)

## Summary

Users see one plugin recommendation below the completed answer, with the plugin's current title and description in the interface language and the Agent's reason. Clicking its title or description opens that plugin's details in Plugins without enabling it or changing the current Session. Enable and Not now remain separate choices. Decisions and the details link remain available after reconnecting.

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

The last valid `enable_official_plugin` block of an assistant answer becomes a hidden Conversation node; the chat hides the fence itself. The completed-Turn tail reads its indexed proposals and renders the first one, so answer streaming does not display the card, and a proposal the Host projection marks never offered renders nothing. The card asks the Host for the plugin's current catalog text and selection; a name outside the eligible catalog shows no actions. Session projection decisions drive the card after reload. The optional Remote and all UI registrations are removed together on unload.

Cards use the application font, a distinct title and compact body scale, and a separate action footer. The built entry supplies generated Remote descriptors to the source-tested mount lifecycle.

- [Source](src/client/index.ts)
- [Tests](tests/)

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Recommendation service](../plugin-recommendations/README.md) — eligibility, activation and persistence.
- [Conversation](../../client/ui-conversation/README.md) — event indexing.
- [Slots](../../client/ui-slots/README.md) — completed-Turn presentation.

<a id="model-experience"></a>
## Model Experience

Indirectly, through card actions: the Host recommendation service adds a logged status notice to the next model request. The browser contribution adds no model tools or prompt content.

#### KV Cache effect

The card adds no model context. Its Enable action can change subsequent tool declarations through the Host.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the first proposal in a Turn appears.
- Historical decisions do not track later changes made from the Plugins page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
