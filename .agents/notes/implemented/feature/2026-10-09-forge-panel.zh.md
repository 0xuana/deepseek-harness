# Agent Note: 变更请求面板与 worktree Session

Status: implemented

[English](2026-10-09-forge-panel.md) | 中文

## Problem

[Session 变更请求绑定](2026-10-09-session-change-request-bindings.zh.md)为每个 Session 提供了变更请求列表，但没有地方展示。让 agent 开变更请求的用户需要在不离开对话的情况下看到它们的检查、评审与能否合并，也希望新 Session 的修改和提交不影响当前检出。Git 必须在 Session 命令运行的地方执行，这可能是远程或受限的执行环境；检查不能改动仓库，而且 worktree 必须在模型第一次动作之前就存在。

## Decision

[`dsh-experimental-client-ui-forge`](../../../../packages/experimental/client-ui-forge/README.zh.md) 是一个双端包。宿主端的 `forgePanel` Remote 把面板为一个 Session 展示的全部内容组装成一条流式状态；forge 注册表与绑定服务只保留各自的领域操作。客户端包括一个右侧边栏标签页、一个显示或隐藏它的 Session 标题栏按钮、一个标题栏分支标签、一个新会话选项、一张位于输入框上方的创建卡片，以及一个 toast。所有界面都把已绑定的条目称为变更请求（forge 注册表的术语），不随代码托管平台的叫法变化。[forge 套件](../../../../packages/experimental/forge-bundle/README.zh.md)把面板、forge 注册表、GitHub 提供方、绑定服务与一个隔离的 worktree 服务作为插件页中默认禁用的一个条目发布。

Remote 通过 Session 的子进程提供方、在 Session 的只读沙箱策略下检查检出，因此它读到的与 Session 命令看到的相同，且无法写入。检查只读取 ref 与配置：顶层目录、Git 目录与公共 Git 目录、分支或缩写的 HEAD 提交、上游与远端。它在 Session 被关注时、每个 `working-directory/change`、`tool/result` 与 `sandbox/mode` 事件之后以及刷新时运行，一次只运行一个，最多再追加一次。

状态轮询跟随面板订阅：只有该 Session 的某个界面挂载时才监听其绑定，注册表停止轮询无人监听的变更请求。每张卡片保留最近一次轮询得到的快照，因此短暂的失败不会让标题与编号消失。Session 只有一个打开的变更请求时，它的卡片默认展开；有多个时全部折叠；用户第一次展开或收起卡片后，以用户的选择为准。

新 Session 通过请求而不是立即创建来以 worktree 开始。勾选新会话那一行中的选项（一个 `conversation.hero.options` 条目）会追加一条带基准分支的 `plugin:client-ui-forge/worktree` 记录；更换基准或取消勾选会再追加一条；用户发送之前不会改动仓库。只有创建能够成功时才提供该选项：在 `workspace-write` 下，检出及其公共 Git 目录必须位于可写根之内，这排除了本身就是链接 worktree 的项目。worktree 必须在第一条消息进入 Session 之前就存在，这样消息才会在其中运行，停止创建时消息也不会进入：面板在 [`agent-controller/admission` 阶段](../architecture/2026-10-17-agent-controller-message-delivery.zh.md)上的监听器暂留第一条消息，同时以 Agent 维护任务创建并进入 worktree，之后再放行消息；此期间新会话页的输入框把消息显示为正在发送。创建的阶段以流的形式推送给输入框上方的卡片，卡片上的“取消”停止创建并让消息回到可编辑状态。失败时消息同样回到可编辑状态，卡片保留失败信息：再次发送会用新分支名开始新的尝试，“不使用工作树”撤回请求。一个 `agent/pre-step` 监听器仍会在请求未完成的 Session 的第一个步骤提议中创建 worktree，因为其他发送方不经过接纳就能把消息交给 Agent；它把工作目录通知移入本步提议的消息，失败时这一轮结束。`forgeWorktree` 投影忽略第一个 `turn/start` 之后的请求以及第一个 `step/start` 之后的创建，因此运行中的 Session 永远不会移动。Session 标题栏显示 Session 所在的分支。

Session 所在的 worktree 可能在 Session 之外被删除。每次检查都会确认所创建 worktree 的目录是否还在；在 worktree 中工作的 Session 的每条消息在接纳时也会再确认一次，目录缺失时拒绝消息，让它留在输入框里。“恢复”在记录的目录重新检出分支；分支也已删除时，在其基准提交重新创建分支。“在项目目录继续”把 Session 移回源检出。

