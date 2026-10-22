---
description: "展示 Session 创建的变更请求、并让新 Session 以 worktree 开始的 GUI 面板，以及为它们提供数据的宿主 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-forge

[English](README.md) | 中文

## 概述

这个可选的双端包展示 Session 创建或推送的变更请求及其变更，并让新 Session 在自己的 Git worktree 中开始。宿主端是 `forgePanel` Remote：它以只读方式检查 Session 的检出，检查代码托管平台的登录状态，为单个 Session 或会话列表以流的形式推送[已绑定变更请求](../forge-session/README.zh.md)及其轮询状态，读取 diff，并在第一条消息于 Agent 接纳阶段等待时创建所请求的 worktree。客户端增加一个侧边栏标签页、一个变更视图、一个标题栏按钮、一个新会话选项、一张创建卡片、会话列表中的图标，以及 toast 提示。

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
- **创建卡片**——创建 worktree 期间，输入框上方的卡片显示新分支以及“创建分支”“检出文件”两个步骤；“更多详情”会列出分支与基准。“取消”停止创建，让消息回到可编辑状态，勾选保留。某次尝试失败时，消息回到可编辑状态，卡片显示原因：再次发送消息即换一个新分支名重试；“不使用工作树”撤回请求，下一次发送就在当前检出中进行。
- **工作树已被删除**——Session 所在的 worktree 在 Session 之外被删除后，输入框上方的卡片会说明这一点；在恢复或离开该 worktree 之前，宿主会把每条消息退回输入框。“恢复工作树”（标签页中的“恢复”与之相同）在原目录重新检出该分支；分支也已删除时，从它开始时的提交重新创建分支。“在项目目录继续”把 Session 移回源检出。此期间标签页顶部一行显示警示图标。
- **标题栏按钮**——Session 有已绑定的变更请求、或其目录位于 Git 检出中时出现，用来显示或隐藏标签页。打开状态的变更请求存在检查失败、被要求修改或冲突时，按钮带红点。
- **会话列表**——Session 在面板为它创建的 worktree 中工作时，会话行的时间之后显示分支图标；另有一个图标显示它最需要关注的变更请求的状态，依次为需要处理、打开、草稿、尚未轮询、已合并、已关闭。打开中的变更请求图标保持会话行的浅色，并用圆点标出检查进行中、已通过或失败；已合并与已关闭的保留各自的状态颜色。会话行的悬浮卡片写出 worktree 分支及其起点，再列出最多三个变更请求的编号、标题、状态与检查，并说明还有多少个。重启后，下次轮询之前显示重启前已知的状态。
- **标签页**——顶部一行显示当前检出的分支（分离 HEAD 时为缩写提交），项目目录前显示目录图标、worktree 前显示分支图标，并说明检出的类型（Session 创建的 worktree 及其基准、其他 worktree 或项目目录）；它的提示给出路径，宿主主目录缩写为 `~`，旁边的按钮复制完整路径；worktree 已被删除时提供“恢复”。其下每张变更请求卡片显示状态图标、标题（点击在浏览器中打开）与编号；图标区分打开、草稿、已合并与已关闭，打开中的变更请求（草稿除外）检查失败、被要求修改或有冲突时显示为“需要处理”，与标题栏按钮的红点一致。卡片右上角还提供“在浏览器中打开”“复制变更请求链接”与“从本会话移除”，移除后的 toast 提供“撤销”。折叠的卡片还显示打开的变更请求的检查，以及被要求修改、冲突、草稿中最需要注意的一项；已合并或已关闭的则显示结束时间。展开的卡片显示源分支与目标分支，下面每项一行：打开的变更请求依次是检查（点击该行弹出检查列表，失败的排在前面，带耗时与链接）、评审结论与未解决讨论数、合并状态，已合并或已关闭的显示结束时间；最后是变更行数，点击该行打开变更视图。打开中的草稿还提供“标记为可评审”；主机现在就会合并的变更请求提供“合并”，其菜单列出仓库允许的合并方式并选中用户常用的一种，点“确认合并”后合并卡片显示的那个 head。每次操作的结果都以 toast 报告；该 head 之后有新提交时不会合并。恰好有一个已绑定的变更请求处于打开状态时，它的卡片默认展开。刷新会重新检查检出与登录状态，并立即再次轮询每个变更请求；检查与登录状态确认结束前，刷新图标持续旋转。缺少登录时，横幅显示 `gh auth login` 命令。
- **变更卡片**——`branch` 范围有文件变更、且没有以当前检出分支为源分支的打开中变更请求时，变更请求列表上方的卡片显示比较的基准（例如 `HEAD → origin/main`）以及新增、删除行数与文件数，点击打开变更视图；展开的文件列表像变更视图一样标出各个文件，点击某个文件时，变更视图定位到该文件。识别出代码托管仓库后，卡片提供“创建变更请求”：它以界面语言向 Session 发送一条用户消息，请 Agent 为这些变更创建变更请求，并以 toast 报告是否已发送。
- **变更视图**——展开的变更请求卡片上的“变更”一行与变更卡片会打开一个右侧边栏标签页，列出所有变更的文件。本地变更默认显示“分支”：工作树与未跟踪文件相对于分叉点的变更；分叉点是 Session 创建的 worktree 的基准提交，否则是 HEAD 与代码托管远端默认分支的合并基准。“未提交”与 HEAD 比较，“未暂存”与暂存区比较，“已暂存”比较暂存区与 HEAD。变更请求的视图显示托管平台在其 head 处的 diff；当前检出分支就是该变更请求的源分支时，还会说明本地分支比该 head 多出几个提交。工具栏可以跳到某个文件、汇总变更行数、刷新，并在左右对比与单栏对比、自动换行与截断长行之间切换。文件名在前，目录在后，用更小的浅色字显示，空间不够时目录先缩短；悬停时显示完整路径，重命名的文件显示新旧两条路径。每个文件带有新文件、已删除、重命名的标记（重命名标记写出原文件名，只换了目录时写出原路径），“分支”范围下的未跟踪文件还标“未提交”；文件菜单可以复制路径，本地变更可在侧边栏打开整个文件，变更请求可在浏览器中查看该文件在 head 处的页面。hunk 之间未变更的行折叠成一行，点击后从文件的新版本展开：工作树、“已暂存”时为暂存区，或经托管平台读取的 head 提交；读取 diff 之后文件又有修改时不会展开，直到视图重新读取。二进制文件与超过 `maxDiffBytes` 的未跟踪文件只显示一条说明；hunk 超过 1,000 行的文件先显示为一条写出变更行数的折叠条，点击后才绘制；前面的文件累计变更超过 5,000 行后，其后的文件默认收起。刷新与页面刷新快捷键、每次导航、变更请求的 head 变化，以及“分支”范围的摘要变化时，视图都会重新读取；变更请求的视图会先等到给出 head 的状态再读取，除非没有提供方服务它或那次轮询失败。重新读取已显示的变更时，刷新图标会旋转。托管平台或其提供方因超过大小上限拒绝给出 diff 的变更请求（例如 GitHub 上超过 300 个文件的 diff）显示“变更太大，无法在这里显示”并提供“在浏览器中查看”；其他读取失败提供“重试”，变更请求还提供“在浏览器中查看”。变更请求的 diff 在缓存期间对每个 head 提交与目标分支只下载一次，因此在同一 head 下重新打开、刷新与导航都不会再从托管平台读取。

