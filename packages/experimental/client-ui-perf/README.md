---
description: "Experimental conversation view showing per-turn and per-step context size, first-token latency, model versus tool time, cache hit rate, and output speed."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-perf

English | [中文](README.zh.md)

## Summary

Adds a Performance tab beside Chat and Trajectory. Each turn is one row; expanding it lists its steps with context tokens, output tokens, cache hit rate, first-token latency, model time, output speed, tool time, and a total-time bar split into first token, generation, tools, and the rest. A running step shows elapsed time instead of a blank. The panel reads Session events only; it registers no tool, prompt section, or service.

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

Mount it in a client composition that already provides `slots`, `uiConversation`, and `locale`. It contributes one entry to the `conversation.view` slot; no configuration fields exist.

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

Three Conversation Definitions fold the event window into nodes for one view target named `perf`. `perf-step` owns one context per `step/start`; `perf-prompt` owns the turn's user question; `perf-turn-end` records the turn boundary so an interrupted tail closes.

| File | Responsibility |
| --- | --- |
| `src/client/perf-definition.ts` | The three Definitions, their match rules, publication cadence, and node envelopes |
| `src/client/perf-fold.ts` | Event folding, tool pairing, Code-Mode dispatch attribution, and per-step metrics |
| `src/client/perf-aggregate.ts` | Turn aggregation and turn ordering, including the interrupted-tail close |
| `src/client/perf-snapshot-builder.ts` | The `perf` view target builder |
| `src/client/PerfView.tsx` | Table, time bars, step accordion, and copy controls |
| `src/client/locales.ts` | Every visible string, in Chinese and English |

Windows are bounded: when a step's `step/start` is outside the loaded window, its start-dependent columns show `—` with a `start unknown` marker rather than a guessed value.

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
- **Code-Mode attribution is process-local.** Inner calls carry no turn or step, so ownership is resolved through an in-memory root-call map bounded at 4000 entries; a window replay that arrives after eviction cannot attribute older dispatches.
- **Package-level tests only.** Coverage covers folding, aggregation, and formatting; there is no browser snapshot or recorded-session scene for the tab yet.
- **Timing is derived, not sampled.** Total time is the last step's end minus the first step's start; queueing and scheduler waits land in the "rest" segment.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The panel was ported from a standalone client plugin. The table vocabulary follows `@deepseek-ai/dsh-session-stats` (model time, tool time, first token, output speed), while the layout follows the Trajectory table so the two tabs read alike.

</details>

**Runtime invariant:** No companion is published. All state derives from the Session event window, so independent observation would restate the register/fold logic rather than assert a distinct relationship.
