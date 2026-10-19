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
3. 自定义组合加载 `@deepseek-ai/dsh-client-ui-image-drag`，并声明 `shell.overlay`。消费插件声明 `imageDrag` 服务依赖，将 `ctx.imageDrag.actions` 注入到图片入口，并作为 `MarkdownDelegateProvider.fileImages.imageDrag` 或 `DraggableImage.imageDrag` 提供。
4. 替换 `conversation.images.content` Factory 时，增加 `inject: () => ({ imageDrag: ctx.imageDrag.actions })`。该 Factory 的声明现在要求这组回调；渲染调用方仍只传图片数据、加载函数和文案。
5. 重新构建插件，确认原图拖回输入框及拖放失败提示正常。无需增加 React Provider，应用外壳保持原有结构。
