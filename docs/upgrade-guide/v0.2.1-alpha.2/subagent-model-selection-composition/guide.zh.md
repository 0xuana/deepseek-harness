---
kind: upgrade-guide
description: 自定义 subagent 组合必须分离路由字段、模型发现和 Session 授权。
---

# 分离 subagent 模型选择配置

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-tool-subagent` 将 `modelSelectionSettings` 替换为 `modelSelection`，该选项只控制可选子级路由字段。工具不再注册 `list_subagent_models` 或采样用户设置。Host 的 `/model-selection-settings` 服务在 Agent 创建时记录授权，包括在委派工具挂载前创建的 Session。已有 Session 保留已记录策略；之后安装工具不会重新采样设置。随附 Web 与 Desktop preset 包含独立发现插件，并为 fork 保持路由字段关闭。自定义 fork 工具可以启用这些字段。

## 迁移

1. 在自定义 `cordis.yml`、patch 或直接插件配置中，将公开路由参数的委派工具的 `modelSelectionSettings: true` 改为 `modelSelection: true`。
2. 在每个需要发现的工具作用域中，添加独立的 `@deepseek-ai/dsh-tool-subagent/list-models` 配置行。多个委派工具可以共用它。
3. 在创建 Agent 前，将 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 挂载到 Host。它需要 `sessions` 和 `sessionProjections` 服务。直接调用 `apply(ctx, config)` 时不再传入 Session 参数。
4. 创建一个新 Session，确认用户偏好启用时发现结果为授权路由，否则仅为父 Agent 当前路由。确认即使未先调用发现工具，显式选择未授权路由的委派仍会失败。
