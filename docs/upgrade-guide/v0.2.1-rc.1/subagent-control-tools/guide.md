---
kind: upgrade-guide
description: Subagent discovery plugins are replaced by the shared subagent-control entry.
---

# Mount subagent control tools once

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-tool-subagent-control` registers `send_message`, `interrupt_agent`, `list_agents`, and `list_subagent_models` together. The separate `@deepseek-ai/dsh-tool-subagent-control/list-agents` and `@deepseek-ai/dsh-tool-subagent/list-models` exports are removed. The shared plugin requires `tools`, `subagents`, `agents`, and `sessionProjections`; model discovery reports an error if `llm` is unavailable.

The shipped headless, SDK, and ACP profiles now include model discovery through the shared control plugin. Tool presence does not grant model-selection authorization: discovery still uses the calling Session’s recorded policy, or only the current parent route when no policy exists. Web and Desktop retain their model-selection settings and delegation defaults.

## Migration

1. Replace the separate discovery rows in custom `cordis.yml` files and patches with one `@deepseek-ai/dsh-tool-subagent-control` row per tool scope. If that row already exists, remove the redundant discovery rows. Direct plugin consumers mount the root entry once.
2. Remove patches targeting the retired `tool-subagent-list-agents` and `tool-subagent-list-models` row ids. A patch disabling `tool-subagent-control` now disables all four tools; use existing tool restrictions when only selected tools should be hidden.
3. Provide the required services before mounting the shared plugin. Keep the Host `@deepseek-ai/dsh-tool-subagent/model-selection-settings` service when custom compositions need user-authorized alternative routes.
4. Verify that the calling Agent sees one definition of each of the four tools and that `list_subagent_models` returns only the Session’s authorized routes or its current parent route.
