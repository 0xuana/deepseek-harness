---
description: "经用户明确选择后创建可持久保留、可移除的界面插件。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-creation-recommendations

[English](README.md) | 中文

## 概述

用户表达明确的界面或可复用功能愿望后，Agent 先回答，再在本轮末尾显示一张创建卡片。用户可修改建议位置，再选择创建。后台 Creator 生成一个新插件并安装到配置档案；保留用于确认继续使用，撤销则移除该插件。

## 目录

- [使用本包](#use-this-package)
- [实现原理](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开插件 → 更多 → 实验性插件，启用个性化页面。内置配置档案默认不启用此插件。启用后在插件一级页显示，关闭后仅保留在二级页。它没有配置字段。用户明确指定的位置优先；否则 Agent 根据作用范围和交互方式推荐：

| 位置 | 用途 |
|:--|:--|
| `sidebar-right` | 与 Session 关联的查看器、编辑器或 Context 检查，显示在对话右侧。 |
| `page` | 与 Session 关联的流式交互，在对话、轨迹旁新增 Tab。 |
| `sidebar-left` | 全局功能：左侧入口打开主区域独立页面，不显示对话、轨迹 Tab。 |

左侧入口和全局页面属于同一落点，也适用于全局流式工具。默认选位先区分全局与 Session；Session 内的流式对话优先使用顶部 Tab，其余查看器、编辑器放右侧栏。作用范围不清楚时先澄清，再推荐。

即使未安装或未启用插件推荐实验，个性化页面也可独立使用。发现已有插件能满足需求时，工具指引 Agent 说明它在插件页的入口，避免重复创建；同时启用插件推荐实验后，也可以通过 `suggest_plugin` 推荐该插件。两个实验共用每轮最多一张卡片的限制。

### 操作结果与恢复

创建要求当前会话是活动的根会话，并且连接有权修改配置档案。生成阶段可取消，子任务清理完毕后才能重试。安装开始后显示“正在完成安装”，等待已接纳的操作结束。关闭或离开会话不会卸载已完成的插件。重新连接后会恢复操作记录；重试之前会对照已安装插件检查中断或结果不明的创建。移除失败时保留已有记录和实际生效结果，以便重试。卸载推荐插件会停止它负责的 Creator 任务和本地后续处理。已接纳的配置变更由插件管理器负责，可能在重载后完成；重新打开会话时先检查安装状态再允许重试。已安装插件仍然保留。恢复只确认安装，不根据配置中的开启标记推断运行时已生效。

-----

<a id="understand-the-implementation"></a>
## 实现原理

<details>
<summary>实现细节 — 点击展开</summary>

Host 预留新包名，通过 `subagents` 启动已有的 `cordis` 预设，传入完整需求和选定位置。子 Agent 在父会话原工作区的 `.dsh-created-plugins/<id>` 下生成文件，保留委派时的文件权限。Host 校验包身份和仅允许新增的普通 YAML 或 JSON 补丁，将结果复制到配置档案的 `created-plugins` 目录并再次校验，再调用 `pluginManager.installBundle`；安装后的插件不依赖原工作区。补丁只能添加该新包自身且名称唯一的非分组条目；不接受自定义 YAML 标签、别名或 include。每个条目必须能解析到已构建的 JavaScript 文件。相对符号链接必须留在包内，复制时保留原目标。Session 投影保存建议和操作记录。恢复失败时仍可打开会话，卡片显示结果不明；重试必须先检查配置档案。后台完成结果写入重新打开的当前 Session 实例。并发点击合并为一次操作；工具守卫在每轮为 `suggest_view` 和 `suggest_plugin` 合计预留最多一条推荐。

Creator 收到完整方案、优先于早先位置描述的用户最终选位，以及本插件随包提供的位置指南绝对路径。指南补充 `cordis-plugin-development`，不依赖更新版预设包；Creator 按需读取注册、状态和卸载指引，再检查当前 API。卸载时应移除自己的界面和页签，保留其他内容；这是生成代码的要求，不属于静态包校验。[意图用例](tests/fixtures/intent-cases.json)用于真实模型观察，与确定性的服务测试分开。

- [源码](src/index.ts)
- [测试](tests/)

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [插件管理](../../boot/plugin-manager/README.zh.md) — 安装和移除。
- [子 Agent](../../subagent/subagent/README.zh.md) — 后台任务生命周期。
- [创建卡片](../client-ui-creation-recommendations/README.zh.md) — 位置选择与操作记录。

<a id="model-experience"></a>
## 模型体验

### 创建建议

#### 模型看到的内容

`list_creation_plugins` 只读查询随应用提供的插件名称、描述和启用状态，无需开启推荐实验或创造模式的管理工具。它是按需返回的小清单，不是所有内置功能的索引。`suggest_view` 记录标题、明确需求、相关上下文和建议位置，本身不创建插件。主 Agent 根据语义判断意图，没有关键词触发器、TODO 读取或后台扫描。指引要求在主会话只规划产品行为，将源码和 API 调研留给点击创建后的 Creator；先检查已有官方插件，调用工具，再给出一次简洁的最终回答。模糊愿望、普通一次性任务，以及明确要求只讨论的请求不应出现卡片。用户点击创建后才启动独立 Creator 会话；保留和撤销不会续跑主 Agent。

#### Token 影响

启用后增加两个工具声明。发现结果和建议追加到当前对话。只有用户接受创建后，才会产生后台 Creator 调用。

#### KV Cache effect

建议元数据追加到对话。安装生成的插件可能改变后续工具声明和缓存复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 只支持新增插件；修改已有插件和恢复旧版本留待后续。
- 意图识别依赖模型语义。生成代码使用现有 Creator 权限执行，包校验不构成代码沙箱。
- 成功、失败、取消及撤销后均保留工作区源目录和配置档案副本。撤销移除已安装插件及其界面，不删除这些文件。卡片会说明源码位于原工作区的 `.dsh-created-plugins/` 目录。历史记录不会持续跟踪手动插件变更。

- 暂不自动超时取消创建。关闭 Session 或关闭此实验会停止它负责的生成任务；已接纳的安装继续由插件管理器负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
