---
description: "Shared Host service of optional action cards: the propose_action tool, card state, user actions and status notices that experiment packages register card kinds into."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-action-cards

English | [中文](README.zh.md)

## Summary

An experiment can offer one optional action below an answer, such as creating a page, without adding a tool of its own. The model loads the experiment's skill, then calls `propose_action`; the card appears after the turn ends, and nothing runs until the user acts on it. Each choice is recorded and reported to the model on its next request. The tool costs nothing until a card skill loads in the conversation.

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

The [Personalized pages](../creation-recommendations/README.md) and [Plugin recommendations](../plugin-recommendations/README.md) bundles each insert this service and its [browser half](../client-ui-action-cards/README.md); enabling either bundle enables both. The service has one configuration field:

| Field | Default | Meaning |
|---|---|---|
| `queuedMessageLimit` | `2` | Queued next-turn user messages at or above which a card proposed in the current turn is never offered. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-action-cards) is the exhaustive source for accepted fields.

### Register a card kind

A kind package injects `actionCards` and calls `ctx.actionCards.register(kind)` from its own plugin; unloading that plugin removes the kind, and actions on its cards are then refused as unavailable. The kind names its action, the skill that proposes it, a zod schema for the card's `details`, the user actions it accepts and the shared checks each needs (`global` Remote access, `writes` refused in a read-only Session), the recorded phases that still offer dismissal, optional status guidance, the decision data fields the status notice reports, and the handler for every action except `dismiss`. The handler records each new decision with `ctx.actionCards.record()` and returns `accepted`, `settled` with the decision in effect, `refused` or `unconfirmed`.

### Card rules

- The first accepted `propose_action` call of a turn becomes the card. The tool refuses a second call in the same turn, an unregistered action, a call whose kind skill was not loaded in the current turn, a blank title or brief, details that fail the kind schema, and calls dispatched from code.
- A newer card replaces every unstarted earlier card. A card proposed while `queuedMessageLimit` or more user messages wait for later turns is logged but never offered. Both states are derived from the log and never recorded.
- Events a forked Session inherits create no cards.
- Not now is recorded for an unstarted card and for the phases the kind lists; dismissed, replaced and suppressed cards accept no further action.
- Concurrent actions on one card share one operation. Actions require the card's live root Agent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package default-exports the `actionCards` Remote service. It registers `propose_action` once, globally, with a `when` condition: an Agent becomes eligible when a `skill` tool result loads the skill of a registered kind, and the flag lives in memory until the Agent is disposed. The call's `execute` checks the current turn's skill loads through the turn boundary and keeps an in-memory mark of the turn's accepted call; the logged `tool/call` and its successful `tool/result` are the durable proposal.

The `actionCards` Session projection (state version 1) pairs each `propose_action` call with its successful result, records decisions from `plugin:action-cards/decision`, folds queued next-turn messages from inbox splices, and keeps unreported decisions until a status notice whose `through` covers them enters the log. Its Client view `{ proposals, decisions }` is excluded from Session summaries.

The Remote `act(sessionId, callId, verb, payload?)` checks the owner, the live root, the card, the kind and verb, and Remote access before it shares one operation per card. A dismissed, replaced or suppressed card then settles unchanged, Not now is recorded, a writing verb is refused in a read-only Session, and every other verb goes to the kind handler under the Agent's initiator. An `agent/pre-step` listener adds the status notice after later listeners prepared the step.

| Source | Contents |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, tool, kind registry, Remote action and status notice |
| [`src/projection.ts`](src/projection.ts) | Session projection |
| [`src/types.ts`](src/types.ts) | Proposal, decision, view and result types |
| [`tests/`](tests/) | Activation, validation, projection, action and notice tests |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Action card display](../client-ui-action-cards/README.md) — the browser frame, kind bodies and the process row.
- [Personalized pages](../creation-recommendations/README.md) and [Plugin recommendations](../plugin-recommendations/README.md) — the shipped card kinds.
- [Tools](../../core/tools/README.md) — conditional registration and step admission.
- [Session projection](../../session/session-projection/README.md) — the card state the browser reads.

<a id="model-experience"></a>
## Model Experience

### Card tool

#### What the model sees

The [`propose_action` declaration](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-action-cards) appears only to an Agent that loaded the skill of a registered kind in this Session, from the next step on, for that Agent's lifetime. A kind's skill names the action and the fields of `details`. An accepted call returns `Card shown below your answer. Do not restate it; end with one short invitation.`. A refused call returns its reason, for example `Load skill <skill> first, then call propose_action.`, `One card per turn; the earlier card stands.`, `Unknown action "<action>". Registered actions: <actions>.` or the failing `details` fields.

#### Token effect

Before a card skill loads, the tool adds no tokens. Afterwards each request of that Agent declares it: 574 characters of JSON, about 144 tokens at the token meter's four characters per token. A card costs one extra model round trip, the call before the final answer, and its short tool result.

#### KV Cache effect

Activation is append-only on routes that declare tool updates, such as DeepSeek-V4.1-Flash: when the condition turns true the loop logs a header change and a `tool-addition` developer message, and those routes receive the definition as a deferred declaration referenced at that position, so the cached prefix is kept. A route without tool updates receives the tool in its declaration list from that step on, which changes the request prefix once. Disposing the Agent drops the activation; a reopened Session declares the tool again only after a card skill loads again, logging a removal and a later addition.

### Card status notice

#### What the model sees

After a decision is recorded, the next request carries one `action-cards` notice: the preamble below, the guidance sentences of each involved kind, `Continue with the user’s current request.`, and a JSON array of the changed cards with `action`, `callId`, `title`, `phase` and the data fields their kind reports.

##### Notice preamble

```markdown
Latest status of action cards from user actions and background work. These are status facts, not a request to start or retry work. Use these receipts instead of the earlier proposal when describing progress.
```

#### Token effect

One notice per request that follows new decisions, sized by the changed cards; unchanged cards add nothing, and several decisions of one card collapse to its latest.

#### KV Cache effect

The notice is appended after the request's other new context and never rewrites earlier messages. The notice neither starts a turn nor wakes an idle conversation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Activation is per live Agent and kept in memory, so after a Session reopens the tool appears again only after a card skill loads again.
- Calls dispatched from code, as in PTC presets, are refused: the log records them as program dispatches rather than tool calls, so no card could follow them.
- Only one card is offered per turn across all kinds, and one unstarted card per conversation.
- The projection reads `queuedMessageLimit` while its state version stays fixed. A changed limit applies to Sessions folded again from their log; cached projection rows keep the suppression decided under the earlier limit.
- The Personalized pages and Plugin recommendations bundles both insert the rows of this service and its browser half. With both bundles enabled the Loader keeps one entry per row id, and both bundle pages list these rows, so switching or configuring a row there changes the one shared entry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
