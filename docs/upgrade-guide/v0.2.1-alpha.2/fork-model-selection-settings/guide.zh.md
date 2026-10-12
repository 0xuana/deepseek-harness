---
kind: upgrade-guide
description: "fork 委派工具上的 `modelSelectionSettings` 现在会使挂载失败，而不再公开子级路由选择。"
---

# 从 fork 委派工具中移除 `modelSelectionSettings`

[English](guide.md) | 中文

## 变更

在 v0.2.1-alpha.2 中，如果 `@deepseek-ai/dsh-tool-subagent` 配置行的提供方会继承父级对话（例如进程内 `fork` 提供方），它会接受 `modelSelectionSettings: true`，并在策略已启用的 Session 中公开 `provider`、`model`、`reasoning_effort` 和 `list_subagent_models`。现在该工具会在提供方挂载时拒绝这一配置，组合加载失败并报告 `provider "<name>" inherits the parent conversation and does not accept child model selection`。fork 子级保持父级路由，使继承的对话前缀继续符合 KV Cache 复用条件。

随附 profile 不受影响：只有 Web 的 spawn 工具设置了 `modelSelectionSettings`。设置了该项的工具行现在会在每个 Session 中公开路由字段和 `list_subagent_models`；没有已记录 Session 策略时，显式选择只允许父级路由。

## 迁移

1. 在 `cordis.yml`、profile patch 和 overlay 中，从所有 `provider` 指向 fork 提供方的 `@deepseek-ai/dsh-tool-subagent` 配置行移除 `modelSelectionSettings`：

   ```yaml
   - name: '@deepseek-ai/dsh-tool-subagent'
     config:
       provider: fork
       toolName: subagent_fork
   ```

2. 如需让模型选择子级路由，请改为在每个工具作用域中的一个 spawn 类配置行上设置 `modelSelectionSettings: true`。
3. 启动组合，确认它能加载，且 fork 工具的 schema 只列出 `cwd`、`description` 和 `prompt`。
