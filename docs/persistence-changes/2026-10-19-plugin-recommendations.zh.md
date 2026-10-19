---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-19-plugin-recommendations

[English](2026-10-19-plugin-recommendations.md) | 中文

## 概述

新增 plugin-recommendation 消息来源，表示用户启用推荐的官方插件后排入主会话的通知。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-19-plugin-recommendations
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "77a13807c15400b23a7ef7bb6920787b6eba466c3f3ecf63d39552176c36b3fb"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "a6cc709dc063ad3d5a3755416ce4cba0c6dd7afab82e7d3a7ee27a5c22ed20f7"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "34cdaafedea27447895eb9f7f51a9da1b1de6c36c7415d7e76a72f1002e84214"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "784aaa6de3e5e3d2aaad0fe35c139e9a5ad4797d85587ac5676ae5561bc4dbb7"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有来源和记录不变，新读取方仍接受已有会话。新增 kind 属于可合并扩展的 MessageSource 元数据，使用既有 notice 形式并提供必需的 summary。旧消费方对未知来源 kind 使用默认分支，可呈现已有通知形式和未改变的消息正文；没有新增必读事件判别符，也不重新解释已有 kind。通知记录已完成的配置操作，读取会话不会重放该操作。实验性选择回执使用现有可忽略的 plugin-record 封装。

<a id="verification"></a>
## 验证

Host 与 Client 定向测试共 28 项通过，变更源文件覆盖率为 100%。Loader/HMR 组合测试启用真实可选包，核对保存的配置，并观察同一 Agent 消费续跑通知。测试覆盖选择回放、重复操作、启用失败和卸载。

<a id="dev-note"></a>
## 开发备注

无。
