---
description: "Scanner for the fenced dsh- directive blocks of assistant answers: dsh-action proposal parsing and fence hiding, shared by the card experiments and the chat renderer."
kind: "package-library"
---

# @deepseek-ai/dsh-util-action-block

English | [中文](README.zh.md)

## Summary

Callers can find the `dsh-` directive fences of an assistant answer, read its `dsh-action` blocks as parsed JSON objects, tell which action each block names, and render the answer without those fences. The package owns only the fence grammar; every card experiment validates its own block fields and decides when a block becomes a card.

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

`actionBlocksOf(text)` returns every well-formed JSON object inside a closed ```` ```dsh-action ```` fence, in answer order. Fences with malformed JSON, arrays or scalars produce nothing, and so does an unclosed fence; other fence languages are ignored. Validate the fields of each object with the schema of the action that owns it.

```ts
import { actionBlocksOf, actionOf } from '@deepseek-ai/dsh-util-action-block'

declare const answerText: string

const blocks = actionBlocksOf(answerText)
const mine = blocks.filter(block => actionOf(block) === 'create_personalized_page')
```

### Tell actions apart

`actionOf(block)` returns the non-blank `action` string of a parsed block, or `undefined`. A projection uses it to find its own blocks and to notice that an answer also carries another experiment's block, without knowing that experiment's schema.

### Hide the fences

`hideDirectiveFences(text, { streaming })` removes every fence whose language starts with `dsh-`, from its opening line through its closing line, and keeps all other text as written. When a blank line precedes a removed fence, a blank line directly after it is removed too, so one blank line remains; when nothing follows the fence, the blank line before it is removed. An unclosed last fence is removed only while `streaming` is true, because the rest of the block has not arrived; a finished answer keeps it as text. Transcript views keep the original answer.

```ts
import { hideDirectiveFences } from '@deepseek-ai/dsh-util-action-block'

declare const answerText: string
declare const streaming: boolean

const rendered = hideDirectiveFences(answerText, { streaming })
```

### Find the fences

`scanDirectiveFences(text)` returns each directive fence with its language, the offsets of its first line and of the end of its closing line, whether it is closed, and the body lines between the fence lines. `ACTION_BLOCK_LANGUAGE` is the `dsh-action` language.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The scanner splits the text into lines ending in `\n` or `\r\n` and follows CommonMark fenced code blocks outside any other fence. An opening line has at most three spaces of indentation and three or more backticks or tildes; the first word of its info string is the language, and a backtick fence's info string contains no backtick. The first later line with at most three spaces of indentation and at least as many of the same character, followed only by spaces or tabs, closes it. Every line inside an open fence of any language is its content, so a `dsh-action` example inside a `````` ````markdown `````` or `~~~` fence is neither parsed nor hidden, and fence characters after other text on a line open nothing. Block bodies are parsed with `JSON.parse` after trimming. The scanner keeps no state and has no dependency, so a Host projection and a browser bundle read the same answer identically.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Fence scan, block parsing, the action discriminator and fence hiding |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Utility package map](../README.md) — adjacent stateless helpers.
- [Personalized pages](../../experimental/creation-recommendations/README.md) — proposes new pages through these blocks.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Block quotes and list items are not parsed as containers** — a fence after a `>` marker is plain text, and a fence indented by up to three spaces inside a list item counts as a top-level fence.
- **Hiding can join paragraphs** — a removed fence written without blank lines around it leaves the lines before and after it adjacent, so Markdown renders them as one paragraph.
- **No shared card rules yet** — one card per turn, replacement and status notices are still folded by each experiment; a shared action-card layer is deferred until a second card experiment reads these blocks.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
