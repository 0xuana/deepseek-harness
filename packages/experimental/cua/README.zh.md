---
description: "复用 Computer Use 应用和窗口对象，通过已授权并记录日志的平台操作完成任务。"
kind: "package-library"
---

# @deepseek-ai/dsh-cua

[English](README.md) | 中文

## 概述

检查应用、跨 PTC 调用保留窗口对象，并通过正常工具执行链发送动作。平台提供方负责原生执行；本库负责对象 API、请求校验、应用授权和图像接纳。变量持久性由外部 PTC 运行时负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

应用授权使用 User Questions 的固定审批呈现，仍独立于会话的工具审批策略。本机图标用于授权提示和权限页展示，不进入保存的身份信息或模型结果。系统权限、持久授权与拒绝记录、图标分别查询，各项结果返回后即可显示。

-----

<a id="use-this-package"></a>
## 使用本包

挂载 [macOS 提供方](../cua-macos/README.zh.md)以启用原生操作。外部 PTC 宿主从 `@deepseek-ai/dsh-cua/bridge` 导入 `connectCua`，并提供当前 `tools.cua` 绑定。源码组合与原生组件准备由提供方负责。

单窗口任务直接使用 App 方法。`getApp` 读取初始辅助功能状态；需要指定窗口时使用 `getWindows` 和 `getWindow`。重新读取一个应用或窗口范围会替换其中的元素编号，不使其他窗口的快照失效。键盘输入跟随应用焦点。请求参数校验失败时，在分派前返回包含方法、参数和要求的可读消息。

观察方法会输出并返回结果。使用 `void await app.getAXState()` 只展示一份内容，或使用 `emit:false` 后打印一次返回文本。截图返回包含 `bytes`、`mimeType`、`pixelWidth`、`pixelHeight` 和 `windowId` 的 `CuaScreenshot`，图片输出回调接收同一个对象。选择文件后缀或声明图片时使用其中的 MIME 类型；格式可能是 PNG、JPEG、WebP 或 GIF。每张截图只进入一次附件处理链；`emit:false` 只抑制对象层的输出。

`tools.cua` 直接返回操作结果。截图结果保留图片 Base64，并增加供工具渲染使用的持久 `attachment` 引用；模型内容只包含坐标元数据和一张图片，不包含编码字节。截图前要求附件服务可用，并确认当前模型支持图片输入。图片接入或保存失败会拒绝调用。对象桥接保留截图字节和已校验的元数据，不重复上传或输出同一张图片。

应用授权发生在启动、观察、截图和输入之前。会话许可按对话和应用身份持久化，重启 DSH 或关闭 Computer Use 后仍可复用，其他对话需要单独授权。长期许可要求平台验证可执行文件身份。拒绝或撤销会关闭受影响的 Agent 连接，因此旧对象必须重新选择目标。取消、超时或重新连接后均不重放输入。

动作返回 `dispatched:true, verified:false`；请读取新状态以验证结果。坐标操作默认使用最近返回截图中的像素；成功观察窗口后，传入 `relative: true` 可使用 0～1000 的整数比例。Host 在返回截图前解析附件归一化和当前模型的图片缩放规则，再将输入换算为原生窗口 point。窗口尺寸变化会使截图映射失效，绝对坐标遇到 `SCREENSHOT_REQUIRED` 时需要重新截图。窗口缩放后以 `WINDOW_CHANGED` 拒绝旧坐标；单纯移动窗口不改变窗口内坐标。

`click(target, { holdMs: 800 })` 按住鼠标按钮 800 毫秒后松开。`holdMs` 接受非负整数，双击时应用于每次按下；0 表示按下后立即松开，不额外等待。提供方配置 `maxClickHoldMs` 限制显式按住时长，默认 5000 毫秒。指定时长后，AX 索引和坐标目标都使用鼠标事件；省略时保留普通点击行为。按住时间计入操作超时，取消或超时会松开按钮。已接收的输入无法撤销；辅助进程被强制终止时无法保证松开。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>共享执行与平台职责</summary>

