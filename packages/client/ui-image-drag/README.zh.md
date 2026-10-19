---
description: "应用作用域内的原图传递与临时拖放失败反馈。"
kind: package-reference
---

# @deepseek-ai/dsh-client-ui-image-drag

[English](README.md) | 中文

## 概述

用户可以把会话或侧栏中的原图拖回输入框，也可以通过桌面端拖到其他应用。图片或面板关闭后，拖放失败提示仍然可见。浏览器跨窗口传递受浏览器能力限制。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

Web 应用 profile 包含该插件。自定义组合需要同时加载插槽渲染器，以及声明 `shell.overlay` 的外壳。消费插件声明 `imageDrag` 服务依赖，通过入口的注入接口将 `ctx.imageDrag.actions` 传给 `DraggableImage` 或 `MarkdownDelegate.fileImages.imageDrag`。接收方通过回调获取 `ctx.imageDrag.read`。组件不读取服务或 React context。

服务为当前浏览器拖放保留一个原始 `File`。`application/x-dsh-image` 中的随机令牌仅能由创建它的应用实例解析。源组件卸载不会使进行中的传递失效。拖放结束或插件卸载会清除保留的文件。未知令牌不返回文件。

本地化失败提示通过注入回调报告。插件的覆盖层比发起手势的图片或面板存活更久，每次报告都会重新开始 Toast 的展示周期。插件卸载会移除覆盖层和窗口监听器。桌面桥接在插件激活时解析一次，仅使用受支持的协议版本 1。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节</summary>

Cordis 插件持有传递字节和临时反馈的快照源。渲染器只为覆盖层绑定反馈源；图片消费方接收稳定回调，不订阅全局拖放状态。[DraggableImage](../ui-primitives/README.zh.md) 负责单张图片的准备与手势取消，[Desktop](../../../apps/desktop/README.zh.md) 负责原生临时文件。

</details>

<a id="model-experience"></a>
## 模型体验

无；该插件只改变浏览器交互，不增加模型可见消息或工具。

#### KV Cache effect

无；该插件既不构建也不发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 浏览器令牌不能跨应用、窗口或标签页传递。浏览器向外部交付文件依赖 Chromium 的 `DownloadURL` 和接收应用；Desktop 提供原生文件交付。不可读取的跨域图片保留浏览器原生拖动。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