`gitCommand`、`gitTimeoutMs`、`graceMs`、`maxOutputBytes`、`readinessTimeoutMs`、`maxBranches`、`worktreePrefix`、`maxDiffBytes`、`maxUntrackedFiles` 与 `maxCachedDiffBytes` 列在[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-client-ui-forge)中。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

`ForgePanelController` 为每个被关注的 Session 保留一个 `SessionPanel`，最后一个关注方离开时销毁它。面板从 Session 的工作目录与绑定开始，在每个 `working-directory/change`、`tool/result` 与 `sandbox/mode` 事件之后重新检查，每次变化都发布新的 `ForgePanelState`。每个变更请求在后续轮询失败时保留最近一次轮询得到的快照。检查一次只运行一个，最多再追加一次；Session 已离开的目录的结果会被丢弃。代码托管平台按远端顺序识别：先是上游所在的远端，然后是 `origin`，最后是其余远端。检查发现提供方识别的远端上有上游分支时，面板调用 `ctx.forgeSession.discoverBranch` 绑定该分支打开状态的变更请求；同一远端与分支在刷新前只查找一次。识别出的托管平台变化时以及刷新时，会在 `readinessTimeoutMs` 内检查登录状态；一次刷新在它触发的检查与登录状态检查结束后完成，轮询结果之后才到达。

