---
kind: upgrade-guide
description: "Claude Code 模组桥接在初始化时要求会话投影注册表。"
---

# 为 Claude Code 模组组合会话投影

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-experimental-claude-code-mods` 需要 `sessionProjections` 才能初始化。未提供此服务的自定义组合不再启动桥接。桥接在服务模组前注册轮次和上下文压力投影。

## 迁移

1. 在组合桥接的 `cordis.yml` 或配置覆盖文件中添加 `@deepseek-ai/dsh-session-projection`；已组合此服务时无需重复添加。
2. 启动配置，确认桥接及其模组插件成功加载。
