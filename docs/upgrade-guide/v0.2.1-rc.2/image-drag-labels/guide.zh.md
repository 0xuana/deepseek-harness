---
kind: upgrade-guide
description: "自定义图片 UI 消费方必须提供本地化拖放失败文案。"
---

# 图片拖放文案

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-client-ui-conversation/client` 的 `MessageImageLabels` 和 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownDelegate.fileImages.labels` 现在要求 `dragFailed: string`。自定义插件若构造这两类 labels 对象，需要补充该字段才能编译。该文案报告原图拖放失败，并提示用户重试。

## 迁移

1. 为自定义 `MessageImageLabels` 和 `MarkdownDelegateProvider.fileImages.labels` 对象补充 `dragFailed`。
2. 通过插件的 locale 字典解析文案，例如“拖放失败，请重试”或“Drag failed. Try again.”。
3. 如果自定义应用外壳渲染受管理的图片组件或 `MarkdownDelegateProvider.fileImages`，用 `@deepseek-ai/dsh-client-ui-primitives` 的 `ImageDragProvider` 包裹组件树。标准应用外壳已提供它；缺少 Provider 会在渲染时报错。
4. 重新构建插件，确认图片拖放失败时显示本地化提示。现有桌面端、Chat 和 Conversation 消费方已提供该字段。
