---
kind: upgrade-guide
description: 子智能体发现插件改由共享的 subagent-control 入口提供。
---

# 统一挂载子智能体控制工具

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-tool-subagent-control` 一起注册 `send_message`、`interrupt_agent`、`list_agents` 和 `list_subagent_models`。独立的 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 与 `@deepseek-ai/dsh-tool-subagent/list-models` 导出已移除。共享插件要求 `tools`、`subagents`、`agents` 和 `sessionProjections`；`llm` 不可用时，模型查询会报告错误。

随附 headless、SDK 和 ACP profile 现在通过共享控制插件包含模型查询。工具存在不会授予模型选择权限：查询仍使用调用 Session 已记录的策略，没有策略时只允许当前父级路由。Web 与 Desktop 保留其模型选择设置和委派默认值。

## 迁移

1. 将自定义 `cordis.yml` 和 patch 中独立的发现配置行替换为每个工具作用域一条 `@deepseek-ai/dsh-tool-subagent-control`。已有该配置行时，删除重复的发现配置行。直接使用插件的调用方只挂载一次主入口。
2. 移除针对已停用的 `tool-subagent-list-agents` 和 `tool-subagent-list-models` 行 ID 的 patch。禁用 `tool-subagent-control` 现在会禁用全部四个工具；若只需隐藏部分工具，使用现有工具限制。
3. 在挂载共享插件前提供其所需服务。自定义组合需要用户授权其他路由时，保留 Host 的 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 服务。
4. 验证调用 Agent 对四个工具各看到一份定义，并确认 `list_subagent_models` 只返回 Session 已授权的路由或其当前父级路由。
