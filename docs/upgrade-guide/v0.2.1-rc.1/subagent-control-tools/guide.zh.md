---
kind: upgrade-guide
description: 子智能体发现功能的子路径插件改由各包主入口提供。
---

# 通过主入口配置子智能体发现功能

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-tool-subagent-control` 一起注册 `send_message`、`interrupt_agent` 和 `list_agents`，要求 `tools`、`subagents` 和 `agents`。`@deepseek-ai/dsh-tool-subagent` 在新增选项 `modelDiscovery` 为 true 时注册 `list_subagent_models`；该选项独立于 `modelSelection`，默认 false。独立的 `/list-agents` 和 `/list-models` 导出已移除。

Web 与 Desktop preset 在 spawn 实例上启用发现。headless、SDK 和 ACP profile 默认保持发现关闭。发现仍读取调用 Session 的授权，并在 `llm` 不可用时报告错误。它随配置该选项的插件实例存续，与委派提供方无关；卸载该实例会移除发现，即使其他委派实例仍然存在。

## 迁移

1. 将 `/list-agents` 配置行替换为每个工具作用域一条 `@deepseek-ai/dsh-tool-subagent-control`，已有该行时则删除它们。禁用共享行现在会禁用全部三个控制工具；使用工具限制隐藏单个工具。
2. 将每条 `/list-models` 配置行改为在同一工具作用域的一个 `@deepseek-ai/dsh-tool-subagent` 实例上设置 `modelDiscovery: true`。同一作用域的多个发现工具所有者会注册失败。仅在需要接受模型选择参数的实例上保持 `modelSelection` 启用。
3. 移除针对已停用发现行 ID 的 patch，并将直接使用插件的调用方迁移到主入口。自定义组合需要用户授权其他路由时，保留 Host 的 `/model-selection-settings` 服务。
4. 验证所需工具各有一份定义，发现工具随其所属实例卸载而移除，以及保持发现关闭的组合中工具 schema 不变。