[授权存储](src/permission-store.ts)复用 `storageDomain` 和配置的后端。默认 JSON 后端写入 `$DSH_HOME/storages/cua_permissions_<sha256>.json`，摘要对应 profile 的真实目录。每次授权检查在 profile 文件锁内打开并读取最新状态，随后关闭存储域；原生操作使用单独的应用锁。撤销会等待其他进程已获准执行的操作结束；撤销完成后，各进程都拒绝旧句柄。不同电脑或 PID 命名空间不能共享这把锁。

旧 `allowedApps` 只在首次访问存储时导入，迁移后不再应用。确认权限页显示正确后，可以删除旧配置。授权、拒绝和允许再次询问均持久化，页面仍不显示仅对某个会话生效的许可。没有 profile 的独立组合只保留进程内决定；有 profile 但缺少域存储的组合会拒绝授权操作。

权限 Remote 还通过 `ptcConfiguration()` 和 `enablePersistentPtc()` 支持详情页的执行方式设置。查询读取现有执行器和可编辑的 profile 条目。显式写入使用 `configEditor.edit()` 保留其他字段并按正常 Loader 规则重载；已是持久化模式的执行器保持不变。此设置独立于系统权限和应用授权。

提供方将准备好的 helper、连接工厂和指引传给 [installCua](src/index.ts)。[NativeClient](src/native-client.ts) 负责请求关联、字节上限、取消确认和失败处理。平台连接器负责启动和连接清理。共享执行器为每个 Agent 保留一个连接，并在销毁时等待进行中的图像写入。

`agentPreset` 默认为 `ptc`，将工具和指引限制到绑定该 preset 的 Agent。提供方使用现有 `agent/created`、`agent-preset/selected` 事件及 Agent 拥有的作用域，也处理启用前已存在的 Agent。提供方卸载和 Agent 销毁都会释放这些注册。preset 定义可以晚于提供方注册；名称用于筛选已绑定的 Agent，在匹配的 Agent 出现前不提供工具。不使用 preset 的独立组合可设置 `agentPreset: false` 来全局注册。Host 仍拥有权限、本机连接和取消操作，preset 定义保持不变。

[操作 schema](src/protocol.ts) 定义模型参数，并单独声明 Host 专用字段。原生实现在执行时检查目标身份、窗口几何、资源上限和操作系统访问条件。授权存储独立于原生协议保存持久许可。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [macOS 提供方](../cua-macos/README.zh.md)
- [对象接口](src/types.ts)
- [授权存储迁移](../../../docs/upgrade-guide/v0.2.1-rc.2/cua-consent-storage/guide.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 已授权的应用操作

#### 模型可见内容

平台提供方挂载共享的 `cua` 工具并提供操作指引。调用和观察使用同一套应用与窗口接口，进入正常 Session 历史。平台指引见 [macOS 提供方](../cua-macos/README.zh.md#model-experience)。

#### Token 影响

操作结果和接纳的图像增加模型输入。保留的 JavaScript 对象不会序列化进提示词。调用方重复打印会重复观察文本。

#### KV Cache 影响

结果追加到历史。保留对象不重写已有消息；更改挂载的工具或指引可能改变请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 会话决定没有自动保留期限，也不会随对话删除而自动清理。撤销会移除许可，但保留撤销代次，用于拒绝旧句柄和先前尚未完成的审批。
- 当前原生执行使用 macOS 提供方。Windows 支持计划使用独立的提供方包和 C# helper，保留共享应用与窗口 API、授权、快照有效性和动作结果语义。实现须说明系统特有的限制，并区分交叉编译证据和 Windows 桌面验证。
- 持久变量不会在一组连续操作期间独占应用。其他 Agent 和用户可能改变其状态。 悬停和观察不恢复先前的鼠标位置；[连续交互](../../../.agents/notes/implemented/architecture/2026-10-13-cua-continuous-hover.zh.md)不分配跨调用所有权。
- 本包保留在 `experimental`，Windows 支持和平台验证完成后可迁至 `computer-use` 组。

-----

<a id="dev-note"></a>
### 开发备注

无。
