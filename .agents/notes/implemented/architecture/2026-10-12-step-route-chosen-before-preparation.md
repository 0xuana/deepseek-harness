# Agent Note: Choose the step route before step preparation

Status: implemented

English | [中文](2026-10-12-step-route-chosen-before-preparation.zh.md)

## Problem

Tool availability can depend on the route of the request that declares the tools: `web_search` must stay off routes without search credentials, and plan or team state can withhold other tools. Message preparation needs the same route: session references size snapshots by the model's context window, and model selection announces a switch. The loop assembled tools and prompt sections before `agent/pre-step` and decided the route only in `agent/request` after `step/start`, so earlier consumers predicted the route from model-selection state. A listener that replaced the route in `agent/request`, including on a retry, made the assembled prompt and tool catalog describe another model.

## Decision

The provider and model are a step fact. After claiming input, the loop dispatches `agent/route` once per proposed step. Its default is the agent options route before this loop logs a request and the logged header route afterwards; `installModelSelection` captures its selection there. The loop passes the resulting `StepRoute` to `system-prompt/prepare` as `AssembleContext.route`, to `agent/pre-step` as `payload.route`, and to tool conditions as `ToolActivationContext.route`. The `{{provider}}` and `{{model}}` prompt variables read it.

After `agent/pre-step` accepts the step and `step/start` opens it, the loop resolves conditional tools and assembles the prompt once. Each request attempt then runs `agent/request` and `prepareCall()` immediately before admission. `agent/request` may change call controls; a result with another provider or model fails the step. Retries reuse the step's route, tool set, and rendered assembly, and the step-owned tool set closes after the step's tool batch settles. A selection made during a step applies from the next step.

## Alternatives considered

- **Bind the route in `agent/request` before `agent/pre-step` and expose `Agent.currentRoute()`.** The prepared call captures the adapter registration and connection settings, so holding it across compaction, hooks, and session reads ignores settings changed meanwhile, and adapters were prepared for steps that `agent/pre-step` rejects. The getter was valid only inside a step and threw elsewhere, and every Agent implementation and test double had to carry it.
- **Record the route inside `agent/pre-step`.** `system-prompt/prepare` runs before that waterfall, and route consumers inside it would depend on listener order.
- **Register the model selection on the Agent without an event.** It adds a single-consumer method to the generic `Agent` interface, moves model-selection effort rules into the loop, and removes the listener path that supplies a route for agents created without one.
- **Keep the route decision in `agent/request` and predict it for earlier consumers.** A prediction diverges whenever a listener other than model selection changes the route.

## Consequences

- Tool conditions, prompt variables, reference budgets, and switch notices read the route that the request header records.
- `prepareCall()` stays adjacent to dispatch, so its adapter registration and connection snapshot cover only header logging and streaming.
- A step cannot fail over to another provider on retry; a policy that needs this must run routing, tool resolution, and assembly again for the retried attempt.
- The route cannot depend on `agent/pre-step` outcomes. Plan state commits inside that waterfall, so a plan-specific model would require committing plan selections before routing.
- `agent/pre-step` listeners and direct dispatchers must handle the required `route` field.

## Related

- [Provider-routed LLM adapters](2026-07-14-provider-routed-llm-adapters.md) owns provider and model fields in call configuration.
- [Reconstructable requests](2026-07-05-reconstructable-requests.md) owns request reconstruction from the logged header.
- [Prompt variables and tool guidance ownership](2026-07-05-prompt-variables-and-tool-guidance-ownership.md) owns the `{{model}}` variable.