面板不再在现有 worktree 之间移动 Session。移除变更请求会追加一条 `dismiss` 记录，它的 toast 通过 `track` 提供“撤销”。

## Deferred

在左侧导航“插件”“自动化任务”旁边新增代码审查页、列出用户在所选提供方上的 pull request 或 merge request，这项工作推迟。它的接入不需要改动本包面向 Session 的界面：

- **提供方能力**——`ForgeProvider` 增加一个可选方法，例如 `listForViewer(host, filter, signal)`，返回变更请求引用；GitHub 用 `gh search prs --author @me` 或 GraphQL `viewer` 实现，注册表汇总已启用的提供方。
- **Remote**——一条类似 `follow` 的流，以提供方与筛选条件而不是 Session 为键，通过同一个 `ctx.forge.watch` 轮询。
- **客户端**——在本包中以 `sidebar.panellist` 条目加一个 `main` 页面实现（与 `ui-schedule` 相同），渲染接收变更请求、其快照与可选操作的 `ChangeRequestCard`。
- **设置**——在套件的配置页中选择提供方与主机。

## Alternatives considered

**按平台使用不同名称。** 在 GitHub 上称 pull request、在 GitLab 上称 merge request，需要每个提供方声明自己的名称，所有文案也要随之变化；而 GitHub 是唯一的提供方，统一的术语让文案保持不变。

**为 Git 检查单独建一个宿主服务包。** 目前没有第二个使用方需要检出信息；出现模型工具时，可以再把它们移入共享服务。

**以宿主进程运行 Git。** 远程与受限的执行环境会显示宿主的文件而不是 Session 的文件，宿主还会读取 Session 无法读取的目录。

**勾选时立即创建 worktree。** 每次切换勾选或更换基准都会创建并丢弃一个检出，而且用户决定发送之前 Session 就已经移动。

**在创建 Session 的请求中携带该选项。** 这个请求由 Session 控制器拥有，字段是封闭的；插件记录让选项留在本包之内，并且在空白 Session 重新加载后仍然保留。

**在面板中切换现有 worktree。** 切换后的 Session 仍保留其项目的沙箱根，因此项目之外的 worktree 依然只读；对话中途移动还会让模型对文件的认识前后割裂。让 Session 从一开始就在自己的 worktree 中运行可以同时避免这两点。

**把选项放在输入框工具栏。** 发出第一条消息后工具栏依然存在，而那时该选项已不再适用；新会话那一行在 Session 开始后就会消失。那一行原先只提供单值 slot，因此 `ui-conversation` 增加了列表型 slot `conversation.hero.options`。

**在第一轮之内创建 worktree。** 第一个步骤提议运行时，消息已经被接收，取消只能丢弃它或把它放回队列，新会话页也已经离开。在 pre-step 中抛出的错误还会丢弃已认领的消息。

**在消息到达时用维护任务创建 worktree。** 消息会停在队列里，输入框也已经被清空；在接纳阶段暂留消息可以让它在 worktree 建好之前留在输入框里。

**在 Web 输入框里设发送闸门。** 浏览器在宿主看到消息之前就拦住它，因此每次检查都要一次 Remote 调用，被拒绝消息的阶段只存在于浏览器中，其他发送方也会绕过它。接纳阶段在消息进入 Agent 的位置暂留它，并把失败保留在面板状态中。

**把创建卡片放进对话记录。** 对话记录的节点不接受插件定义的类型；输入框上方的停靠区是最近的列表型 slot，而且它在新会话页也会渲染。

**Session 行悬停分区与手动粘贴 URL 跟踪。** 二者都与标签页重复。绑定来自 `gh pr create` 与推送，`track` 保留给“撤销”使用。

## Consequences

面板只在打开时显示当前状态；没有任何界面挂载时检查结束不会有通知。Session 之外的改动要等到刷新或下一个工具结果才会出现。每次检查最多在 Session 的执行环境中启动七个短暂的 Git 进程。只有在第一步之前提出请求的 Session 才会有 worktree，失败或被取消的尝试可能留下它的分支或检出。目前只有 Web Session Remote 接纳消息；其他发送方在第一轮之内创建 worktree，也会向已删除的 worktree 发送消息。恢复会丢失从未提交的修改。同时启用 Git Worktrees 时会存在两个互不影响的 worktree 服务；模型的工具看不到面板的服务。
