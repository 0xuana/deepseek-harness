---
description: "Parser for the fenced dsh-action JSON blocks an assistant answer ends with to propose a card, shared by the card experiments and the chat renderer."
kind: "package-library"
---

# @deepseek-ai/dsh-util-action-block

English | [中文](README.zh.md)

## Summary

Callers can read the `dsh-action` fenced blocks of an assistant answer as parsed JSON objects and tell which action each block names. The package owns only the fence grammar; every card experiment validates its own block fields and decides when a block becomes a card.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Read the blocks of an answer

`actionBlocksOf(text)` returns every well-formed JSON object inside a ```` ```dsh-action ```` fence, in answer order. Fences with malformed JSON, arrays or scalars produce nothing; other fence languages are ignored. Validate the fields of each object with the schema of the action that owns it.

```ts
import { actionBlocksOf, actionOf } from '@deepseek-ai/dsh-util-action-block'

declare const answerText: string

const blocks = actionBlocksOf(answerText)
const mine = blocks.filter(block => actionOf(block) === 'create_personalized_page')
const foreign = blocks.some(block => actionOf(block) !== undefined && actionOf(block) !== 'create_personalized_page')
```

### Tell actions apart

`actionOf(block)` returns the non-blank `action` string of a parsed block, or `undefined`. A projection uses it to find its own blocks and to notice that an answer also carries another experiment's block, without knowing that experiment's schema.

### Hide the fences

`ACTION_BLOCK_LANGUAGE` is the fence language. Chat renderers hide fences with this language from the rendered answer; transcript views keep the original text.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One global regular expression matches each fence whose info string starts with `dsh-action`; the body between the fence lines is parsed with `JSON.parse` after trimming. The parser keeps no state and has no dependency, so a Host projection and a browser bundle read the same answer identically.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Fence language, block parsing and the action discriminator |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Utility package map](../README.md) — adjacent stateless helpers.
- [Personalized pages](../../experimental/creation-recommendations/README.md) — proposes new pages through these blocks.
- [Plugin recommendations](../../experimental/plugin-recommendations/README.md) — recommends official plugins through these blocks.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fences must be closed and start at a line beginning** — a block the model leaves unterminated or indents is ordinary text; the answer is logged as written and no card appears.
- **No shared card rules yet** — one card per turn, replacement and status notices are still folded by each experiment; a shared action-card layer is deferred until both experiments have landed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