检查运行 `rev-parse --show-toplevel`、`rev-parse --path-format=absolute --git-common-dir`、`rev-parse --path-format=absolute --git-dir`、`symbolic-ref --short HEAD`、`rev-parse --short HEAD`、`rev-parse --abbrev-ref @{upstream}` 与 `remote -v`；`branches` 运行 `symbolic-ref` 与 `for-each-ref --count=<maxBranches>`。之后，检查会为变更卡片统计 `branch` 范围的规模：找出分叉点，对它运行 `diff --numstat -z -M`，并列出未跟踪文件。每个命令都在 Session 的只读沙箱策略下运行，禁用可选的索引写入、钩子、文件系统监视器、提示与对象的延迟获取，移除继承的 Git 选择器与携带密钥的变量，并各自受 `gitTimeoutMs` 时限与每个输出流的 `maxOutputBytes` 上限约束。Git 打印的顶层目录、Git 目录与公共 Git 目录经 `ctx.fs` 解析为工作目录服务记录的规范进程路径；Git 目录与公共 Git 目录不同的检出是链接 worktree。工作树选项在 `danger-full-access` 沙箱模式下可用，在 `read-only` 下不可用，在 `workspace-write` 下只有两个目录都位于 Session 沙箱策略的规范工作区根内时才可用。

worktree 请求是一条 `plugin:client-ui-forge/worktree` 记录，由 `forgeWorktree` 投影折叠：请求与撤回在第一个 `turn/start` 或创建之前生效；在第一个 `step/start` 之前，未完成请求的第一条 `created` 记录生效。该投影还从 Session 头部与每个 `working-directory/change` 记录 Session 的目录；它的客户端视图随 Session 摘要下发，在该目录就是所创建的 worktree 或位于其下时为该 worktree，否则为 null。一轮开始或 worktree 已创建之后，`requestWorktree` 与 `cancelWorktree` 以 `forgePanel/session-started` 拒绝；没有 `worktrees` 服务时以 `forgePanel/worktrees-unavailable` 拒绝；分支名为空时以 `forgePanel/invalid-branch` 拒绝；两者都会忘掉失败的尝试。一个 `agent-controller/admission` 监听器在 Session 有未完成请求时暂留消息，同时以 Session 所属 Agent 的维护任务运行一次尝试，使用新分支名，因此其他客户端此时发来的消息会等它完成；它在面板状态中发布正在进行的阶段并设置 `held`，记录带源仓库根目录的 `created`，然后放行消息。失败的尝试以 `failure` 留在面板状态中，带有分支、基准、失败步骤与原因，直到下一次尝试开始或请求变更，消息则以 `forge/worktree-creation-failed` 被拒绝。`stopCreation` 与 Agent 的取消以 `forge/worktree-creation-stopped` 拒绝消息，发送方的取消原样传出。在所创建 worktree 中工作的 Session，其每条消息在 worktree 缺失时以 `forge/worktree-missing` 被拒绝；检查无法给出结果时放行。有面板跟随该 Session 时，拒绝标记为 `presented`。worktree 服务把工作目录通知排进队列，由第一步认领。一个 `agent/pre-step` 监听器在请求仍未完成的 Session 的第 1 步创建 worktree，覆盖未经接纳就进入的消息；它把通知移入本步提议的消息，失败时这一轮结束、请求保留。`restoreWorktree` 与 `continueInProject` 同样以维护任务运行。套件把它的 `worktrees` 服务隔离，因此同时启用 Git Worktrees 时会有两个互不影响的服务。`track` 以 `forgePanel/unrecognized-url` 拒绝没有提供方识别的 URL。`markReady` 与 `merge` 只作用于该 Session 中由提供方服务的可见绑定，否则以 `forgePanel/not-bound` 拒绝；`merge` 带上卡片显示的 head 提交，head 已变化时以 `forgePanel/stale-head` 拒绝，其他拒绝都是带主机原因的 `forgePanel/action-failed`。

每次检查还会判断 worktree 是否缺失：Session 的目录位于所创建的 worktree 内，`ctx.fs.lstat` 在那里找不到目录，再由源仓库中的 `show-ref` 判断分支是否还在。

