---
description: "检查 macOS Computer Use 权限并撤销应用访问权限。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cua

[English](README.md) | 中文

## 概述

在插件页打开 Computer Use，可以检查辅助功能和屏幕录制权限、申请缺失的系统权限，并撤销应用授权。用户显式启用时会检查权限，可能启动专用原生 helper。缺少权限时显示设置引导，查询失败时引导用户到详情页查看原因并重试。系统授权仍由用户决定。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

权限页列表显示本机图标与应用名称，悬停可查看路径。图标仅用于展示，不随授权保存。应用授权沿用现有 User Questions 界面，提供本会话允许和拒绝；应用签名可验证且配置可写时，还提供始终允许。

-----

<a id="use-this-package"></a>
## 使用本包

[Computer Use 组合](../cua-bundle/README.zh.md)将本页与原生 provider 一起挂载。“给 Computer Use 授权”把新会话默认模式、辅助功能和屏幕录制放在同一个边框内，三排之间使用分隔线。两条系统权限要求在能识别责任应用时，把该应用的 `.app` 包名称和图标放在同一个标签中。“管理 Computer Use 可访问的应用”使用独立边框包住应用列表。点击“申请权限”，在 macOS 权限列表中找到该应用并开启对应开关；若 macOS 显示其他名称，以系统提示为准。来源无法识别时，页面引导用户查找系统提示的应用。“打开系统设置”会打开对应的隐私设置页。进入详情页、返回窗口或完成授权操作后会自动刷新；查询失败时可点击“重试”。若系统要求退出并重新打开应用，请按提示操作并重新启动 DSH。

系统权限操作作用于运行 DSH 的电脑。远程访问时，请在该电脑上完成授权。

从插件列表启用后，系统权限尚未就绪时会显示设置引导，提供“稍后”和“前往设置”。从详情页启用后直接显示权限控件。详情页的“新会话默认模式”提供“设为 PTC”按钮，仅点击此按钮才保存默认值。已有会话保留原 preset。

页面展示“始终允许的应用”和“不允许访问的应用”。后者汇总任一会话的拒绝记录，不取消其他会话已有的授权，也不阻止新会话询问授权。会话授权仍在对应会话中生效，详情页不展示这类应用。“撤销”会移除对应应用的访问许可并取消相关操作。已发送到应用的输入无法撤回，继续操作前需重新观察应用。“允许再次询问”清除该应用在所有会话中的拒绝记录；下次选择应用时仍需用户重新决定。

本插件没有配置字段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

可选浏览器插件挂载原生 provider 的权限 Remote，复用插件页的启用引导和配置插槽。三排使用条件始终可见，未加载的字段保留占位。默认模式、系统权限、应用列表和应用图标分别查询，结果返回后各自显示。应用名称和操作按钮不等待图标，图标位置保留空位。用户操作按顺序执行，不等待尚未完成的查询；卸载时等待操作和查询全部结束，再释放独立持有的 Remote 挂载。查询错误只显示在对应部分，启用引导只等待系统权限结果。卸载后的迟到结果会被丢弃。一个控制器把查询结果投影到页面和设置弹窗；重新连接或 Host 返回的配置 namespace 更新时刷新状态。操作提示挂载到 shell overlay，关闭页面后仍可显示。provider 负责权限检查、持久授权和取消；浏览器不保存授权决定。

详情页通过现有 `configForms` 服务读取实际默认值（`selectedDefault ?? default`）。按钮仅写入 `selectedDefault`，沿用表单带版本检查的设置写入流程。设置仍在加载、只读或不可用时不能提交；写入失败时在设置旁显示错误，供用户重试。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [原生 provider](../cua/README.zh.md)：可执行文件身份和操作检查。
- [插件管理](../../client/ui-plugin-manager/README.zh.md)：启用引导和页面插槽。
- [界面基础组件](../../client/ui-primitives/README.zh.md)：共用弹窗、按钮和提示。

-----

<a id="model-experience"></a>
## 模型体验

无。本包注册浏览器控件，不注册模型工具或提示词段落。

#### KV 缓存影响

无。模型可见的指引和操作结果由原生 provider 负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这套 CUA 专用界面随 Windows 支持一起开发，暂放在 `experimental`；转为正式功能后迁回 `client` 组的 `ui-cua`。

- 系统权限变更后，macOS 可能要求重启启动程序。申请尚未完成时，不能视为已授权。
- 应用归属依赖可选的本机系统查询和可读取的应用信息；不可用时，页面使用通用指引，让用户按系统弹窗完成授权。桌面安装包的分发和权限归属留待后续处理。
- 不提供 invariant companion：本界面投影 provider 查询，不独立保存授权决定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作记录</summary>

无。

</details>
