---
kind: upgrade-guide
description: 文件引用指导从 Web UI 插件移至共用的提示行。
---

# 桌面文件引用提示组合

[English](guide.md) | 中文

## 变更

Web bundle 现在以 `deliverable-file-references` 行挂载 `@deepseek-ai/dsh-tool-present/prompt`。此前该指导由 `@deepseek-ai/dsh-client-ui-deliverables` 注册。默认 Web 行为不变；自定义组合以及禁用 UI 行的补丁需要单独处理提示。

## 迁移

1. 自定义组合若直接挂载 `dsh-client-ui-deliverables`，增加一个名为 `@deepseek-ai/dsh-tool-present/prompt` 的行以保留指导。
2. 如需在 Web profile 中同时隐藏文件卡片与指导，禁用 `ui-deliverables` 和 `deliverable-file-references` 两行。
3. 检查组装后的 system prompt，确认 `ui:deliverable-file-references` 按预期存在或缺失。
