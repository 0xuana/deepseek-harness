---
description: "展示 Session 创建的 pull request、并让新 Session 以 worktree 开始的 GUI 面板，以及为它们提供数据的宿主 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-forge

[English](README.md) | 中文

## 概述

这个可选的双端包展示 Session 创建或推送的 pull request，并让新 Session 在自己的 Git worktree 中开始。宿主端是 `forgePanel` Remote：它以只读方式检查 Session 的检出、识别代码托管平台、检查登录状态，以流的形式推送 Session 的[已绑定变更请求](../forge-session/README.zh.md)及其轮询状态，并在 Session 的第一条消息于 Agent 接纳阶段等待时创建所请求的 worktree。客户端增加一个右侧边栏标签页、Session 标题栏中的一个按钮与分支标签、一个新会话选项、输入框上方的创建卡片，以及报告操作结果的 toast 提示。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在插件页启用 [forge 套件](../forge-bundle/README.zh.md)；它把本包与 forge 注册表、GitHub 提供方、Session 绑定以及它自己的 [worktree 服务](../worktree/README.zh.md)组合在一起。

- **工作树选项**——在新会话页面上，“工作树”位于工作区与模式选择器那一行的右端。勾选后显示基准分支，默认为当前分支；菜单列出最近的本地分支。不在 Git 检出中、Session 为只读，或检出及其 Git 目录不在 Session 的可写根内（例如项目本身就是链接 worktree）时，该选项不可用，提示中说明原因。发送第一条消息后，消息以“正在发送”的状态留在新会话页的输入框里，同时从基准分支在仓库的 `.agents/worktrees/` 下创建分支 `dsh-<Session id 前 8 位十六进制数>-<4 位随机十六进制数>`，并把它的检出设为 Session 的工作目录；worktree 建好后宿主才接收这条消息。
- **创建卡片**——创建 worktree 期间，输入框上方的卡片显示它的分支以及“准备工作空间”“检出文件”两个步骤；“更多详情”会列出分支与基准。“取消”停止创建，让消息回到可编辑状态，勾选保留。某次尝试失败时，消息回到可编辑状态，卡片显示原因：再次发送消息即换一个新分支名重试；“不使用工作树”撤回请求，下一次发送就在当前检出中进行。
- **分支标签**——Session 标题栏显示 Session 所在的分支；它的提示说明所在的 worktree 及其基准，或当前检出。
- **工作树已被删除**——Session 所在的 worktree 在 Session 之外被删除后，输入框上方的卡片会说明这一点；在恢复或离开该 worktree 之前，宿主会把每条消息退回输入框。“恢复工作树”在原目录重新检出该分支；分支也已删除时，从它开始时的提交重新创建分支。“在项目目录继续”把 Session 移回源检出。此期间分支标签显示警示色。
- **标题栏按钮**——Session 有已绑定的 pull request、或其目录位于 Git 检出中时出现，用来显示或隐藏标签页。打开状态的 pull request 存在检查失败、被要求修改或冲突时，按钮带红点。
- **标签页**——顶部一行说明 Session 开始时所在的 worktree 及其基准，或当前检出的分支。其下每张 pull request 卡片显示状态图标、标题、编号、分支、改动行数、检查，以及被要求修改、冲突、草稿中最需要注意的一项；已合并或已关闭的显示发生时间。展开卡片会增加“查看 PR”与复制链接、状态与绑定方式、带耗时的检查列表、评审结论与未解决讨论数、能否合并、“添加到聊天”（把 URL 插入输入框），以及“从会话中移除 PR”，其 toast 提供“撤销”。刷新会重新检查检出与登录状态，并立即再次轮询每个 pull request。缺少登录时，横幅显示 `gh auth login` 命令。

`gitCommand`、`gitTimeoutMs`、`graceMs`、`maxOutputBytes`、`readinessTimeoutMs`、`maxBranches` 与 `worktreePrefix` 列在[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-client-ui-forge)中。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

