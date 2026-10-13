---
description: "Model-facing subagent delegation tool for users and maintainers configuring, composing, or debugging delegation over a subagent provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-subagent

English | [中文](README.zh.md)

## Summary

Use this package to give an agent a named tool that delegates work to a configured backend. Every call starts a managed activation and returns a child id; the runtime owns completion notices and cleanup. Local children support messages and restoration, while external backends execute one task and return their final answer through the completion notice. Supported backends can expose approved child LLM routes. Each instance can set child persona, tool access, and depth limits.

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

The optional `cwd` argument selects the child's initial working directory. Relative paths resolve against the caller's current directory; omission inherits it. Existing children retain their own directories when the caller changes directory.

Mount one instance per delegation target, each with a distinct `toolName`. The tool exists exactly while its provider does, so sibling load order and provider reloads never strand it.

### Minimal configuration

Load the subagent service, an in-process or remote backend, and this tool; then name the provider. This composition exposes a `subagent` tool that delegates to the `spawn` backend:

```yaml
- name: '@deepseek-ai/dsh-subagent'
- name: '@deepseek-ai/dsh-subagent-spawn-in-process'
- name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | required | Provider name on `ctx.subagents` (e.g. `spawn`, `fork`, `acp`) |
| `toolName` | `subagent` | Model-facing tool name; distinct for every loaded instance |
| `modelSelection` | `false` | Expose optional child route fields; requires provider `agentOptions` support |
| `agentOptions` | — | Configured child `provider`, `model`, adapter-owned `reasoningEffort`, and positive `maxTokens` defaults; requires provider `agentOptions` support and overlays any provider-owned route defaults |
| `persona` | — | Per-child persona; requires the provider's `persona` capability |
| `toolFilter` | — | Per-child global-tool restriction; requires the `toolFilter` capability |
| `maxDepth` | Host setting (`1`) | Absolute delegation-depth cap (`0` forbids delegation); `'provider-managed'` sends no cap to an out-of-process provider |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-subagent) is the exhaustive source for every accepted field and its JSDoc.

### Managed delegation

Every call returns `started subagent <childId>` after the runtime accepts the child. It does not wait for the child's result. The activation owns the work independently of the completed tool call; the runtime sends a completion notice and releases execution resources.

Every backend’s completion notice carries its final answer. Local Spawn and Fork children can also send messages, accept more work through `send_message` while active, or resume after settling. Codex, Claude Code, ACP, and DSH SDK backends do not accept follow-up messages.

`maxDepth` caps recursion (`0` forbids delegation); omission reads the current Host `subagent.maxDepth` setting, initially `1`, at each delegation. A numeric depth requires a provider with the `depthLimit` capability; `'provider-managed'` leaves the budget to an out-of-process provider. `persona` and `toolFilter` configure every child when the provider supports them, and the tool stays visible at the cap — each attempted start checks the calling agent's current depth and rejects with an errored result.

### Selecting a child LLM

Set `modelSelection: true` to expose optional `provider`, `model`, and `reasoning_effort` fields; instances without it reject selection fields. Mount `@deepseek-ai/dsh-tool-subagent/list-models` independently to expose `list_subagent_models`. Web and Desktop presets mount discovery by default, enable route fields for spawn, and leave them disabled for fork. The Host’s `/model-selection-settings` service samples the user preference during Agent creation, independently of tool installation. When enabled, its exact route list is recorded in each fresh top-level Session, inherited by child Sessions, and preserved on restore; later settings edits affect only new Sessions. Without a recorded Session policy, discovery and explicit selection permit only the parent Agent’s current effective provider/model and its supported efforts. Route fields require a backend that advertises `agentOptions`; in-process Spawn and Fork and DSH SDK qualify, while ACP, Codex, and Claude Code fail the mount.

A call supplies `provider` and `model` together, or supplies only an effort when configured, parent, or provider-owned defaults provide the route. Static `provider.agentRouteDefaults`, when present, form the provider/model baseline; tool configuration and model fields overlay it before route-aware effort merging and exact-route preflight. Providers without these defaults use compatible values from the parent's latest logged request, then the parent's creation options before its first request, while retaining the configured `maxTokens`. Changing the route without an explicit effort clears the inherited route-owned effort, so the selected model resolves its default. The live LLM adapter validates the effective route before child creation. Catalog membership remains advisory, so a model can use an unlisted id when its adapter accepts it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the tool mirrors provider lifecycle and settles runs; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

One instance is one provider plus one tool name. The plugin registers its definition in the owning composition while the provider is present and disposes it when the provider leaves. Agents inherit that shared definition, so their existing tool filters apply without per-Agent registration. Discovery is a separate plugin and reads the same durable Session policy as the delegation executor. A numeric `maxDepth` or configured LLM selection unsupported by the provider fails the mount. Multiple distinctly named delegation tools may expose model selection in one scope.

### Activation ownership

The tool calls `ctx.subagents.startActivation()` with parent delivery selected. The runtime owns startup cancellation, execution, outcome reporting, and cleanup. A startup failure is an errored tool result; failures after publication arrive through the completion notice, with diagnostics and partial output preserved by the runtime.

### Result acknowledgement

The canonical tool result is `{ kind: 'activation', subagentId }`. It contains no execution Promise or final output; programmatic consumers that need to await results use the subagent service directly.

### Context-sensitive wording

The tool's description derives from `provider.inheritsParentContext`: a fresh child gets "it does not see this conversation" wording, a forked child gets "it does not see the current in-flight turn" wording, so the model never restates or omits context that does not exist.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool registration, provider lifecycle mirroring, activation requests |
| [`src/model-selection.ts`](src/model-selection.ts) | Request/config merge and live LLM route preflight |
| [`src/model-selection-settings.ts`](src/model-selection-settings.ts) | Host-owned opt-in setting sampled for new Sessions |
| [`src/model-selection-state.ts`](src/model-selection-state.ts) | Session event that records and inherits the sampled decision |
| [`src/list-models.ts`](src/list-models.ts) | `list_subagent_models` runtime discovery tool |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough; they move from the tool's runtime behavior to the seam it delegates over and the adjacent child tools.

- [Subagent subsystem](../../../docs/subsystems/subagent.md) — providers, activations, results, and continuation.
- [dsh-tool-subagent-control](../tool-subagent-control/README.md) — messaging, interrupt, and listing tools for continuable children.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent) — the default schema and backend-specific wording.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-subagent) — every accepted config field.
- [Historical model-selected subagent routes](../../../.agents/notes/archived/feature/2026-08-18-model-selected-subagent-routes.md) — selection policy, inheritance, discovery, and the fork restriction.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated default [`subagent` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent) appears under the configured tool name while its provider exists. An instance with `modelSelection` adds `provider`, `model`, and `reasoning_effort` plus route guidance in every Session. Context inheritance and continuation support determine task and follow-up descriptions. A tool restriction removes both the schema and its `tool:<toolName>` guidance section.

#### Token effect

Fixed schema cost per parent request; `modelSelection` adds three optional route fields. Each tool instance adds one schema; visible delegation tools share one short system-prompt section.

#### KV Cache effect

Prefix-stable while provider instances and their configuration are unchanged. Adapter catalog changes do not alter the definition. Shipped fork tools omit model-selection fields to preserve reuse of the inherited parent prefix. A custom fork tool may enable selection; changing its route can prevent prefix reuse.

### Model selection and discovery

#### What the model sees

The independent `list_subagent_models` definition reads the calling Session’s route policy, falling back to the current parent route when no policy is recorded. Calls reject while the optional `ctx.llm` service is unavailable. With a recorded policy, provider model lists intersect the advertised catalog with the Session’s authorized routes. Without one, they resolve only the current parent model, even if the catalog omits it. Exact-model queries accept authorized ids absent from the catalog; unauthorized provider/model lookups fail before adapter access. Catalog or exact-model lookup failures and cancellation reject the call. Execution independently enforces the same policy.

#### Token effect

One fixed discovery schema is present wherever `/list-models` is mounted, regardless of the Session’s preference or delegation tools; the shipped Web and Desktop presets include it, while headless and SDK profiles do not. Route metadata enters the transcript only when the model calls the tool.

#### KV Cache effect

The schema is prefix-stable across adapter registration and catalog changes. Each discovery result is appended after the reusable prefix.

### System prompt

#### What the model sees

Visible delegation tools share one guidance paragraph, listing tools in name order and instructing the model to start independent delegations together and keep working while they run. Hidden or unavailable tools are omitted; no guidance appears when none are visible. With both `subagent` and `subagent_fork` visible, the text is:

##### Tool-guidance section

```markdown
Start independent delegations with `subagent` or `subagent_fork` together in one assistant message and continue useful work while they run.
```

#### Token effect

At most one short delegation paragraph per parent request, listing the tool names visible to that request.

#### KV Cache effect

Prefix-stable while the visible tool names are unchanged; adding or removing a visible tool changes the paragraph.

### Start result

#### What the model sees

The call retains the task description and prompt. Success returns `started subagent <childId>`; startup rejection returns an error. Child execution details are delivered separately from this acknowledgement.

#### Token effect

The prompt and acknowledgement remain in parent history until compaction; child working context remains in the child.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Completion delivery

#### What the model sees

Answer delivery follows the managed delegation rules above. The returned child id identifies subsequent control and catalog operations; only backends with continuation support accept follow-up messages.

#### Token effect

Messages and completion notices append to parent history independently of the start acknowledgement. The tool result itself contains no final output.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what this tool does not return or enforce; they are current package constraints.

- **This tool does not wait for results** — use the completion notice or child messages. Programmatic result waiting belongs to the subagent service.
- **Shipped fork tools omit model selection** — their configuration leaves `modelSelection` disabled to preserve inherited-prefix reuse. Custom fork tools may enable it under the same Session authorization and adapter validation as other delegation tools.
- **Non-routing child policy is fixed per instance** — another persona, tool filter, or depth cap requires another distinctly named tool. Explicit LLM selection requires `modelSelection` and is restricted to the Session’s authorized routes, or the current parent route without an enabled policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
