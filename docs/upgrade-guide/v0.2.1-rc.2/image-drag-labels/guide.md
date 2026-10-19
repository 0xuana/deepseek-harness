---
kind: upgrade-guide
description: "Custom image UI consumers must supply a localized drag failure label."
---

# Image drag labels

English | [中文](guide.zh.md)

## Change

`MessageImageLabels` from `@deepseek-ai/dsh-client-ui-conversation/client` and `MarkdownDelegate.fileImages.labels` from `@deepseek-ai/dsh-client-ui-primitives` now require `dragFailed: string`. Custom plugins that construct either labels object must add this field to compile. The message reports an unsuccessful original-image drag and tells the user to retry.

## Migration

1. Add `dragFailed` to custom `MessageImageLabels` and `MarkdownDelegateProvider.fileImages.labels` objects.
2. Resolve the text through the plugin's locale dictionary, for example “Drag failed. Try again.” or “拖放失败，请重试”.
3. If a custom application shell renders managed image components or `MarkdownDelegateProvider.fileImages`, wrap that tree in `ImageDragProvider` from `@deepseek-ai/dsh-client-ui-primitives`. The standard application shell already supplies it; missing providers fail during rendering.
4. Rebuild the plugin and confirm that an unsuccessful image drag displays the localized message. Existing desktop, chat, and conversation consumers already supply the field.
