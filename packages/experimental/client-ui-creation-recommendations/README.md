---
description: "Show completed-answer creation cards with location choice, Keep and Undo."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-creation-recommendations

English | [中文](README.zh.md)

## Summary

Users see one creation proposal below the completed answer. Plans show up to three lines and expand to reveal the full brief; Creator always receives the full brief. Cards use the application font, separate title and body sizes, and show progress in the header. The recommended location is visible immediately; Options reveals Right sidebar, Session tab, and Global page with a left entry. Create starts background work. After installation, Keep confirms retention and Undo removes the new plugin.

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

Enable the [Personalized pages bundle](../creation-recommendations/README.md). This browser contribution has no configuration fields.

### Outcomes and recovery

Creation, installation, retention and removal receipts come from the Session projection. The card restores them after reconnecting. A lost action reply shows an actionable error; retry uses the Host’s recorded state. Pending requests disable repeated actions. During generation, Cancel stops the child and waits for cleanup before retry. Accepted installations finish without cancellation. The card identifies the original workspace’s source directory and explains that Undo keeps those files.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Successful native and PTC result metadata become hidden Conversation nodes. The completed-Turn tail reads its indexed proposals and displays only the first. The component receives session-bound callbacks rather than accessing services. Its optional Remote, locale, event definition and slot registration share one plugin lifetime.

- [Source](src/client/index.ts)
- [Tests](tests/)

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Creation service](../creation-recommendations/README.md) — creation ownership and persistence.
- [Conversation](../../client/ui-conversation/README.md) — event indexing.
- [Slots](../../client/ui-slots/README.md) — completed-Turn presentation.

<a id="model-experience"></a>
## Model Experience

Indirectly, through an accepted Create action: the Host starts a Creator run. The browser adds no model tools or prompt content.

#### KV Cache effect

Rendering and changing the location do not affect the model cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The brief is model-authored and must include the context the Creator needs.
- Historical receipts do not continuously track later manual changes on the Plugins page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
