---
description: "Experimental conversation view showing per-turn and per-step context size, first-token latency, model versus tool time, cache hit rate, and output speed."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-perf

English | [中文](README.zh.md)

## Summary

Adds a Performance tab beside Chat and Trajectory. Each turn is one row; expanding it lists its steps with context tokens, output tokens, cache hit rate, first-token latency, model time, output speed, tool time, and a total-time bar split into first token, generation, tools, and the rest. A running step shows elapsed time instead of a blank. Scrolling to the top pulls earlier turns through the same Session paging the other views use, with a `Load earlier` fallback button, an explicit retry state for a page that failed or did not advance, and an end-of-history marker. When a step has no tool calls, its answer label is followed by the first line of the model reply, with the full text on hover. The Trigger column classifies what opened the turn: a human prompt shows its text, while a team/agent message, subagent settlement, goal round, scheduled/webhook/job run, or runtime/time context shows a localized trigger badge plus the triggering text; a team or agent message names its member in the badge (`团队消息 · hfai-deploy`) and omits opaque session ids, while a subagent settlement shows its tag and the settled report with the transport framing stripped. A prompt that attached images shows an image-count pill in the same style as the trigger badge. Hovering or keyboard-focusing the pill opens a small preview strip, and clicking a preview loads that image in the shared image viewer; an image-only prompt shows the pill instead of an empty cell. The panel reads Session events and the prompt's durable images; it registers no tool, prompt section, or service.

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

Mount it in a client composition that already provides `slots`, `sessions`, `uiConversation`, and `locale`. It contributes one entry to the `conversation.view` slot; no configuration fields exist.

### When to choose it

Choose it when you need to compare turns or steps by prompt length, cache reuse, and where wall time went. Choose `@deepseek-ai/dsh-client-ui-trajectory` when you need the full event ledger with request headers and tool payloads; the two panels read the same Session and can be enabled together.

### Minimal configuration

```yaml
- id: ui-perf
  name: '@deepseek-ai/dsh-experimental-client-ui-perf'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Four Conversation Definitions fold the event window into nodes for one view target named `perf`. `perf-step` owns one context per `step/start`; `perf-prompt` owns one context per waking user message (human prompt or automated trigger); `perf-turn-end` records the turn boundary so an interrupted tail closes; `perf-code-mode` owns one context per Code-Mode root call for the inner dispatches its runner performed. Turn and step identity comes from the engine's match Location, never from module state, so history paging and multiple Sessions cannot cross-attribute events.

| File | Responsibility |
| --- | --- |
| `src/client/perf-definition.ts` | The four Definitions, their match rules, publication cadence, and node envelopes |
| `src/client/perf-fold.ts` | Event folding, tool pairing, Code-Mode dispatch attribution, and per-step metrics |
| `src/client/perf-aggregate.ts` | Turn aggregation and ordering, the interrupted-tail close, and the Code-Mode merge into the owning step |
| `src/client/perf-snapshot-builder.ts` | The `perf` view target builder |
| `src/client/PerfView.tsx` | Scrollport with scroll-to-top paging, table, time bars, step accordion, copy controls, and the prompt image pill with its preview and viewer |
| `src/client/locales.ts` | Every visible string, in Chinese, English, and Japanese |

Windows are bounded: when a step's `step/start` is outside the loaded window, its start-dependent columns show `—` with a `start unknown` marker rather than a guessed value. Scrolling to the top asks the Session for one older page; the view offsets the scroll position by the height it prepended, so the row being read stays in place.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-client-ui-trajectory`](../../client/ui-trajectory/README.md) — the event ledger this panel borrows its table conventions from.
- [`@deepseek-ai/dsh-session-stats`](../../session/session-stats/README.md) — the host-side session totals the footer vocabulary follows.
- [`docs/subsystems/conversation.md`](../../../docs/subsystems/conversation.md) — how view targets and Definitions assemble.

-----

<a id="model-experience"></a>
## Model Experience

None, as the panel only reads Session events and renders them in the browser; it registers no tool, prompt section, or model input.

#### KV Cache effect

No effect. The package never constructs a model request and never mutates a prompt.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Not mounted by the default product.** The Web bundle refuses experimental packages by rule, so a profile or explicit composition must add the row.
- **Trimmed windows lose start times.** When the loaded window begins mid-step, first-token, model time, and total time cannot be derived; the row says `start unknown` instead of estimating.
- **Code-Mode dispatches merge by root-call context.** Inner calls carry no turn or step, so each root call opens its own context keyed by the root call id, and the builder merges its dispatches into the step that owns the runner. A window that lost the dispatch start still merges the calls but cannot show their measured duration.
- **Browser evidence is a test-only overlay.** Package tests cover folding, aggregation, formatting, and the jsdom table; `apps/web/tests/client-ui-perf-panel.e2e.ts` mounts the plugin through a test-only overlay over the shipped Web surface and compares a committed ARIA golden. No recorded-session scenario exists because no shipped profile mounts the package yet.
- **Late re-deliveries are not turns.** Compaction can restate a pruned tool result under its original turn and step after that turn left the window; a turn with no loaded start, prompt, or end marker is dropped instead of appearing as an empty ghost row.
- **Timing is derived, not sampled.** Total time is the last step's end minus the first step's start; queueing and scheduler waits land in the "rest" segment. The total-time bar draws tool calls as the union of their paired intervals, so parallel calls count once; the tool column keeps the summed per-call time. A turn bar is scaled against the turns currently visible on screen, so a much larger turn that scrolled away does not flatten the rows in view.
- **Prompt images load through the shared image cache.** The pill and its preview resolve durable attachments with `uiConversation.imageUrl`, so the cache owns and revokes the browser URLs per Session binding; the view creates none of its own. A failed read shows a localized failure state with retry. Touch clients do not open the hover preview; tapping the pill loads the first image directly.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The panel was ported from a standalone client plugin. The table vocabulary follows `@deepseek-ai/dsh-session-stats` (model time, tool time, first token, output speed), while the layout follows the Trajectory table so the two tabs read alike.

</details>

**Runtime invariant:** No companion is published. All state derives from the Session event window, so independent observation would restate the register/fold logic rather than assert a distinct relationship.
