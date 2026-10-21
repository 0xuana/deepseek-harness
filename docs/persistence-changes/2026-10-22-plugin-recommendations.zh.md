---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-22-plugin-recommendations

[English](2026-10-22-plugin-recommendations.md) | 中文

## 概述

为写入模型上下文的官方插件状态新增来源标记。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-22-plugin-recommendations
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-20-personalized-page-status"
    after: "dde4d210811d670552c70fa7a9864ae650cef357590ad60ef1778c9b7dd1d7bf"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-20-personalized-page-status"
    after: "1adeb5417a9565c55ad63138034d1c51daf6a75f8964c46352691a1d94188265"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-20-personalized-page-status"
    after: "651a11c7869dfbe778ff23bf7e94567b141470b5dbad4a146f93189a4ff24646"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-20-personalized-page-status"
    after: "1ca126460ab395a27ca1d236203c0a8b58eddcc316d681484691bced1b220045"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有消息和操作记录不变。未加载本插件的读取器保留新来源种类及其 JSON 元数据，并将已记录文本作为普通上下文派生。只有写入方使用 through 序号抑制已送达通知；它不授予权限，读取会话也不会重放被报告的卡片决定。操作记录沿用现有可忽略的插件记录信封。

<a id="verification"></a>
## 验证

插件推荐的投影、状态、操作和 Loader/HMR 组合专项测试 33 项通过，修改的 Host 模块覆盖率为 100%。状态测试覆盖下一次请求送达、通知写入日志后才确认、取消、拒绝、插件重载、重新打开 Session，以及没有对应提案的记录。

<a id="dev-note"></a>
## 开发备注

无。
