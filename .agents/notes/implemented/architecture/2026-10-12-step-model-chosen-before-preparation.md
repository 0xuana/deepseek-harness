# Agent Note: Choose the step model before step preparation

Status: implemented

English | [中文](2026-10-12-step-model-chosen-before-preparation.zh.md)

## Problem

Tool availability can depend on the route of the request that declares the tools: `web_search` must stay off routes without search credentials, and plan or team state can withhold other tools. Message preparation needs the same model: session references size snapshots by the model's context window, and model selection announces a switch. The loop assembled tools and prompt sections before `agent/pre-step` and decided the provider, model, and reasoning effort only in `agent/request` after `step/start`, so earlier consumers predicted them from model-selection state. A listener that replaced them in `agent/request`, including on a retry, made the assembled prompt and tool catalog describe another model. Plan state had the same problem: it was committed inside `agent/pre-step`, so plan guidance predicted it from the pending selection.

## Decision

The provider, model, and reasoning effort are a step fact, chosen together as the user chooses them before sending a message. After claiming input, the loop dispatches the serial `agent/step-boundary` event, where plugins commit selections that apply from this step, such as a pending plan-mode switch. It then dispatches `agent/model` once per proposed step. Its default comes from the agent options before this loop logs a request and from the logged header afterwards, with an effort only when one was chosen for that exact model; `installModelSelection` returns its current selection there. The loop publishes the result as `agent.step` and clears it when the step ends or its proposal is rejected, fails, or is cancelled. `agent/pre-step` listeners, tool conditions, prompt sections, and the `{{provider}}` and `{{model}}` variables read the selection from the agent.

After `agent/pre-step` accepts the step and `step/start` opens it, the loop resolves conditional tools and assembles the prompt once: sections, variables, runtime context, and tool declarations. The runtime-context snapshot is admitted after the step's accepted messages. Each request attempt then runs `agent/request` and `prepareCall()` immediately before admission. `agent/request` may change sampling controls; a result with another provider, model, or reasoning effort fails the step. Retries reuse the step's model selection, tool set, and rendered assembly, and the step-owned tool set closes after the step's tool batch settles. A selection made during a step applies from the next step.

## Alternatives considered

- **Bind the route in `agent/request` before `agent/pre-step` and expose `Agent.currentRoute()`.** The prepared call captures the adapter registration and connection settings, so holding it across compaction, hooks, and session reads ignores settings changed meanwhile, and adapters were prepared for steps that `agent/pre-step` rejects. The getter was valid only inside a step and threw elsewhere, and every Agent implementation and test double had to carry it.
- **Choose the model inside `agent/pre-step`.** Pre-step listeners consume the model for reference budgets and switch notices. Deciding and consuming it in one waterfall makes the value each listener sees depend on registration order.
- **Pass the selection to each consumer as a parameter.** `AssembleContext`, the pre-step payload, and `ToolActivationContext` each needed a field, and every later step decision would add one to all three. `agent.step` gives them one source.
- **Register the model selection on the Agent without an event.** It adds a single-consumer method to the generic `Agent` interface and removes the listener path that supplies a model for agents created without one.
- **Keep the decision in `agent/request` and predict it for earlier consumers.** A prediction diverges whenever a listener other than model selection changes the model.
- **Choose only the provider and model per step and leave reasoning effort to `agent/request`.** An effort is valid only for the model it was chosen for. The split required `installModelSelection` to capture the selection in one waterfall and apply its effort in another only when no other listener had replaced the model, and it let a retry change effort within a step.
- **Prepare runtime context before `agent/pre-step` in a separate `system-prompt/prepare` phase.** It kept the runtime context between the claimed input and messages added by pre-step listeners, but split assembly into two hooks and made a changed runtime context alone open a step.
- **Commit pending plan selections inside `agent/pre-step`.** Phases and listeners that ran before the commit saw the previous plan state, and model choice could not depend on plan mode.

## Consequences

- Tool conditions, prompt variables, reference budgets, and switch notices read the provider and model that the request header records.
- `prepareCall()` stays adjacent to dispatch, so its adapter registration and connection snapshot cover only header logging and streaming.
- A step cannot fail over to another provider or change reasoning effort on retry; a policy that needs this must run model selection, tool resolution, and assembly again for the retried attempt.
- `agent.step` is undefined between steps and during `agent/model`; work that outlives its step reads it at its start.
- `agent/model` listeners can read plan state because the boundary commits it first, but model choice still cannot depend on `agent/pre-step` outcomes.
- A pending plan-mode selection is committed even when `agent/pre-step` rejects the step; its notice joins the next admitted step.
- The runtime-context snapshot follows the step's accepted messages, and a changed runtime context alone does not open a step.

## Related

- [Provider-routed LLM adapters](2026-07-14-provider-routed-llm-adapters.md) owns provider and model fields in call configuration.
- [Reconstructable requests](2026-07-05-reconstructable-requests.md) owns request reconstruction from the logged header.
- [Prompt variables and tool guidance ownership](2026-07-05-prompt-variables-and-tool-guidance-ownership.md) owns the `{{model}}` variable.
