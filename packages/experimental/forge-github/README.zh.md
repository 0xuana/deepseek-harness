---
description: "通过宿主上的 GitHub CLI 为实验性 forge 注册表服务 GitHub 主机。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-forge-github

[English](README.md) | 中文

## 概述

借助宿主上已登录的 GitHub CLI，为 `ctx.forge` 读取 GitHub 与 GitHub Enterprise 的 pull request。每次轮询对每个主机只发一个 GraphQL 查询，读取所有到期 pull request 的状态、检查、评审结论、可合并性与未解决的评审讨论。

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

在 forge 注册表之后挂载提供方，并显式列出每个 GitHub Enterprise 主机。

```yaml
- name: '@deepseek-ai/dsh-experimental-forge'
- name: '@deepseek-ai/dsh-experimental-forge-github'
  config:
    hosts: [github.com, ghe.example.com]
```

即使 Session 在其他执行环境中运行命令，提供方也以宿主进程的形式运行 `gh`。每个主机执行一次 `gh auth login --hostname <host>` 完成登录。子进程继承的宿主环境去掉了 `DSH_*` 变量以及名称包含 `KEY`、`PASSWORD`、`SECRET` 或 `TOKEN` 的变量，因此 `GH_TOKEN` 与 `GITHUB_TOKEN` 不会被转发，`gh` 使用自己的凭据存储。交互提示、更新提醒、分页器与颜色输出均被关闭。`ghCommand`、`hosts`、`timeoutMs` 与 `maxOutputBytes` 见[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-forge-github)。

当主机在配置中时，提供方服务 `https`、`http`、`ssh`、`git` 形式的远端 URL，以及 `git@github.com:owner/name.git` 这类 scp 形式。HTTP(S) 远端在主机标识中保留自定义端口；SSH 和 Git 传输端口不计入主机标识。它服务 `https://<host>/<owner>/<name>/pull/<number>` 形式的 pull request URL，允许其后附带任意路径、查询或片段，并以去掉这些后缀的形式作为规范 URL。按 head 分支查找时，最多返回 20 个以该分支为 head 的打开状态 pull request，按创建时间从新到旧排列，不包含来自 fork 的 pull request；查找默认分支时返回空结果。

检查运行（check run）在完成前映射为 `pending`，完成后映射为 `success`、`failure`（失败、超时、启动失败或需要操作）、`cancelled`、`skipped` 或 `neutral`。提交状态上下文把 `SUCCESS` 映射为 `success`，把 `FAILURE` 与 `ERROR` 映射为 `failure`，其余状态均映射为 `pending`。GraphQL 的 `NOT_FOUND` 错误转为 `not-found` 失败。响应不含 GraphQL data 或 errors 时（包括 HTTP 错误 JSON），使用 stderr 的首条诊断或响应体的 message。认证诊断转为 `unauthenticated`；限流与其他失败转为 `unavailable`。head 查找在拒绝时保留相同诊断。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

一次读取按主机对引用分组，每个主机发送一个 `gh api graphql` 查询。查询内联经过校验的 owner、name 与编号，并为每个 pull request 设置别名，因此局部 GraphQL 错误只影响对应的别名。出现局部错误时 `gh` 以非零状态退出，但仍会输出完整响应；提供方先解析该响应，再检查退出码。

| 源码 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 配置校验与提供方注册 |
| [`src/provider.ts`](src/provider.ts) | URL 映射、按主机分组与失败分类 |
| [`src/graphql.ts`](src/graphql.ts) | 构造查询，并校验和映射响应 |
| [`src/gh.ts`](src/gh.ts) | 在宿主上执行 `gh`，清理环境变量并施加限制 |
| [`src/urls.ts`](src/urls.ts) | 解析远端 URL 与 pull request URL |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [Forge 注册表](../forge/README.zh.md)——提供方注册与共享轮询。
- [Forge 子系统](../../../docs/subsystems/forge.zh.md)——提供方契约与变更请求类型。
- [子进程环境](../../subprocess/subprocess/README.zh.md)——共享的环境变量清理规则。

-----

<a id="model-experience"></a>
## 模型体验

无：提供方为宿主侧监听方读取 pull request 状态，不贡献模型上下文。

#### KV Cache 影响

无。提供方的输出只到达宿主侧监听方。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- **宿主需要 GitHub CLI**——必须安装 `gh` 并为每个已配置主机登录；环境变量中的令牌不会被转发。不在 `hosts` 中的主机永远不会被读取，包括配置变更后保留的引用。状态读取为这些引用返回 `unavailable`；head 查找会在启动 `gh` 前拒绝。
- **前 100 个检查与评审讨论**——head 提交的检查超过上限时以 `checksTruncated` 标记；前 100 个之后的未解决讨论不计入。
- **不发现 fork**——按 head 分支查找时，不包含 head 位于其他仓库的 pull request。
- **速率限制**——每次轮询都会以已登录账号的速率配额为每个主机消耗一次 GraphQL 查询。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
