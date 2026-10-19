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
3. Load `@deepseek-ai/dsh-client-ui-image-drag` in custom compositions and declare `shell.overlay`. Consumers declare the `imageDrag` service dependency, inject `ctx.imageDrag.actions` into image entries, and supply it as `MarkdownDelegateProvider.fileImages.imageDrag` or `DraggableImage.imageDrag`.
4. Custom replacements for the `conversation.images.content` Factory add `inject: () => ({ imageDrag: ctx.imageDrag.actions })`. Its declaration now requires these callbacks; render callers still pass only image data, the loader, and labels.
5. Rebuild and verify original-image drops and localized drag failures. No React Provider or application-shell wrapper is required.
