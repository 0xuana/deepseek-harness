# Agent Note: Session 变更请求绑定

Status: implemented

[English](2026-10-09-session-change-request-bindings.md) | 中文

## Problem

打开或更新 pull request 的 Session 只在 shell 输出里留下它们。用户和后续消费方都无法得到该 Session 正在处理的变更请求（change request）列表，也无法共享查看其状态。各代码托管平台的 URL、命令行工具与状态模型各不相同，而这种关联必须在 fork 与恢复后保留，且不能改变模型看到的内容。

## Decision

实验性的 forge 能力 seam 由三个角色组成。[`dsh-experimental-forge`](../../../../packages/experimental/forge/README.zh.md) 定义提供方无关的仓库与变更请求引用、提供方注册表与共享轮询：同一变更请求的监听方共享一个循环，每个 forge 同时只有一次批量读取，轮询节奏随检查、可合并性与生命周期状态变化。[`dsh-experimental-forge-github`](../../../../packages/experimental/forge-github/README.zh.md) 是第一个提供方；它通过宿主上的 GitHub CLI 读取 GitHub，因此凭据保留在该工具自己的存储中，从不进入 Session 的执行环境。[`dsh-experimental-forge-session`](../../../../packages/experimental/forge-session/README.zh.md) 把变更请求绑定到 Session。

绑定从 Session 日志派生，而不是存放在单独的存储中。一个仅宿主侧的投影读取 `bash` 与 `pwsh` 调用：`gh pr create` 的结果绑定其输出的 URL，`git push` 的结果记录其更新的分支。调用方操作与发现结果是 `plugin:forge-session/binding` 插件记录。由于所有输入都是日志事件，fork 与恢复无需新的持久化即可带上绑定，投影也能从任意检查点重建它们。证据是输出中的 URL 或 ref 行，而不是退出状态：失败的 `gh pr create` 报告的已有 pull request 仍会绑定，部分被拒绝的推送仍会记录它已更新的分支。

每次推送结果之后，服务通过提供方为被推送的分支查找打开状态的变更请求，并记录尚未绑定的那些。被隐藏的绑定不会被发现逻辑恢复，只能通过 `track` 恢复。轮询到的状态不写入日志；它是进程内状态，仅在有监听方展示该 Session 时存在。

## Alternatives considered

**宿主侧绑定数据库。** 单独的存储需要自己的 fork、恢复与删除规则；插件记录与投影已经提供了这些规则。

**由模型工具登记每个变更请求。** 关联将取决于模型是否调用额外的工具，而且每个请求都要携带该工具的 schema。解析模型本来就会运行的命令不消耗 token。

**把轮询状态写入 Session 日志。** 状态的变化独立于对话。写入日志会让日志随每次轮询增长，并把过期快照暴露给后续读取方。

**通过 Session 的子进程提供方运行 `gh`。** 远端与沙箱执行环境将需要 GitHub 凭据，状态也会取决于 Session 使用的执行环境。宿主 CLI 让凭据只有一个所有者。

## Consequences

在常见的 `gh pr create` 与 `git push` 流程中，绑定无需模型配合即可出现，且不增加模型 token。通过脚本、别名或其他命令行工具运行的命令无法识别；在别处打开的变更请求要等到下一次推送或 `track` 才会出现。新的提供方在同一提供方契约之后加入自己的访问方式与 URL 形式，无需改变绑定规则或轮询。宿主需要为每个 GitHub 主机登录 `gh`。