`ForgePanelController` 为每个被关注的 Session 保留一个 `SessionPanel`，最后一个关注方离开时销毁它。面板从 Session 的工作目录与绑定开始，在每个 `working-directory/change`、`tool/result` 与 `sandbox/mode` 事件之后重新检查，每次变化都发布新的 `ForgePanelState`。每个变更请求在后续轮询失败时保留最近一次轮询得到的快照。检查一次只运行一个，最多再追加一次；Session 已离开的目录的结果会被丢弃。代码托管平台按远端顺序识别：先是上游所在的远端，然后是 `origin`，最后是其余远端。识别出的托管平台变化时以及刷新时，会在 `readinessTimeoutMs` 内检查登录状态。

检查运行 `rev-parse --show-toplevel`、`rev-parse --path-format=absolute --git-common-dir`、`symbolic-ref --short HEAD`、`rev-parse --abbrev-ref @{upstream}` 与 `remote -v`；`branches` 运行 `symbolic-ref` 与 `for-each-ref --count=<maxBranches>`。这些命令都不读取工作树。每个命令都在 Session 的只读沙箱策略下运行，禁用可选的索引写入、钩子、文件系统监视器、提示与对象的延迟获取，移除继承的 Git 选择器与携带密钥的变量，并各自受 `gitTimeoutMs` 时限与每个输出流的 `maxOutputBytes` 上限约束。Git 打印的顶层目录与公共 Git 目录经 `ctx.fs` 解析为工作目录服务记录的规范进程路径。工作树选项在 `danger-full-access` 沙箱模式下可用，在 `read-only` 下不可用，在 `workspace-write` 下只有两个目录都位于 Session 沙箱策略的规范工作区根内时才可用。

worktree 请求是一条 `plugin:client-ui-forge/worktree` 记录，由仅宿主侧的 `forgeWorktree` 投影折叠：请求与撤回在第一个 `turn/start` 或创建之前生效；在第一个 `step/start` 之前，未完成请求的第一条 `created` 记录生效。一轮开始或 worktree 已创建之后，`requestWorktree` 与 `cancelWorktree` 以 `forgePanel/session-started` 拒绝；没有 `worktrees` 服务时以 `forgePanel/worktrees-unavailable` 拒绝；分支名为空时以 `forgePanel/invalid-branch` 拒绝；两者都会忘掉失败的尝试。一个 `agent-controller/admission` 监听器在 Session 有未完成请求时暂留消息，同时以 Session 所属 Agent 的维护任务运行一次尝试，使用新分支名，因此其他客户端此时发来的消息会等它完成；它在面板状态中发布正在进行的阶段并设置 `held`，记录带源仓库根目录的 `created`，然后放行消息。失败的尝试以 `failure` 留在面板状态中，带有分支、基准、失败步骤与原因，直到下一次尝试开始或请求变更，消息则以 `forge/worktree-creation-failed` 被拒绝。`stopCreation` 与 Agent 的取消以 `forge/worktree-creation-stopped` 拒绝消息，发送方的取消原样传出。在所创建 worktree 中工作的 Session，其每条消息在 worktree 缺失时以 `forge/worktree-missing` 被拒绝；检查无法给出结果时放行。有面板跟随该 Session 时，拒绝标记为 `presented`。worktree 服务把工作目录通知排进队列，由第一步认领。一个 `agent/pre-step` 监听器在请求仍未完成的 Session 的第 1 步创建 worktree，覆盖未经接纳就进入的消息；它把通知移入本步提议的消息，失败时这一轮结束、请求保留。`restoreWorktree` 与 `continueInProject` 同样以维护任务运行。套件把它的 `worktrees` 服务隔离，因此同时启用 Git Worktrees 时会有两个互不影响的服务。`track` 以 `forgePanel/unrecognized-url` 拒绝没有提供方识别的 URL。

每次检查还会判断 worktree 是否缺失：Session 的目录位于所创建的 worktree 内，`ctx.fs.lstat` 在那里找不到目录，再由源仓库中的 `show-ref` 判断分支是否还在。