Session 在所创建的 worktree 中工作时，`localDiff` 以它的 `baseCommit` 为分叉点；否则按代码托管远端的顺序，对每个远端依次运行 `symbolic-ref --quiet --short refs/remotes/<remote>/HEAD` 与 `merge-base HEAD` 找出分叉点；找不到时 `branch` 范围以 `forgePanel/no-fork-point` 拒绝。它以固定的 `a/`、`b/` 前缀和 `core.quotePath=false` 运行 `diff --no-ext-diff --no-textconv --no-color -M`，分别与分叉点、HEAD（第一次提交之前为空树）、暂存区比较，或带 `--cached` 与 HEAD 比较。未跟踪文件由 `ls-files --others --exclude-standard -z` 列出，最多 `maxUntrackedFiles` 个，其余计为未列出；它们经 `ctx.fs` 读取并作为新文件加入，前 8,000 字节含 NUL 字节或不是 UTF-8 时视为二进制。补丁、文件列表或文件超过 `maxDiffBytes` 时以 `forgePanel/diff-too-large` 拒绝，目录不在检出中时以 `forgePanel/not-a-checkout` 拒绝。宿主用 jsdiff 把补丁解析为文件与 hunk，浏览器不会收到原始补丁。`localText` 读取一个文件的新版本：“已暂存”经 `show :<path>` 从暂存区读取，其余经 `ctx.fs` 读取；离开检出的路径会被拒绝。`changeRequestDiff` 与 `changeRequestText` 只作用于该 Session 中由提供方服务的可见绑定，否则以 `forgePanel/not-bound` 拒绝；它们经提供方的 `diff` 与 `fileText` 读取绑定最新状态中的 head 提交，`too-large` 失败以 `forgePanel/diff-too-large` 拒绝，尚未读到状态或托管平台以其他原因拒绝时以 `forgePanel/diff-failed` 拒绝。Host 保留 `changeRequestDiff` 读到的补丁，每个变更请求一份，按 head 提交与目标分支区分，总量超过 `maxCachedDiffBytes` 时丢弃最久未读的；之后在同一 head 与目标分支下的读取不论来自哪个 Session 都从内存返回，读取失败的结果不保留。本地分支比 head 多出的提交数由 `symbolic-ref`、`cat-file -e` 与 `rev-list --count` 得出；当前检出分支不是源分支、本地没有 head 提交或 Git 失败时为 null。

`changeRequestStates` 为会话列表推送调用方可读的、已列出的 Session 所绑定的每个变更请求的最近编号、标题、状态、草稿标记、检查汇总、评审结论与可合并性：先是一个 `baseline` 帧，之后是 `changed` 帧。所有流共用一次运行，最后一条流结束时运行停止。它经 `sessionQuery` 列出 Session 而不加载它们，已加载 Session 的可见绑定取自 `ctx.forgeSession`，其他 Session 的取自缓存的 `forgeChangeRequests` 摘要；它跟随已加载 Session 的绑定变化，并经 `ctx.forge.watch` 轮询每个已绑定的变更请求，直到它合并或关闭。每个变化了的状态以其 URL 的 SHA-256 摘要为键存入 `forge_panel_change_requests` 存储域，没有任何已列出 Session 绑定的已存状态会被删除；写入失败时记录日志，状态仍保留在内存中。宿主缺少 Session 查询、投影缓存、存储或 Session 存储服务时，流以失败结束。

浏览器入口先挂载 Remote，再挂载界面。每个 Session 一条流，同时供给标签页、标题栏按钮、新会话选项与创建卡片；第一个订阅方出现时打开，最后一个离开时关闭，传输重置后重新打开，并为下一个订阅方保留最后的状态。新会话选项填入 `conversation.hero.options`，worktree 卡片填入 `conversation.input.dock`。worktree 卡片显示正在进行的创建，有消息在等待时“取消”调用 `stopCreation`；或显示最近一次失败，“不使用工作树”调用 `cancelWorktree`。等待中的消息由输入框自己显示为正在发送，被拒绝的消息留在输入框里。标签页用 Remote 宿主信息中的宿主主目录缩短路径，每次传输重置后重新读取。标签页把自己是否可见报告给标题栏按钮的按下状态。toast 位于 `shell.overlay` 条目中，因此比标签页存在得更久。只要 `sidebar.session.row.trailing` 中的会话行图标或 `sidebar.session.row.hover` 中的悬浮卡片部分有一个已挂载，就由同一条变更请求状态流供给它们；两者都从会话列表的摘要值中读取 Session 的 worktree 与绑定。变更请求卡片接收变更请求、它的快照与可选操作，其他界面可以复用。变更视图是 `forge-changes` 资源标签页类型：它的地址 `dsh-resource://forge-changes/<session>/local` 与 `dsh-resource://forge-changes/<session>/change/<url>` 指明来源，导航参数可以指定要滚动到的文件。它的正文用 slot store 按标签页保存范围与布局选择，经 Remote 读取，并用共享的代码高亮器高亮各行；标签页标题显示变更图标与视图名称。

