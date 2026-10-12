---
kind: upgrade-guide
description: "`modelSelectionSettings` on a fork delegation tool now fails the mount instead of exposing child route selection."
---

# Remove `modelSelectionSettings` from fork delegation tools

English | [中文](guide.zh.md)

## Change

In v0.2.1-alpha.2, a `@deepseek-ai/dsh-tool-subagent` row whose provider inherits the parent conversation, such as the in-process `fork` provider, accepted `modelSelectionSettings: true` and exposed `provider`, `model`, `reasoning_effort`, and `list_subagent_models` in Sessions with an enabled policy. The tool now rejects that configuration when the provider is mounted, so the composition fails to load with `provider "<name>" inherits the parent conversation and does not accept child model selection`. Fork children keep the parent route so the inherited conversation prefix stays eligible for KV Cache reuse.

The shipped profiles are unaffected: only the Web spawn tool sets `modelSelectionSettings`. A tool row with the setting now exposes the route fields and `list_subagent_models` in every Session; without a recorded Session policy, explicit selection permits only the parent route.

## Migration

1. In `cordis.yml`, profile patches, and overlays, remove `modelSelectionSettings` from every `@deepseek-ai/dsh-tool-subagent` row whose `provider` names a fork provider:

   ```yaml
   - name: '@deepseek-ai/dsh-tool-subagent'
     config:
       provider: fork
       toolName: subagent_fork
   ```

2. To let the model choose child routes, set `modelSelectionSettings: true` on one spawn-style row per tool scope instead.
3. Start the composition and confirm that it loads and that the fork tool schema lists only `cwd`, `description`, and `prompt`.
