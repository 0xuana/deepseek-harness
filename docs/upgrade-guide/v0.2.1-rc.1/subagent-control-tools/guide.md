---
kind: upgrade-guide
description: Subagent discovery subpath plugins are replaced by their package main entries.
---

# Configure subagent discovery through main entries

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-tool-subagent-control` registers `send_message`, `interrupt_agent`, and `list_agents` together and requires `tools`, `subagents`, and `agents`. `@deepseek-ai/dsh-tool-subagent` registers `list_subagent_models` when its new `modelDiscovery` option is true; the option defaults to false independently of `modelSelection`. The separate `/list-agents` and `/list-models` exports are removed.

Web and Desktop presets enable discovery on their spawn instance. Headless, SDK, and ACP profiles keep discovery disabled by default. Discovery still reads the calling Session’s authorization and reports an error if `llm` is unavailable. It follows the configured plugin instance’s lifetime, independently of the delegation provider; unloading that instance removes discovery even if other delegation instances remain.

## Migration

1. Replace `/list-agents` rows with one `@deepseek-ai/dsh-tool-subagent-control` row per tool scope, or remove them if that row already exists. Disabling the shared row now disables all three control tools; use tool restrictions to hide individual tools.
2. Replace each `/list-models` row by setting `modelDiscovery: true` on one `@deepseek-ai/dsh-tool-subagent` instance in the same tool scope. Multiple discovery owners in one scope fail registration. Keep `modelSelection` enabled only on instances that should accept model-selection arguments.
3. Remove patches targeting the retired discovery row ids and migrate direct plugin consumers to the main entries. Keep the Host `/model-selection-settings` service when custom compositions need user-authorized alternative routes.
4. Verify one definition of each requested tool, discovery removal when its owning instance unloads, and unchanged tool schemas in compositions that leave discovery disabled.
