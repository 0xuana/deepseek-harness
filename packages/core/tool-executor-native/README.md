---
description: "Native function calls with scoped tools and bounded batch execution."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-executor-native

English | [中文](README.zh.md)

## Summary

Use this executor when models should call each visible tool directly. Mount it beside the tool registry in the deployment, a preset, or an Agent scope. Parallel-safe calls can overlap; exclusive calls form barriers, and results remain in model order.

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

Add this row to a composition with `dsh-tools` mounted. The nearest scoped executor selects tool behavior; one scope permits only one executor.

```yaml
- name: '@deepseek-ai/dsh-tool-executor-native'
  config:
    maxParallelToolCalls: 10
```

For Agent steps, configure [agent-loop concurrency](../agent-loop/README.md); the loop always forwards its resolved limit to `execute()`. The executor's `maxParallelToolCalls` supplies the limit only when the caller omits it. This fallback is volatile, defaults to `10`, and is sampled for the next tool group. It must be a positive integer; `1` selects serial execution.

[Configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-executor-native)

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The executor receives the entire raw call batch and owns parsing, scheduling, cancellation, and optional model-step logging. It reuses the shared invocation pipeline for policy, tool bodies, and result notifications. After abort, it waits for started work and returns ordered error results for skipped calls.

- [`src/index.ts`](src/index.ts) — Validated configuration and scoped registration; tool descriptions and batch execution.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool registry](../tools/README.md)
- [Agent loop](../agent-loop/README.md)
- [Alternative executor](../tool-executor-ptc/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Visible tools

#### What the model sees

Each visible tool’s `name`, `description`, and JSON Schema parameters; no additional prompt section.

#### Token effect

Request cost grows with visible definitions; hiding a definition removes its schema cost.

#### KV Cache effect

The prefix remains stable while tool descriptions and ordering stay unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints apply to accepted calls.

- Same-process tools must observe cancellation; the executor cannot forcibly terminate a tool that ignores its signal.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
