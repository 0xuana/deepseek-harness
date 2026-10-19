---
description: "Application-scoped original-image transfers and transient drag failure feedback."
kind: package-reference
---

# @deepseek-ai/dsh-client-ui-image-drag

English | [中文](README.zh.md)

## Summary

Users can drag original images from conversations or the sidebar into the composer, or into other applications through Desktop. Drag failures remain visible after the originating image or panel closes. Transfers between browser windows remain subject to browser capabilities.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Web application profile includes this plugin. Custom compositions load it alongside the slot renderer and a shell declaring `shell.overlay`. Consumer plugins declare the `imageDrag` service injection and pass `ctx.imageDrag.actions` through their entry’s inject face to `DraggableImage` or `MarkdownDelegate.fileImages.imageDrag`. Drop targets receive `ctx.imageDrag.read` as a callback. Components do not read a service or React context.

The service retains one original `File` for the current browser drag. A random token in `application/x-dsh-image` resolves only in the application instance that created it. Source unmount does not invalidate an in-flight transfer. Drag end or plugin disposal clears the retained file. Unknown tokens return no file.

Localized failures are reported through the injected actions. The plugin’s overlay outlives the image or panel that initiated the gesture; each report restarts the Toast lifetime. Plugin disposal removes the overlay and its window listener. The desktop bridge is resolved once during activation and used only for supported protocol version 1.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Cordis plugin owns transfer bytes and a snapshot source for transient feedback. The renderer binds only the feedback source to its overlay; image consumers receive stable callbacks and subscribe to no global drag state. [DraggableImage](../ui-primitives/README.md) owns per-image preparation and gesture cancellation; [Desktop](../../../apps/desktop/README.md) owns temporary native files.

</details>

<a id="model-experience"></a>
## Model Experience

None, as this plugin changes browser interaction without adding model-visible messages or tools.

#### KV Cache effect

None; this plugin neither constructs nor sends model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Browser tokens do not transfer between applications, windows, or tabs. External browser file delivery depends on Chromium `DownloadURL` and the receiving application; Desktop supplies native file delivery. Unreadable cross-origin images retain browser-native dragging.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
