---
kind: upgrade-guide
description: Custom subagent compositions must separate route fields, model discovery, and Session authorization.
---

# Separate subagent model selection configuration

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-tool-subagent` replaces `modelSelectionSettings` with `modelSelection`, which controls only optional child route fields. The tool no longer registers `list_subagent_models` or samples user settings. The Host `/model-selection-settings` service records authorization during Agent creation, including Sessions created before delegation tools are mounted. Existing Sessions keep their recorded policy; installing tools later does not resample settings. Shipped Web and Desktop presets include the independent discovery plugin and keep fork route fields disabled. Custom fork tools may enable them.

## Migration

1. In custom `cordis.yml`, patches, or direct plugin configuration, rename `modelSelectionSettings: true` to `modelSelection: true` on delegation tools that expose route arguments.
2. Add an independent `@deepseek-ai/dsh-tool-subagent/list-models` row to each tool scope that needs discovery. Multiple delegation tools may share it.
3. Mount `@deepseek-ai/dsh-tool-subagent/model-selection-settings` in the Host before creating Agents. Its required services are `sessions` and `sessionProjections`. Direct `apply(ctx, config)` callers no longer pass a Session argument.
4. Create a fresh Session and verify that discovery returns the authorized routes when the user preference is enabled, or only the parent Agent’s current route otherwise. Verify that an explicit unauthorized delegation fails even without first calling discovery.