浏览器入口先挂载 Remote，再挂载界面。每个 Session 一条流，同时供给标签页、标题栏按钮、分支标签、新会话选项与创建卡片；第一个订阅方出现时打开，最后一个离开时关闭，传输重置后重新打开，并为下一个订阅方保留最后的状态。新会话选项填入 `conversation.hero.options`，worktree 卡片填入 `conversation.input.dock`，分支标签填入 `conversation.session.header.actions`。worktree 卡片显示正在进行的创建，有消息在等待时“取消”调用 `stopCreation`；或显示最近一次失败，“不使用工作树”调用 `cancelWorktree`。等待中的消息由输入框自己显示为正在发送，被拒绝的消息留在输入框里。标签页把自己是否可见报告给标题栏按钮的按下状态。toast 位于 `shell.overlay` 条目中，因此比标签页存在得更久。变更请求卡片接收变更请求、它的快照与可选操作，其他界面可以复用。

| 源码 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `forgePanel` Remote 与按 Session 的面板 |
| [`src/panel.ts`](src/panel.ts) | 面板状态、检查调度与登录检查 |
| [`src/worktree.ts`](src/worktree.ts) | worktree 记录、投影，以及在接纳阶段与第一步创建 worktree |
| [`src/git.ts`](src/git.ts) | 受限的只读 Git 命令 |
| [`src/parse.ts`](src/parse.ts) | Git 输出解析与远端顺序 |
| [`src/client/mount.ts`](src/client/mount.ts) | Remote 挂载、slot 条目与操作结果映射 |
| [`src/client/ChangeRequestCard.tsx`](src/client/ChangeRequestCard.tsx) | 可复用的变更请求卡片 |
| [`src/client/WorktreeToggle.tsx`](src/client/WorktreeToggle.tsx) | 新会话的工作树选项 |
| [`src/client/WorktreeProgress.tsx`](src/client/WorktreeProgress.tsx) | worktree 创建卡片与 worktree 缺失卡片 |
| [`src/client/BranchChip.tsx`](src/client/BranchChip.tsx) | Session 标题栏的分支标签 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [Forge 子系统](../../../docs/subsystems/forge.zh.md)——变更请求类型与服务参考。
- [Session 绑定](../forge-session/README.zh.md)——pull request 如何绑定到 Session。
- [Worktree 服务](../worktree/README.zh.md)——worktree 如何创建并进入。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由工作目录服务：它关于 Session 新 worktree 的通知会加入第一次请求的消息，“在项目目录继续”会为下一次请求排入同类通知。检查、状态、恢复与面板都不会给模型请求增加内容。

#### KV Cache 影响

新 worktree 的通知没有影响，因为它属于 Session 的第一次请求，那时还没有任何缓存前缀。“在项目目录继续”之后的通知追加在缓存前缀之后。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- **状态只在面板中轮询**——只有本包为该 Session 挂载了某个界面时才会轮询状态；都未挂载时检查结束不会有通知。
- **检查触发时机**——检出只在 Session 的工具结果与目录变化之后检查；Session 之外的改动要等到刷新或下一个工具结果才会出现。
- **只负责创建**——面板只在 Session 的第一步之前创建 worktree，从不删除或清理；失败或被取消的尝试可能留下分支或检出。分支名是随机的，不取自 Session 标题，因为那时标题还不存在。
- **不经接纳的发送方**——只有 Web Session Remote 经 agent controller 的 `agent-controller/admission` 阶段投递消息。其他发送方发出的第一条消息会直接开始这一轮，worktree 在第一步创建；发往已删除 worktree 的消息照常进入，其中的工具会因目录不存在而失败。
- **恢复**——恢复会从分支重新检出；分支也已删除时，从它开始时的提交重新创建。从未提交的修改随被删除的目录一起丢失。
- **链接 worktree 项目**——项目本身是链接 worktree 时该选项不可用：在 workspace-write 下它的 Git 目录位于可写根之外，新分支与之后的提交都无法写入。
- **代码审查页**——待办：在左侧导航中新增一个页面，列出用户在所选提供方上的 pull request；[决策笔记](../../../.agents/notes/implemented/feature/2026-10-09-forge-panel.zh.md)记录了它的接入位置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