| 源码 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `forgePanel` Remote 与按 Session 的面板 |
| [`src/panel.ts`](src/panel.ts) | 面板状态、检查调度与登录检查 |
| [`src/worktree.ts`](src/worktree.ts) | worktree 记录、投影，以及在接纳阶段与第一步创建 worktree |
| [`src/states.ts`](src/states.ts) | 会话列表用的变更请求状态 |
| [`src/git.ts`](src/git.ts) | 受限的只读 Git 命令 |
| [`src/parse.ts`](src/parse.ts) | Git 输出解析与远端顺序 |
| [`src/diff.ts`](src/diff.ts) | 补丁解析、把未跟踪文件表示为新增，以及 numstat 记录 |
| [`src/local-diff.ts`](src/local-diff.ts) | 分叉点、本地范围、新版本文本与 `branch` 范围摘要 |
| [`src/client/mount.ts`](src/client/mount.ts) | Remote 挂载、slot 条目与操作结果映射 |
| [`src/client/ChangeRequestCard.tsx`](src/client/ChangeRequestCard.tsx) | 可复用的变更请求卡片 |
| [`src/client/LocalChangesCard.tsx`](src/client/LocalChangesCard.tsx) | 变更卡片 |
| [`src/client/ChangesTab.tsx`](src/client/ChangesTab.tsx) | 变更视图 |
| [`src/client/DiffFile.tsx`](src/client/DiffFile.tsx) | 变更视图中的一个文件 |
| [`src/client/FileLabel.tsx`](src/client/FileLabel.tsx) | 变更文件的标签：文件名在前，目录在后 |
| [`src/client/WorktreeToggle.tsx`](src/client/WorktreeToggle.tsx) | 新会话的工作树选项 |
| [`src/client/WorktreeProgress.tsx`](src/client/WorktreeProgress.tsx) | worktree 创建卡片与 worktree 缺失卡片 |
| [`src/client/SessionRowForge.tsx`](src/client/SessionRowForge.tsx) | 会话行图标 |
| [`src/client/SessionHoverForge.tsx`](src/client/SessionHoverForge.tsx) | 会话行悬浮卡片中的部分 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [Forge 子系统](../../../docs/subsystems/forge.zh.md)——变更请求类型与服务参考。
- [Session 绑定](../forge-session/README.zh.md)——变更请求如何绑定到 Session。
- [Worktree 服务](../worktree/README.zh.md)——worktree 如何创建并进入。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由工作目录服务与 Session 的对话：关于 Session 新 worktree 的通知会加入第一次请求的消息，“在项目目录继续”会为下一次请求排入同类通知，“创建变更请求”会发送一条请 Agent 创建变更请求的用户消息。检查、状态、diff、恢复、会话列表与面板的其余部分都不会给模型请求增加内容。

#### KV Cache 影响

新 worktree 的通知没有影响，因为它属于 Session 的第一次请求，那时还没有任何缓存前缀。“在项目目录继续”之后的通知与“创建变更请求”发送的消息都追加在缓存前缀之后。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- **只在显示时轮询**——只有会话列表的某一行或本包为该 Session 挂载了某个界面时才会轮询状态；其间检查结束不会有通知。
- **会话列表中未打开的 Session**——会话列表从缓存的摘要中读取未加载 Session 的 worktree 与绑定：没有缓存摘要的 Session 两者都不显示；此版本之前最后使用的 Session 要打开之后才显示其 worktree。
- **检查触发时机**——检出只在 Session 的工具结果与目录变化之后检查；Session 之外的改动要等到刷新或下一个工具结果才会出现。
- **只负责创建**——面板只在 Session 的第一步之前创建 worktree，从不删除或清理；失败或被取消的尝试可能留下分支或检出。分支名取自 Session id 与随机数字，而不是 Session 标题，因为那时标题还不存在。
- **不经接纳的发送方**——只有 Web Session Remote 经 agent controller 的 `agent-controller/admission` 阶段投递消息。其他发送方发出的第一条消息会直接开始这一轮，worktree 在第一步创建；发往已删除 worktree 的消息照常进入，其中的工具会因目录不存在而失败。
- **恢复**——恢复会从分支重新检出；分支也已删除时，从它开始时的提交重新创建。从未提交的修改随被删除的目录一起丢失。
- **链接 worktree 项目**——项目本身是链接 worktree 时该选项不可用：在 workspace-write 下它的 Git 目录位于可写根之外，新分支与之后的提交都无法写入。
- **变更范围**——待办：单个提交与上一轮的范围。“分支”范围需要一个默认分支与 HEAD 有共同历史的远端，或 Session 创建的 worktree。
- **大型变更**——本地补丁超过 `maxDiffBytes` 时不显示任何文件；超过托管平台或其提供方大小上限的变更请求 diff 不显示任何文件，只提供“在浏览器中查看”。不自动换行时，左右对比会在栏边截断长行。
- **代码审查页**——待办：在左侧导航中新增一个页面，列出用户在所选提供方上的变更请求；[决策笔记](../../../.agents/notes/implemented/feature/2026-10-09-forge-panel.zh.md)记录了它的接入位置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
