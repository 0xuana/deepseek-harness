---
description: "Experimental conversation view showing per-turn and per-step context size, first-token latency, model versus tool time, cache hit rate, and output speed."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-perf

English | [中文](README.zh.md)

## Summary

Adds a Performance tab beside Chat and Trajectory. Turn rows expand into steps with context and output tokens, cache hit rate, first-token latency, model and tool time, output speed, and a total-time bar. Scrolling up pulls earlier turns through shared Session paging. The Trigger column names what opened the turn, including a team message's sender, and prompt images show a count pill with a hover preview in the shared viewer. The panel reads Session events and durable prompt images; it registers no tool, prompt section, or service.

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

The footer switches control the totals row, event rows, and the context basis, and the footer stays pinned above the composer while the table scrolls. `Show context delta` is off by default; when on, every turn and step shows its prompt-size change against the previous measured value in that scope, with negative deltas (for example after compaction) in the error colour. An expanded step row fills the Trigger column with its start clock and any gap of at least one second since the previous step; sub-second scheduler noise is hidden.

The footer switches control the totals row and the context basis. `Context basis` changes only how a turn row aggregates its steps: `Latest` shows the turn's final prompt size, while `Cumulative` sums that turn's step prompt sizes. The totals row is not affected by this switch. When the host exposes the `sessionStats` and `tokenUsage` projections, the totals row covers the complete Session: turns, steps, cumulative context and output, token-weighted cache, first-token/model/tool time, and output speed. Total time there is model time + tool time because no whole-session wall projection exists. Without those projections the row falls back to the loaded window and is labelled `Window total`. Token cells switch from `K` to `M` at ten million.

Non-step rows are hidden by default; the `Show event rows (incl. compaction)` footer switch enables them. Compaction is a log-only transaction, not a step. The table inserts a synthetic `Compaction` row between the steps it ran between; the row shows the summary call's context, output and cache-hit cells, the shadowed token count, the summary size, and its wall time. The same switch reveals request-header, system-prompt, tool-set, and model-free prune rows: a request header shows its reason, provider/model, series flag and tool count; a system prompt shows append/replace/clear and character size; a tool-set row lists added and removed tool names; a prune row shows the pruned token count. These rows are excluded from the turn and totals step sums, so the step columns keep their step-only meaning.

The turn cache-hit cell is token-weighted across the steps that reported usage (summed cache reads ÷ summed prompt tokens), so one transient cold step is not hidden by a warmer neighbour; the tooltip shows the summed read/input/write breakdown. A step row keeps its own measured share.

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
